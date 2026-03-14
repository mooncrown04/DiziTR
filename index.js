const express = require('express');
const https = require('https');
const http = require('http');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

const PORT = process.env.PORT || 7000;
const TOKEN = process.env.DIZPAL_TOKEN || '9iQNC5HQwPlaFuJDkhncJ5XTJ8feGXOJatAA';
const API_BASE = 'ydfvfdizipanel.ru';

const MANIFEST = {
  id: 'com.dizipalorijinal.addon',
  version: '4.0.0',
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

// ─── HTTP fetch ───────────────────────────────────────────────────────────────

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: API_BASE,
      path,
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'identity' },
      timeout: 15000,
    }, (res) => {
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

// ─── Mediafire çözücü ────────────────────────────────────────────────────────

async function resolveMediafire(mfUrl) {
  const cacheKey = `mf_${mfUrl}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  try {
    const html = await fetchHtml(mfUrl);
    const match = html.match(/href="(https:\/\/download\d+\.mediafire\.com\/[^"]+)"/);
    if (match) {
      cache.set(cacheKey, match[1], 1800);
      return match[1];
    }
  } catch (e) {
    console.error('[Mediafire Hata]', e.message);
  }
  return null;
}

// ─── Katalog: tüm unique dizileri toplu çek ve cache'le ──────────────────────
// Startup'ta değil, ilk catalog isteğinde başlat

let allSeriesCache = null; // { list: [{id, name, poster, genres}], ts: Date }
let fetchInProgress = false;

async function getAllSeries() {
  // 1 saatlik cache
  if (allSeriesCache && (Date.now() - allSeriesCache.ts) < 3600000) {
    return allSeriesCache.list;
  }
  if (fetchInProgress) {
    // Zaten çekiliyor, bitene kadar bekle
    await new Promise(r => setTimeout(r, 2000));
    return allSeriesCache ? allSeriesCache.list : [];
  }

  fetchInProgress = true;
  console.log('[Katalog] Tüm diziler çekiliyor...');

  try {
    const first = await apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=1`);
    const totalPages = first.last_page;
    const seriesMap = new Map();

    const processPage = (pageData) => {
      for (const ep of pageData.data) {
        if (!ep.imdb_external_id || seriesMap.has(ep.id)) continue;
        seriesMap.set(ep.id, {
          id: ep.imdb_external_id,
          type: 'series',
          name: ep.name,
          poster: ep.poster_path,
          genres: ep.genre_name ? [ep.genre_name] : [],
          description: '🇹🇷 Türkçe Dublaj',
        });
      }
    };

    processPage(first);

    // 20'şer paralel çek
    const BATCH = 20;
    for (let start = 2; start <= totalPages; start += BATCH) {
      const end = Math.min(start + BATCH - 1, totalPages);
      const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      const results = await Promise.all(pages.map(p =>
        apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=${p}`).catch(() => null)
      ));
      results.forEach(r => { if (r) processPage(r); });

      if (start % 200 === 2) {
        console.log(`[Katalog] Sayfa ${end}/${totalPages} — ${seriesMap.size} unique dizi`);
      }
    }

    const list = [...seriesMap.values()];
    allSeriesCache = { list, ts: Date.now() };
    console.log(`[Katalog] Tamamlandı: ${list.length} dizi`);
    return list;
  } finally {
    fetchInProgress = false;
  }
}

// ─── Bölüm bulucular ─────────────────────────────────────────────────────────

async function findEpisodes(imdbId) {
  const cacheKey = `episodes_${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const first = await apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=1`);
  const totalPages = first.last_page;
  const episodes = first.data.filter(e => e.imdb_external_id === imdbId);

  const BATCH = 15;
  for (let start = 2; start <= totalPages; start += BATCH) {
    const end = Math.min(start + BATCH - 1, totalPages);
    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const results = await Promise.all(pages.map(p =>
      apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=${p}`).catch(() => null)
    ));
    for (const r of results) {
      if (r && r.data) episodes.push(...r.data.filter(e => e.imdb_external_id === imdbId));
    }
  }

  cache.set(cacheKey, episodes, 7200);
  return episodes;
}

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
        apiGet(`/public/api/media/seriesEpisodesAll/${TOKEN}?page=${p}`).catch(() => null)
      ));
      for (const r of results) {
        if (!r || !r.data) continue;
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

    const allSeries = await getAllSeries();
    const PAGE_SIZE = 100;
    const page = allSeries.slice(skip, skip + PAGE_SIZE);

    console.log(`[Catalog] skip=${skip} → ${page.length} dizi (toplam: ${allSeries.length})`);
    res.json({ metas: page });
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
    const title = ep.episode_name || `S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}`;
    const filename = `${ep.name} S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}.mkv`;

    if (ep.hls === 1) {
      streams.push({ name: '🇹🇷 DiziPal', title: `📺 ${title}`, url: ep.link });
    } else if (ep.link.includes('mediafire.com')) {
      const directUrl = await resolveMediafire(ep.link);
      if (directUrl) {
        streams.push({
          name: '🇹🇷 DiziPal',
          title: `🎬 ${title} — Türkçe Dublaj`,
          url: directUrl,
          behaviorHints: { notWebReady: false, filename },
        });
      } else {
        streams.push({ name: '🇹🇷 DiziPal (İndir)', title: `⬇️ ${title}`, externalUrl: ep.link });
      }
    } else if (ep.embed === 1) {
      streams.push({ name: '🇹🇷 DiziPal', title: `▶️ ${title}`, externalUrl: ep.link });
    } else {
      streams.push({
        name: '🇹🇷 DiziPal',
        title: `🎬 ${title} — Türkçe Dublaj`,
        url: ep.link,
        behaviorHints: { notWebReady: false, filename },
      });
    }

    res.json({ streams });
  } catch (e) {
    console.error('[Stream Hata]', e.message);
    res.json({ streams: [] });
  }
});

app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    series_cached: allSeriesCache ? allSeriesCache.list.length : 0,
    fetch_in_progress: fetchInProgress,
    cache_keys: cache.keys().length,
  });
});

app.listen(PORT, () => {
  console.log(`🇹🇷 DiziPal Orijinal v4 — Port ${PORT}`);
  // Arka planda hemen başlat
  getAllSeries().catch(e => console.error('[Startup Hata]', e.message));
});
