import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

// --- KATEGORİ HARİTALARI ---
const MOVIE_CATEGORY_MAP = {
    "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4",
    "Suç": "5", "Drama": "8", "Korku": "10", "Gerilim": "9",
    "Gizem": "15", "Bilim-Kurgu": "16", "Türkçe Dublaj": "26", "Türkçe Altyazı": "27"
};

const SERIES_CATEGORY_MAP = {
    "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4",
    "Suç": "5", "Drama": "8", "Korku": "10", "Gerilim": "9",
    "Gizem": "15", "Bilim-Kurgu": "16", "Netflix": "33", "Exxen": "35"
};

const TV_CATEGORY_MAP = {
    "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", 
    "Müzik": "5", "Sinema": "6", "Çocuk": "7", "Moda": "8"
};

export const manifest = {
    id: "com.nuvio.rectv.v452",
    version: "4.5.2",
    name: "RECTV Ultimate Scraper",
    description: "IMDb Scraper + Live TV + Multi Genres (ESM Fix)",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "ch_"],
    catalogs: [
        {
            id: "rectv_movie",
            type: "movie",
            name: "🎬 RECTV Filmler",
            extra: [{ name: "search" }, { name: "genre", options: Object.keys(MOVIE_CATEGORY_MAP) }]
        },
        {
            id: "rectv_series",
            type: "series",
            name: "🍿 RECTV Diziler",
            extra: [{ name: "search" }, { name: "genre", options: Object.keys(SERIES_CATEGORY_MAP) }]
        },
        {
            id: "rectv_live",
            type: "tv",
            name: "📺 RECTV Canlı TV",
            extra: [{ name: "genre", options: Object.keys(TV_CATEGORY_MAP) }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI: IMDb BULUCU ---
async function findRealImdbId(title, year, type) {
    try {
        const searchType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${searchType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const ext = await fetch(`https://api.themoviedb.org/3/${searchType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await ext.json();
            return extData.imdb_id;
        }
    } catch (e) { return null; }
    return null;
}

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    let rawItems = [];

    try {
        if (type === "tv") {
            const genreId = (extra && extra.genre) ? (TV_CATEGORY_MAP[extra.genre] || "1") : "1";
            const res = await fetch(`${BASE_URL}/api/channel/by/filtres/${genreId}/0/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            return {
                metas: (data || []).map(ch => ({
                    id: `ch_${ch.id}`,
                    type: "tv",
                    name: ch.title || ch.name,
                    poster: ch.image || "https://via.placeholder.com/300",
                    description: `${ch.category_name || 'Canlı Yayın'} - RECTV`
                }))
            };
        }

        if (extra && extra.search) {
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            const response = await fetch(searchUrl, { headers: FULL_HEADERS });
            const data = await response.json();
            rawItems = type === "series" ? (data.series || []) : (data.posters || []);
        } else {
            const apiPath = type === 'series' ? 'serie' : 'movie';
            const map = type === 'series' ? SERIES_CATEGORY_MAP : MOVIE_CATEGORY_MAP;
            const genreId = (extra && extra.genre) ? (map[extra.genre] || "0") : "0";
            const targetUrl = `${BASE_URL}/api/${apiPath}/by/filtres/${genreId}/created/0/${SW_KEY}/`;
            const response = await fetch(targetUrl, { headers: FULL_HEADERS });
            const data = await response.json();
            rawItems = Array.isArray(data) ? data : (data.posters || []);
        }

        const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
            const title = item.title || item.name;
            const year = item.year || item.sublabel;
            const imdbId = await findRealImdbId(title, year, type);
            if (!imdbId) return null;
            return {
                id: imdbId,
                type: type,
                name: title,
                poster: item.image || item.thumbnail,
                description: `RecTV | ${year || ''}`
            };
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => {
    if (id.startsWith("ch_")) return { meta: { id, type: "tv", name: "Canlı Kanal" } };
    try {
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const tmdbObj = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        if (!tmdbObj) return { meta: { id, type } };

        const meta = {
            id, type,
            name: tmdbObj.title || tmdbObj.name,
            background: `https://image.tmdb.org/t/p/original${tmdbObj.backdrop_path}`,
            poster: `https://image.tmdb.org/t/p/w500${tmdbObj.poster_path}`,
            description: tmdbObj.overview,
            videos: []
        };

        if (type === "series") {
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(meta.name)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const sData = await sRes.json();
            const found = (sData.series || []).find(p => (p.title || p.name).toLowerCase().includes(meta.name.toLowerCase()));
            if (found) {
                const res = await fetch(`${BASE_URL}/api/serie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const detail = await res.json();
                (detail.seasons || []).forEach(s => {
                    (s.episodes || []).forEach(e => {
                        meta.videos.push({
                            id: `${id}:${s.season_number || 1}:${e.episode_number || 1}`,
                            title: e.title || `${e.episode_number}. Bölüm`,
                            season: s.season_number || 1,
                            episode: e.episode_number || 1
                        });
                    });
                });
            }
        }
        return { meta };
    } catch (e) { return { meta: { id, type } }; }
});

// --- STREAM HANDLER ---
export async function getStreams(args) {
    const { id, type } = args;
    try {
        if (id.startsWith("ch_")) {
            const chId = id.replace("ch_", "");
            const res = await fetch(`${BASE_URL}/api/channel/${chId}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            return (data.sources || []).map(src => ({
                name: "RECTV LIVE",
                title: src.title || "Canlı Yayın",
                url: src.url
            }));
        }

        const [imdbId, sNum, eNum] = id.split(":");
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const tmdbObj = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        if (!tmdbObj) return [];

        const title = tmdbObj.title || tmdbObj.name;
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        const pool = type === 'series' ? (sData.series || []) : (sData.posters || []);
        const found = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase()));
        if (!found) return [];

        const apiPath = type === 'series' ? 'serie' : 'movie';
        const res = await fetch(`${BASE_URL}/api/${apiPath}/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const finalData = await res.json();

        if (type === "series" && sNum && eNum) {
            const season = (finalData.seasons || []).find(s => s.season_number == sNum);
            const episode = (season?.episodes || []).find(e => e.episode_number == eNum);
            return (episode?.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url }));
        } else {
            return (finalData.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url }));
        }
    } catch (e) { return []; }
}

builder.defineStreamHandler(async (args) => ({ streams: await getStreams(args) }));

// --- MODÜL ÇIKIŞLARI (ESM YAPISI) ---
export const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
