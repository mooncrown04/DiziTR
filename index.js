import stremio from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = stremio;
import fetch from 'node-fetch';

// Sabit API bilgileri
const API_BASE = 'https://ydfvfdizipanel.ru/public/api';
const API_KEY = '9iQNC5HQwPlaFuJDkhncJ5XTJ8feGXOJatAA';
const HOME_CATALOGS = [
  {
    id: 'sinewix-latest-series',
    type: 'series',
    name: 'Sinewix Yeni Diziler',
    path: `/genres/latestseries/all/${API_KEY}`,
    source: 'paged',
    perPage: 12
  },
  {
    id: 'sinewix-latest-movies',
    type: 'movie',
    name: 'Sinewix Yeni Filmler',
    path: `/genres/latestmovies/all/${API_KEY}`,
    source: 'paged',
    perPage: 12
  },
  {
    id: 'sinewix-latest-animes',
    type: 'series',
    name: 'Sinewix Yeni Animeler',
    path: `/genres/latestanimes/all/${API_KEY}`,
    source: 'paged',
    itemType: 'anime',
    perPage: 12
  },
  {
    id: 'sinewix-crime-series',
    type: 'series',
    name: 'Sinewix Suc Dizileri',
    path: `/genres/mediaLibrary/show/80/serie/${API_KEY}`,
    source: 'paged',
    perPage: 12
  },
  {
    id: 'sinewix-crime-movies',
    type: 'movie',
    name: 'Sinewix Suc Filmleri',
    path: `/genres/mediaLibrary/show/80/movie/${API_KEY}`,
    source: 'paged',
    perPage: 12
  },
  {
    id: 'sinewix-mystery-series',
    type: 'series',
    name: 'Sinewix Gizem Dizileri',
    path: `/genres/mediaLibrary/show/9648/serie/${API_KEY}`,
    source: 'paged',
    perPage: 12
  },
  {
    id: 'sinewix-mystery-movies',
    type: 'movie',
    name: 'Sinewix Gizem Filmleri',
    path: `/genres/mediaLibrary/show/9648/movie/${API_KEY}`,
    source: 'paged',
    perPage: 12
  },
  {
    id: 'sinewix-animation-movies',
    type: 'movie',
    name: 'Sinewix Animasyon Filmleri',
    path: `/genres/mediaLibrary/show/16/movie/${API_KEY}`,
    source: 'paged',
    perPage: 12
  },
  {
    id: 'sinewix-war-series',
    type: 'series',
    name: 'Sinewix Savas Dizileri',
    path: `/genres/mediaLibrary/show/10769/serie/${API_KEY}`,
    source: 'paged',
    perPage: 12
  },
  {
    id: 'sinewix-latest-episodes',
    type: 'series',
    name: 'Sinewix Son Bolumler',
    path: `/media/seriesEpisodesAll/${API_KEY}`,
    source: 'episodes',
    perPage: 15
  }
];

