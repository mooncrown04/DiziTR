import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const FULL_HEADERS = {
    'User-Agent': 'EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)',
    'Accept-Encoding': 'gzip',
    'Connection': 'Keep-Alive',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "org.rectv.pro.ultra.v35",
    version: "35.0.0",
    name: "RECTV Pro Ultra",
    description: "RecTV Scraper + Catalog Engine",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv", "tt"],
    catalogs: [
        { id: "rectv-movie", type: "movie", name: "🎬 RECTV Filmler" },
        { id: "rectv-series", type: "series", name: "🍿 RECTV Diziler" }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI: TOKEN ALICI ---
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        const token = await res.text();
        return token.trim();
    } catch (e) { return null; }
}

// --- KATALOG HANDLER (API'den film listesini çeker) ---
builder.defineCatalogHandler(async ({ type }) => {
    const token = await getAuthToken();
    let apiPath = type === 'movie' 
        ? `/api/movie/by/filtres/0/created/1/${SW_KEY}/` 
        : `/api/serie/by/filtres/0/created/1/${SW_KEY}/`;

    try {
        const response = await fetch(BASE_URL + apiPath, {
            headers: { ...FULL_HEADERS, 'Authorization': token ? `Bearer ${token}` : '' }
        });
        const data = await response.json();
        const rawItems = data.posters || data.series || [];

        const metas = rawItems.map(item => ({
            id: `rectv:${type}:${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.poster_path || item.image || item.thumbnail,
            description: "RECTV İçeriği"
        }));

        return { metas };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER (Detay sayfası) ---
builder.defineMetaHandler(async ({ id }) => {
    const [prefix, type, realId] = id.split(':');
    if (prefix !== 'rectv') return { meta: {} };

    const token = await getAuthToken();
    const endpoint = type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`;

    try {
        const response = await fetch(BASE_URL + endpoint, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        const meta = {
            id: id,
            type: type,
            name: data.title || data.name,
            poster: data.poster_path || data.image,
            background: data.backdrop_path || data.image,
            description: data.overview || data.description
        };

        if (type === 'series' && data.seasons) {
            meta.videos = data.seasons.flatMap(s => {
                const sNum = s.title.match(/\d+/)?.[0] || "1";
                return (s.episodes || []).map(e => ({
                    id: `${id}:${sNum}:${e.title.match(/\d+/)?.[0] || "1"}`,
                    title: e.title,
                    season: parseInt(sNum),
                    episode: parseInt(e.title.match(/\d+/)?.[0] || "1")
                }));
            });
        }
        return { meta };
    } catch (e) { return { meta: {} }; }
});

// --- STREAM HANDLER (Senin Kazıyıcı Mantığın) ---
builder.defineStreamHandler(async ({ type, id }) => {
    const token = await getAuthToken();
    const headers = { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` };
    let streams = [];

    try {
        // 1. Durum: Katalogdan tıklandıysa
        if (id.startsWith('rectv:')) {
            const [,, realId, sNum, eNum] = id.split(':');
            if (type === 'movie') {
                const res = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, { headers });
                const data = await res.json();
                (data.sources || []).forEach((src, i) => streams.push({ name: 'RECTV', title: `Kaynak ${i+1}`, url: src.url }));
            } else {
                const res = await fetch(`${BASE_URL}/api/season/by/serie/${realId}/${SW_KEY}/`, { headers });
                const seasons = await res.json();
                const targetS = seasons.find(s => s.title.includes(sNum));
                const targetE = targetS?.episodes.find(e => e.title.includes(eNum));
                (targetE?.sources || []).forEach((src, i) => streams.push({ name: 'RECTV', title: `Kaynak ${i+1}`, url: src.url }));
            }
        }
        // 2. Durum: TMDB Sayfasından (tt...) tıklandıysa (Scraper devreye girer)
        else if (id.startsWith('tt')) {
            const tmdbId = id.split(':')[0];
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}?api_key=4ef0d7355d9ffb5151e987764708ce96&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            const query = tmdbData.title || tmdbData.name;

            if (query) {
                const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(query)}/${SW_KEY}/`, { headers });
                const sData = await sRes.json();
                const found = (sData.posters || []).concat(sData.series || []).find(x => x.title.toLowerCase().includes(query.toLowerCase()));
                
                if (found) {
                    const dPath = type === 'movie' ? `/api/movie/${found.id}/${SW_KEY}/` : `/api/series/show/${found.id}/${SW_KEY}/`;
                    const r = await fetch(BASE_URL + dPath, { headers });
                    const d = await r.json();
                    (d.sources || []).forEach((src, i) => streams.push({ name: 'RECTV Scraper', title: `Kaynak ${i+1}`, url: src.url }));
                }
            }
        }
    } catch (e) {}

    return { streams };
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
