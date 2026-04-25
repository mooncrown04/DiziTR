import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const VERSION = "7.0.0"; 
const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

// --- KATEGORİ VE KATALOG YAPILANDIRMASI ---
const HOME_CATALOGS = [
    { id: 'rectv-latest-series', type: 'series', name: 'RECTV Yeni Diziler', path: '/api/serie/by/filtres/0/created/0' },
    { id: 'rectv-latest-movies', type: 'movie', name: 'RECTV Yeni Filmler', path: '/api/movie/by/filtres/0/created/0' },
    { id: 'rectv-crime-series', type: 'series', name: 'RECTV Suç Dizileri', path: '/api/serie/by/filtres/5/created/0' },
    { id: 'rectv-crime-movies', type: 'movie', name: 'RECTV Suç Filmleri', path: '/api/movie/by/filtres/5/created/0' },
    { id: 'rectv-action-movies', type: 'movie', name: 'RECTV Aksiyon Filmleri', path: '/api/movie/by/filtres/1/created/0' }
];

const manifest = {
    id: "com.nuvio.rectv.v7",
    version: VERSION,
    name: "RECTV Full Scraper",
    description: "Sinewix Architecture for RecTV",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv", "tt"],
    catalogs: [
        ...HOME_CATALOGS.map(c => ({
            id: c.id,
            type: c.type,
            name: c.name,
            extra: [{ name: "skip" }]
        })),
        {
            id: "rectv-search",
            type: "series", // Nuvio aramayı buradan tetikler
            name: "RECTV Arama",
            extra: [{ name: "search", isRequired: true }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- AUTH ---
let cachedToken = null;
async function getAuthToken() {
    if (cachedToken) return cachedToken;
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const text = await res.text();
        cachedToken = text.includes("accessToken") ? JSON.parse(text).accessToken : text.trim();
        return cachedToken;
    } catch (e) { return null; }
}

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const token = await getAuthToken();
    const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    // 1. ARAMA MANTIĞI
    if (extra && extra.search) {
        try {
            const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            const items = type === "series" ? (data.series || []) : (data.posters || []);
            
            return {
                metas: items.map(item => ({
                    id: `rectv${type === "series" ? "s" : "m"}${item.id}`,
                    type: type,
                    name: item.title,
                    poster: item.image,
                    description: `RecTV | ${item.year || ''}`
                }))
            };
        } catch (e) { return { metas: [] }; }
    }

    // 2. ANA SAYFA KATALOGLARI
    const catalog = HOME_CATALOGS.find(c => c.id === id);
    if (catalog) {
        try {
            const res = await fetch(`${BASE_URL}${catalog.path}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            const items = Array.isArray(data) ? data : (data.posters || []);

            return {
                metas: items.slice(0, 20).map(item => ({
                    id: `rectv${catalog.type === "series" ? "s" : "m"}${item.id}`,
                    type: catalog.type,
                    name: item.title || item.name,
                    poster: item.image || item.thumbnail,
                    description: `RecTV | ${item.year || ''}`
                }))
            };
        } catch (e) { return { metas: [] }; }
    }

    return { metas: [] };
});

// --- META HANDLER (SCRAPER) ---
builder.defineMetaHandler(async ({ id, type }) => {
    const token = await getAuthToken();
    const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
    const rectvId = id.replace(/rectv[sm]/, "").split(":")[0];

    try {
        let meta = { id, type, videos: [] };

        if (type === "series") {
            // Detaylı sezon taraması (Scraper)
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${rectvId}/${SW_KEY}/`, { headers: authHeaders });
            const seasons = await res.json();

            seasons.forEach(s => {
                const sNum = parseInt(s.title.match(/\d+/) || 1);
                (s.episodes || []).forEach(ep => {
                    const eNum = parseInt(ep.title.match(/\d+/) || 1);
                    meta.videos.push({
                        id: `${id}:${sNum}:${eNum}`,
                        title: ep.title || `S${sNum} E${eNum}`,
                        season: sNum,
                        episode: eNum
                    });
                });
            });

            // İlk bölümden kapak verisini al
            if (seasons[0]) {
                meta.name = seasons[0].episodes?.[0]?.name || "Dizi Detay";
            }
        } else {
            // Film detayı
            const res = await fetch(`${BASE_URL}/api/movie/${rectvId}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            meta.name = data.title;
            meta.poster = data.image;
            meta.description = data.description;
        }

        return { meta };
    } catch (e) { return { meta: { id, type } }; }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ id, type }) => {
    const token = await getAuthToken();
    const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
    const parts = id.split(":");
    const rectvId = parts[0].replace(/rectv[sm]/, "");

    try {
        if (type === "series") {
            const [ , sNum, eNum] = parts;
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${rectvId}/${SW_KEY}/`, { headers: authHeaders });
            const seasons = await res.json();
            const season = seasons.find(s => parseInt(s.title.match(/\d+/) || 0) == sNum);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/) || 0) == eNum);

            return {
                streams: (episode?.sources || []).map((src, i) => ({
                    name: "RECTV",
                    title: `Kaynak ${i + 1} | ${episode.title}`,
                    url: src.url,
                    behaviorHints: { proxyHeaders: { "User-Agent": "okhttp/4.12.0" } }
                }))
            };
        } else {
            const res = await fetch(`${BASE_URL}/api/movie/${rectvId}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            return {
                streams: (data.sources || []).map((src, i) => ({
                    name: "RECTV",
                    title: `Film Kaynağı ${i + 1}`,
                    url: src.url
                }))
            };
        }
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
