import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';
import NodeCache from 'node-cache';

const PORT = process.env.PORT || 7010;
const cache = new NodeCache({ stdTTL: 1800 });

// --- AYARLAR ---
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

// --- MANIFEST ---
const manifest = {
    id: "org.rectv.pro.v18.final",
    version: "18.0.0",
    name: "RECTV Pro",
    description: "RecTV Sinewix Style - Film, Dizi ve Canlı TV",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv", "tt"],
    catalogs: [
        { id: "rectv-movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "skip" }] },
        { id: "rectv-series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "skip" }] },
        { id: "rectv-tv", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "skip" }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---
async function getAuthToken() {
    const cached = cache.get("token");
    if (cached) return cached;
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const token = await res.text();
        const cleanToken = token.trim();
        cache.set("token", cleanToken);
        return cleanToken;
    } catch (e) { return null; }
}

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = extra?.skip || 0;
    const page = Math.floor(skip / 20) + 1;
    const token = await getAuthToken();

    let apiPath = "";
    if (id === "rectv-movie") apiPath = `/api/movie/by/filtres/0/created/${page}/${SW_KEY}/`;
    else if (id === "rectv-series") apiPath = `/api/serie/by/filtres/0/created/${page}/${SW_KEY}/`;
    else if (id === "rectv-tv") apiPath = `/api/channel/by/filtres/0/0/${page}/${SW_KEY}/`;

    if (!apiPath) return { metas: [] };

    try {
        const response = await fetch(BASE_URL + apiPath, {
            headers: { ...HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const items = data.posters || data.series || data.channels || [];

        const metas = items.map(item => ({
            id: `rectv:${type}:${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.poster_path || item.image || item.thumbnail,
            description: item.label || "RECTV"
        }));

        return { metas };
    } catch (e) {
        return { metas: [] };
    }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ type, id }) => {
    const [prefix, mType, realId] = id.split(':');
    if (prefix !== 'rectv') return { meta: {} };

    const token = await getAuthToken();
    let endpoint = mType === 'tv' ? `/api/channel/${realId}/${SW_KEY}/` :
                   mType === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` :
                   `/api/series/show/${realId}/${SW_KEY}/`;

    try {
        const response = await fetch(BASE_URL + endpoint, {
            headers: { ...HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        const meta = {
            id: id,
            type: type,
            name: data.title || data.name,
            poster: data.poster_path || data.image || data.thumbnail,
            background: data.backdrop_path || data.image,
            description: data.overview || data.description
        };

        if (mType === 'series' && data.seasons) {
            meta.videos = data.seasons.flatMap(s => {
                const sNum = s.title.match(/\d+/)?.[0] || "1";
                return (s.episodes || []).map(e => ({
                    id: `${id}:${sNum}:${e.title.match(/\d+/)?.[0] || "1"}`,
                    title: e.title,
                    season: parseInt(sNum),
                    episode: parseInt(e.title.match(/\d+/)?.[0] || "1"),
                    released: new Date().toISOString()
                }));
            });
        }
        return { meta };
    } catch (e) {
        return { meta: {} };
    }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ type, id }) => {
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
    let streams = [];

    // 1. Durum: Kendi kataloğumuzdan gelen ID (rectv:type:id...)
    if (id.startsWith('rectv:')) {
        const parts = id.split(':');
        const mType = parts[1];
        const realId = parts[2];

        try {
            if (mType === 'tv') {
                const r = await fetch(`${BASE_URL}/api/channel/${realId}/${SW_KEY}/`, { headers });
                const d = await r.json();
                if (d.url) streams.push({ name: 'RECTV', title: 'Canlı TV', url: d.url });
            } else if (mType === 'movie') {
                const r = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, { headers });
                const d = await r.json();
                (d.sources || []).forEach((src, i) => streams.push({ name: 'RECTV', title: `Kaynak ${i+1}`, url: src.url }));
            } else if (mType === 'series' && parts.length === 5) {
                const r = await fetch(`${BASE_URL}/api/season/by/serie/${realId}/${SW_KEY}/`, { headers });
                const seasons = await r.json();
                const targetS = seasons.find(s => s.title.includes(parts[3]));
                const targetE = targetS?.episodes.find(e => e.title.includes(parts[4]));
                (targetE?.sources || []).forEach((src, i) => streams.push({ name: 'RECTV', title: `Kaynak ${i+1}`, url: src.url }));
            }
        } catch (e) {}
    } 
    // 2. Durum: Stremio ana sayfasından (TMDB) gelen ID (tt12345)
    else if (id.startsWith('tt')) {
        try {
            const tmdbId = id.split(':')[0];
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}?api_key=${TMDB_API_KEY}&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            const title = tmdbData.title || tmdbData.name;

            if (title) {
                const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers });
                const sData = await sRes.json();
                const found = (sData.posters || []).concat(sData.series || []).find(item => item.title.includes(title));
                
                if (found) {
                    // Bulunan içeriğin yayınlarını çek (Basitleştirilmiş)
                    const detPath = type === 'movie' ? `/api/movie/${found.id}/${SW_KEY}/` : `/api/series/show/${found.id}/${SW_KEY}/`;
                    const r = await fetch(BASE_URL + detPath, { headers });
                    const d = await r.json();
                    const sources = type === 'movie' ? (d.sources || []) : []; // Diziler için sezon/bölüm eşleşmesi gerekir
                    sources.forEach((src, i) => streams.push({ name: 'RECTV', title: `TMDB Kaynak ${i+1}`, url: src.url }));
                }
            }
        } catch (e) {}
    }

    return { streams };
});

// --- SERVER ---
const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT }).then(() => {
    console.log(`✅ RECTV Pro Fixed listening on port ${PORT}`);
});
