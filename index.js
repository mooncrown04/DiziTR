const express = require('express');
const https = require('https');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

const PORT = process.env.PORT || 7000;
const TOKEN = process.env.DIZPAL_TOKEN || '9iQNC5HQwPlaFuJDkhncJ5XTJ8feGXOJatAA';
const API_BASE = 'ydfvfdizipanel.ru';

// ─── Manifest ────────────────────────────────────────────────────────────────

const MANIFEST = {
  id: 'com.dizipalorijinal.addon',
  version: '2.0.0',
  name: '🇹🇷 DiziPal Orijinal',
  description: 'Türkçe dublaj diziler — DiziPal Orijinal kaynağından',
  logo: 'https://www.google.com/s2/favicons?domain=dizipal1542.com&sz=128',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series'],
  catalogs: [
    {
      type: 'series',
      id: 'dizipalorijinal',
      name: '🇹🇷 Türkçe Dublaj Diziler',
      extra: [{ name: 'skip', isRequired: false }],
    },
  ],
  idPrefixes: ['tt'],
  behaviorHints: { adult: false, configurable: false },
};

// ─── API ─────────────────────────────────────────────────────────────────────

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_BASE,
      path,
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'identity' },
      timeout: 15000,
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse hatasi')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

// ─── Tek API sayfasını unique dizilere dönüştür ───────────────────────────────

async function getSeriesFromPage(apiPage) {
  const cacheKey = `series_page_${apiPage}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  console.log(`[API] Sayfa ${apiPage} çekiliyor...`);
  const data = await apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=${apiPage}`);

  const seriesMap = new Map();
  for (const ep of data.data) {
    if (!ep.imdb_external_id) continue;
    if (!seriesMap.has(ep.id)) {
      seriesMap.set(ep.id, {
        id: ep.imdb_external_id,
        type: 'series',
        name: ep.name,
        poster: ep.poster_path,
        genres: ep.genre_name ? [ep.genre_name] : [],
        description: '🇹🇷 Türkçe Dublaj',
      });
    }
  }

  const result = { metas: [...seriesMap.values()], totalPages: data.last_page };
  cache.set(cacheKey, result);
  return result;
}

// ─── Belirli bir IMDb ID'nin bölümlerini bul ─────────────────────────────────

async function findEpisodes(imdbId) {
  const cacheKey = `episodes_${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Önce hangi sayfada olduğunu bul — cache'deki sayfalara bak
  // Sonra tüm sayfaları tara
  const first = await apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=1`);
  const totalPages = first.last_page;
  const episodes = first.data.filter(e => e.imdb_external_id === imdbId);

  const BATCH = 15;
  for (let start = 2; start <= totalPages; start += BATCH) {
    const end = Math.min(start + BATCH - 1, totalPages);
    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const results = await Promise.all(pages.map(p =>
      apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=${p}`)
    ));
    for (const r of results) {
      if (r.data) episodes.push(...r.data.filter(e => e.imdb_external_id === imdbId));
    }
  }

  cache.set(cacheKey, episodes, 7200);
  return episodes;
}

// ─── Belirli bir bölümü bul ──────────────────────────────────────────────────

async function findEpisode(imdbId, season, episode) {
  const cacheKey = `ep_${imdbId}_${season}_${episode}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const first = await apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=1`);
  const totalPages = first.last_page;

  let found = first.data.find(e =>
    e.imdb_external_id === imdbId && e.season_number === season && e.episode_number === episode
  );

  if (!found) {
    const BATCH = 15;
    outer:
    for (let start = 2; start <= totalPages; start += BATCH) {
      const end = Math.min(start + BATCH - 1, totalPages);
      const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      const results = await Promise.all(pages.map(p =>
        apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=${p}`)
      ));
      for (const r of results) {
        if (!r.data) continue;
        found = r.data.find(e =>
          e.imdb_external_id === imdbId && e.season_number === season && e.episode_number === episode
        );
        if (found) break outer;
      }
    }
  }

  if (found) cache.set(cacheKey, found, 7200);
  return found || null;
}