// Header'lar – örnek isteklerden alındı
const COMMON_HEADERS = {
  Accept: 'application/json',
  'Accept-Encoding': 'gzip',
  'Cache-Control': 'max-age=0',
  Connection: 'Keep-Alive',
  hash256: '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b',
  signature:
    '3082058830820370a00302010202145bbfbba9791db758ad12295636e094ab4b07dc24300d06092a864886f70d01010b05003074310b3009060355040613025553311330110603550408130a43616c69666f726e6961311630140603550407130d4d6f756e7461696e205669657731143012060355040a130b476f6f676c6520496e632e3110300e060355040b1307416e64726f69643110300e06035504031307416e64726f69643020170d3231313231353232303433335a180f32303531313231353232303433335a3074310b3009060355040613025553311330110603550408130a43616c69666f726e6961311630140603550407130d4d6f756e7461696e205669657731143012060355040a130b476f6f676c6520496e632e3110300e060355040b1307416e64726f69643110300e06035504031307416e64726f696430820222300d06092a864886f70d01010105000382020f003082020a0282020100a5106a24bb3f9c0aaf3a2b228f794b5eaf1757ba758b19736a39d1bdc73fc983a7237b8d5ca5156cfa999c1dab3418bbc2be0920e0ee001c8aa4812d1dae75d080f09e91e0abda83ff9a76e8384a4429f4849248069a59505b12ac2c14ba2e4d1a13afcdaf54e508697ff928a9f738e6f4a6fc27409c55329eb149b5ff89c5a2d7c06bf9e62086f955cad17d7be2623ee9d5ec56068eadc23cb0965a13ff97d49fe10ef41afc6eeca36b4ace9582097faff89f590bc831cdb3a69eec5d15b67c3f2cad49e37ed053733e3d2d400c47755b932bdbe15d749fd6ad1dce30ba5e66094dfb6ee6f64cafb807e11b19a990c5d078c6d6701cda0bdeb21e99404ff166074f4c89b04c418f4e7940db5c78647c475bcfb85d4c4e836ee7d7c1d53e9e736b5d96d4b4d8b98209064b729ac6a682d55a6a930e518d849898bb28329ca0aaa133b5e5270a9d5940cac6af4802a57fd971efda91abb602882dd6aa6ce2b236b57b52ee2481498f0cacbcc2c36c238bc84becad7eaaf1125b9a1ca9ded6c79f3f283a52050377809b2a9995d66e1636b0ed426fdd8685c47cb18e82077f4aefcc07887e1dc58b4d64be1632f0e7b4625da6f40c65a8512a6454a4b96963e7f876136e6c0069a519a79ad632078ed965aa12482458060c030ed50db706d854f88cb004630b49285d8af8b471ff8f6070687826412287b50049bcb7d1b6b62ef90203010001a310300e300c0603551d13040530030101ff300d06092a864886f70d01010b0500038202010051c0b7bd793181dc29ca777d3773f928a366c8469ecf2fa3cfb076e8831970d19bb2b96e44e8ccc647cf0696bb824ac61c23d958525d283cab26037b04d58aa79bf92192db843adf5c26a980f081d2f0e14f759fc5ff4c5bb3dce0860299bfe7b349a8155a2efaf731ba25ce796a80c1442c7bf80f8c1a7912ff0b6f6592264315337251a846460194fa594f81f38f9e5233a63201e931ad9cab5bf119f24025613f307194eaa6eb39a83f3c05a49ba34455b1aff7c6839bbb657d9392ffdf397432af6e56ba9534a8b07d7060fe09691c6cf07cb5324f67b3cc0871a8c621d81fe71d71085c55206a4f57e25f774fd4b979b299e8bb076b50fca42fa57da2d519fd35a4a7c0137babaed4345f8031b63b6a71f5e8268f709d658ccd7c2a58849379d25bfa598c3f4a2c3d9b7d89285fefeb7f0ec65137d38b08ce432a15688b624a179e6a4a505ebc3bcdfbc4d4330508ee2d8d0f016924dcec21a6838ef7d834c6f43bde4a5201ed0b3bb4e9bd377b470e36bcf5bc3d56169dbd8e39567aa7dce4d1a8a8a54a5e1aa6fb1a8aab0062669a966f96e15ccce6fe12ea5e6a8b8c8823bdc94988ca39759fd1cc8fd8ae5c3d74db50b174cf7d77655016c075c91d439ed01cc0a9f695c99fad3b5495fb6cb1e01a5fa020cc6022a85c07ec55f9eba89719f86e49d34ab5bd208c5f70cced2b7b7963c014f8404432979b506de29e',
  'User-Agent':
    'EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)'
};

// Stremio manifest
const manifest = {
  id: 'org.sinevix.sinewix',
  version: '1.1.0',
  name: 'Sinewix',
  description: 'Sinewix Turkce dizi eklentisi',
  catalogs: [
    ...HOME_CATALOGS.map(({ id, type, name }) => ({
      id,
      type,
      name,
      extra: [
        {
          name: 'skip'
        }
      ]
    })),
    {
      id: 'sinewix-search-series',
      type: 'series',
      name: 'Sinewix Dizi ve Anime Arama',
      extra: [
        {
          name: 'search',
          isRequired: true
        },
        {
          name: 'skip'
        }
      ]
    },
    {
      id: 'sinewix-search-movie',
      type: 'movie',
      name: 'Sinewix Film Arama',
      extra: [
        {
          name: 'search',
          isRequired: true
        },
        {
          name: 'skip'
        }
      ]
    }
  ],
  resources: [
    {
      name: 'catalog',
      types: ['series', 'movie'],
      idPrefixes: ['sinewix']
    },
    {
      name: 'meta',
      types: ['series', 'movie'],
      idPrefixes: ['sinewix']
    },
    {
      name: 'stream',
      types: ['series', 'movie'],
      idPrefixes: ['sinewix']
    }
  ],
  types: ['series', 'movie'],
  idPrefixes: ['sinewix']
};

const builder = new addonBuilder(manifest);
const metaCache = new Map();

// Yardımcı: API fetch
async function apiGet(path) {
  const url = `${API_BASE}${path}`;
  console.log('[apiGet]', url);
  const res = await fetch(url, {
    headers: COMMON_HEADERS
  });

  if (!res.ok) {
    throw new Error(`API hata: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

function removeNullish(value) {
  if (Array.isArray(value)) {
    return value.map(removeNullish);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => [k, removeNullish(v)])
    );
  }

  return value;
}

function buildMetaId(id, contentType = 'series') {
  const prefix = contentType === 'movie' ? 'sinewixm' : contentType === 'anime' ? 'sinewixa' : 'sinewixs';
  return `${prefix}${id}`;
}

function buildVideoId(serieId, seasonNumber, episodeNumber) {
  return `${buildMetaId(serieId, 'series')}:${seasonNumber}:${episodeNumber}`;
}

function buildReleaseInfo(firstDate, lastDate) {
  const firstYear = firstDate ? String(firstDate).slice(0, 4) : '';
  const lastYear = lastDate ? String(lastDate).slice(0, 4) : '';

  if (firstYear && lastYear && firstYear !== lastYear) {
    return `${firstYear}-${lastYear}`;
  }

  return firstYear || lastYear || undefined;
}

function toIsoDate(dateString) {
  if (!dateString) return undefined;

  // API çoğunlukla YYYY-MM-DD dönüyor; Stremio dokümanı ISO 8601 bekliyor
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return `${dateString}T00:00:00.000Z`;
  }

  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function parseAddonId(id) {
  const modernMatch = /^sinewix([sma])(\d+)(?::(\d+):(\d+))?$/.exec(id);
  if (modernMatch) {
    return {
      contentType: modernMatch[1] === 'm' ? 'movie' : modernMatch[1] === 'a' ? 'anime' : 'series',
      serieId: modernMatch[2],
      seasonNumber: modernMatch[3] ? Number(modernMatch[3]) : undefined,
      episodeNumber: modernMatch[4] ? Number(modernMatch[4]) : undefined
    };
  }

  // Geriye uyumluluk: eski formatlar
  const legacyParts = id.split(':');
  if ((legacyParts[0] === 'sinewix' || legacyParts[0] === 'ydf') && legacyParts[1]) {
    return {
      contentType: 'series',
      serieId: legacyParts[1],
      seasonNumber: legacyParts[2] ? Number(legacyParts[2]) : undefined,
      episodeNumber: legacyParts[3] ? Number(legacyParts[3]) : undefined
    };
  }

  return null;
}

function splitGenres(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'string') return undefined;
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function getPreviewName(item) {
  return item.name || item.title || item.original_name;
}

function normalizePreview(item, forcedType) {
  const rawType = forcedType || item.type;
  const stremioType = rawType === 'movie' ? 'movie' : 'series';
  const addonType = rawType === 'movie' ? 'movie' : rawType === 'anime' ? 'anime' : 'series';
  const meta = removeNullish({
    id: buildMetaId(item.id, addonType),
    type: stremioType,
    name: getPreviewName(item),
    poster: item.poster_path?.replace('http://', 'https://'),
    background: item.backdrop_path_tv?.replace('http://', 'https://') ||
      item.backdrop_path?.replace('http://', 'https://'),
    description: item.overview,
    releaseInfo: buildReleaseInfo(item.release_date, item.release_date),
    genres: splitGenres(item.genre_name) || item.genreslist,
    imdbRating: item.vote_average ? String(item.vote_average) : undefined,
    popularity: item.views || 0
  });

  metaCache.set(meta.id, {
    ...meta,
    contentType: addonType
  });

  return meta;
}

function getCatalogItems(data, source, itemType) {
  if (source === 'episodes') {
    const seen = new Set();
    return (data.data || [])
      .filter((item) => {
        if (!item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .map((item) =>
        normalizePreview(
          {
            ...item,
            overview: item.overview,
            release_date: item.release_date,
            genre_name: item.genre_name,
            type: 'serie'
          },
          'series'
        )
      );
  }

  return (data.data || []).map((item) => normalizePreview(item, itemType));
}

function getCatalogPage(catalog, skip = 0) {
  const normalizedSkip = Number(skip) || 0;
  const perPage = catalog.perPage || 12;
  return Math.floor(normalizedSkip / perPage) + 1;
}

function buildCatalogPath(catalog, skip = 0) {
  const page = getCatalogPage(catalog, skip);
  return `${catalog.path}?page=${page}`;
}

async function getMediaDetail(mediaId) {
  return apiGet(`/media/detail/${mediaId}/${API_KEY}`);
}

function buildStreamsFromVideos(videos = []) {
  return videos
    .filter((video) => video.status === 1 && video.link)
    .map((video) =>
      removeNullish({
        url: video.link,
        name: 'Sinewix',
        title: video.lang || 'TR'
      })
    );
}

// CATALOG HANDLER – search endpointini kullanır
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log('[catalog]', { type, id, extra });
  const homeCatalog = HOME_CATALOGS.find((catalog) => catalog.id === id);
  const skip = Number(extra?.skip) || 0;

  if (id === 'sinewix-search-series' || id === 'sinewix-search-movie') {
    if ((id === 'sinewix-search-series' && type !== 'series') || (id === 'sinewix-search-movie' && type !== 'movie')) {
      return { metas: [] };
    }

    const search = (extra && extra.search) || '';
    if (!search.trim()) {
      return { metas: [] };
    }

    try {
      const data = await apiGet(`/search/${encodeURIComponent(search)}/${API_KEY}`);

      const metas = (data.search || [])
        .map((item) => normalizePreview(item))
        .filter((item) =>
          id === 'sinewix-search-movie'
            ? item.type === 'movie'
            : item.type === 'series'
        );

      return { metas };
    } catch (err) {
      console.error('Catalog error', err);
      return { metas: [] };
    }
  }

  if (!homeCatalog || type !== homeCatalog.type) {
    return { metas: [] };
  }

  try {
    const data = await apiGet(buildCatalogPath(homeCatalog, skip));
    const metas = getCatalogItems(data, homeCatalog.source, homeCatalog.itemType);

    return { metas };
  } catch (err) {
    console.error('Catalog error', err);
    return { metas: [] };
  }
});

// META HANDLER – dizi detayları + sezon/bölüm listesi
builder.defineMetaHandler(async ({ type, id }) => {
  console.log('[meta]', { type, id });
  if (!['series', 'movie'].includes(type)) {
    return { meta: {} };
  }

  const parsed = parseAddonId(id);
  if (!parsed?.serieId) {
    return { meta: {} };
  }

  const { serieId, contentType } = parsed;
  if (!serieId) return { meta: {} };

  if (type === 'movie' || contentType === 'movie') {
    try {
      const data = await getMediaDetail(serieId);

      return {
        meta: removeNullish({
          id,
          type: 'movie',
          name: data.title || data.name || data.original_name,
          poster: data.poster_path?.replace('http://', 'https://'),
          background: data.backdrop_path_tv?.replace('http://', 'https://') ||
            data.backdrop_path?.replace('http://', 'https://'),
          description: data.overview,
          releaseInfo: buildReleaseInfo(data.release_date, data.release_date),
          genres: splitGenres(data.genresname) || data.genres,
          imdbRating: data.vote_average ? String(data.vote_average) : undefined
        })
      };
    } catch (err) {
      console.error('Movie meta error', err);
      const cached = metaCache.get(id);
      if (!cached) {
        return { meta: {} };
      }

      return {
        meta: removeNullish({
          id,
          type: 'movie',
          name: cached.name,
          poster: cached.poster,
          background: cached.background,
          description: cached.description,
          releaseInfo: cached.releaseInfo,
          genres: cached.genres,
          imdbRating: cached.imdbRating
        })
      };
    }
  }

  if (contentType === 'anime') {
    const cached = metaCache.get(id);
    if (!cached) {
      return { meta: {} };
    }

    return {
      meta: removeNullish({
        id,
        type: 'series',
        name: cached.name,
        poster: cached.poster,
        background: cached.background,
        description: cached.description,
        releaseInfo: cached.releaseInfo,
        genres: cached.genres,
        imdbRating: cached.imdbRating
      })
    };
  }

  try {
    const data = await apiGet(`/series/show/${serieId}/${API_KEY}`);

    const seasons = data.seasons || [];
    const sortedSeasons = [...seasons].sort(
      (a, b) => Number(a.season_number) - Number(b.season_number)
    );
    const firstSeason = sortedSeasons[0];
    const lastSeason = sortedSeasons[sortedSeasons.length - 1];

    // Stremio video objeleri: her bölüm için kendi id'si (stream handler ile uyumlu)
    const videos = [];
    for (const season of sortedSeasons) {
      const seasonNum = Number(season.season_number);
      for (const ep of season.episodes || []) {
        const epNum = Number(ep.episode_number);
        videos.push(
          removeNullish({
            id: buildVideoId(serieId, seasonNum, epNum),
            title: ep.name || `${epNum}. Bolum`,
            season: seasonNum,
            episode: epNum,
            overview: ep.overview,
            released: toIsoDate(ep.air_date)
          })
        );
      }
    }

    const meta = removeNullish({
      id,
      type: 'series',
      name: data.name || data.original_name,
      poster: data.poster_path?.replace('http://', 'https://'),
      background: data.backdrop_path_tv?.replace('http://', 'https://') ||
        data.backdrop_path?.replace('http://', 'https://'),
      description: data.overview,
      releaseInfo: buildReleaseInfo(
        data.first_air_date || firstSeason?.air_date,
        lastSeason?.air_date || data.first_air_date
      ),
      genres: data.genreslist && data.genreslist.length ? data.genreslist : data.genresname
        ? [data.genresname]
        : undefined,
      videos
    });

    return { meta };
  } catch (err) {
    console.error('Meta error', err);
    return { meta: {} };
  }
});

// STREAM HANDLER – dizi icin /series/show, film icin /media/detail kullanir
builder.defineStreamHandler(async ({ type, id }) => {
  console.log('[stream]', { type, id });
  const parsed = parseAddonId(id);
  if (!parsed?.serieId) {
    return { streams: [] };
  }

  const { serieId, seasonNumber, episodeNumber, contentType } = parsed;

  if (type === 'movie' || contentType === 'movie') {
    try {
      const data = await getMediaDetail(serieId);
      return { streams: buildStreamsFromVideos(data.videos) };
    } catch (err) {
      console.error('Movie stream error', err);
      return { streams: [] };
    }
  }

  if (type !== 'series' || contentType === 'anime') {
    return { streams: [] };
  }

  if (!serieId || !seasonNumber || !episodeNumber) {
    return { streams: [] };
  }

  try {
    const data = await apiGet(`/series/show/${serieId}/${API_KEY}`);

    const seasons = data.seasons || [];
    const season = seasons.find((s) => Number(s.season_number) === seasonNumber);
    if (!season) return { streams: [] };

    const episode = (season.episodes || []).find(
      (e) => Number(e.episode_number) === episodeNumber
    );
    if (!episode) return { streams: [] };

    return { streams: buildStreamsFromVideos(episode.videos) };
  } catch (err) {
    console.error('Stream error', err);
    return { streams: [] };
  }
});

const addonInterface = builder.getInterface();

export default addonInterface;

// Her zaman HTTP server başlat (Railway production dahil)
const PORT = process.env.PORT || 7010;
serveHTTP(addonInterface, { port: PORT }).then(() => {
  console.log(`✅ Sinewix addon listening on http://localhost:${PORT}/manifest.json`);
});