// ─── CORS ────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/manifest.json'));
app.get('/manifest.json', (req, res) => res.json(MANIFEST));

// Catalog
app.get([
  '/catalog/series/dizipalorijinal.json',
  '/catalog/series/dizipalorijinal/:extra.json',
], async (req, res) => {
  try {
    let skip = parseInt(req.query.skip || '0');
    if (req.params.extra) {
      const m = decodeURIComponent(req.params.extra).match(/skip=(\d+)/);
      if (m) skip = parseInt(m[1]);
    }
    // skip → API sayfası: her API sayfasında 3-5 unique dizi var
    // skip=0→p1, skip=5→p2, skip=10→p3 ...
    const apiPage = Math.floor(skip / 5) + 1;
    const result = await getSeriesFromPage(apiPage);
    console.log(`[Catalog] skip=${skip} → apiPage=${apiPage} → ${result.metas.length} dizi`);
    res.json({ metas: result.metas });
  } catch (e) {
    console.error('[Catalog Hata]', e.message);
    res.json({ metas: [] });
  }
});

// Meta
app.get('/meta/series/:id.json', async (req, res) => {
  try {
    const imdbId = req.params.id;
    console.log(`[Meta] ${imdbId}`);

    const episodes = await findEpisodes(imdbId);
    if (!episodes.length) return res.json({ meta: null });

    const ref = episodes[0];
    const sorted = [...episodes].sort((a, b) => {
      if (a.season_number !== b.season_number) return a.season_number - b.season_number;
      return a.episode_number - b.episode_number;
    });

    const videos = sorted.map(ep => ({
      id: `${imdbId}:${ep.season_number}:${ep.episode_number}`,
      title: ep.episode_name || `${ep.seasons_name} ${ep.episode_number}. Bölüm`,
      season: ep.season_number,
      episode: ep.episode_number,
      thumbnail: ep.still_path || ep.poster_path,
      released: new Date(2020, ep.season_number - 1, ep.episode_number).toISOString(),
    }));

    res.json({
      meta: {
        id: imdbId,
        type: 'series',
        name: ref.name,
        poster: ref.poster_path,
        genres: ref.genre_name ? [ref.genre_name] : [],
        description: `🇹🇷 Türkçe Dublaj | ${episodes.length} bölüm`,
        videos,
      },
    });
  } catch (e) {
    console.error('[Meta Hata]', e.message);
    res.json({ meta: null });
  }
});

// Stream
app.get('/stream/series/:id.json', async (req, res) => {
  try {
    const parts = req.params.id.split(':');
    if (parts.length < 3) return res.json({ streams: [] });

    const imdbId = parts[0];
    const season = parseInt(parts[1]);
    const episode = parseInt(parts[2]);
    console.log(`[Stream] ${imdbId} S${season}E${episode}`);

    const ep = await findEpisode(imdbId, season, episode);
    if (!ep || !ep.link) return res.json({ streams: [] });

    const streams = [];

    if (ep.hls === 1) {
      streams.push({
        name: '🇹🇷 DiziPal',
        title: `📺 ${ep.episode_name || 'HLS'}`,
        url: ep.link,
      });
    } else if (ep.embed === 1) {
      streams.push({
        name: '🇹🇷 DiziPal',
        title: `▶️ ${ep.episode_name || 'Oynat'}`,
        externalUrl: ep.link,
      });
    } else {
      streams.push({
        name: '🇹🇷 DiziPal',
        title: `⬇️ ${ep.episode_name || 'İndir'} — ${ep.server}`,
        externalUrl: ep.link,
      });
    }

    res.json({ streams });
  } catch (e) {
    console.error('[Stream Hata]', e.message);
    res.json({ streams: [] });
  }
});

app.get('/status', (req, res) => {
  res.json({ status: 'ok', cache_keys: cache.keys().length });
});

// ─── Sunucu ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🇹🇷 DiziPal Orijinal v2 — Port ${PORT}`);
});