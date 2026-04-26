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

const MOVIE_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4", "Drama": "8", "Korku": "10", "Dublaj": "26", "Altyazı": "27" };
const SERIES_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4", "Netflix": "33", "Exxen": "35" };
const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };

export const manifest = {
    id: "com.nuvio.rectv.v481",
    version: "4.8.1",
    name: "RECTV Pro",
    description: "TV: ch_İsim | Film-Dizi: IMDb tt ID",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "ch_"],
    catalogs: [
        { id: "rectv_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(SERIES_MAP) }] },
        { id: "rectv_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] },
        { id: "rectv_live", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "genre", options: Object.keys(TV_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- IMDb ID BULUCU (Sadece Film ve Dizi İçin) ---
async function findRealImdbId(title, year, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results?.[0]) {
            const ext = await fetch(`https://api.themoviedb.org/3/${sType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await ext.json();
            return extData.imdb_id;
        }
    } catch (e) { return null; }
    return null;
}

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    let rawItems = [];

    try {
        // 1. CANLI TV (Sadece isimle ID oluştur, IMDb arama yapma)
        if (type === "tv") {
            const gid = (extra?.genre) ? (TV_MAP[extra.genre] || "3") : "3";
            const res = await fetch(`${BASE_URL}/api/channel/by/filtres/${gid}/0/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            return { metas: (data || []).map(ch => ({ id: `ch_${ch.title || ch.name}`, type: "tv", name: ch.title || ch.name, poster: ch.image })) };
        }

        // 2. FİLM & DİZİ (IMDb ID zorunlu)
        if (extra?.search) {
            const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`);
            const data = await res.json();
            rawItems = (type === "series") ? (data.series || []) : (data.posters || []);
        } else {
            const path = type === 'series' ? 'serie' : 'movie';
            const gid = (extra?.genre) ? ((type === 'series' ? SERIES_MAP : MOVIE_MAP)[extra.genre] || "0") : "0";
            const res = await fetch(`${BASE_URL}/api/${path}/by/filtres/${gid}/created/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            rawItems = Array.isArray(data) ? data : (data.posters || []);
        }

        const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
            const imdbId = await findRealImdbId(item.title || item.name, item.year, type);
            if (!imdbId) return null;
            return { id: imdbId, type, name: item.title || item.name, poster: item.image || item.thumbnail };
        }));
        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

builder.defineMetaHandler(async ({ id, type }) => ({ meta: { id, type, name: id.startsWith("ch_") ? id.replace("ch_", "") : "Yükleniyor..." } }));

// --- STREAM HANDLER ---
export async function getStreams(args) {
    const { id, type } = args;
    try {
        // TV KANALLARI (ch_İsim yapısı)
        if (id.startsWith("ch_")) {
            const cName = id.replace("ch_", "");
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(cName)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const sData = await sRes.json();
            const found = (sData.channels || []).find(c => (c.title || c.name).toLowerCase() === cName.toLowerCase());
            if (found) {
                const res = await fetch(`${BASE_URL}/api/channel/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const data = await res.json();
                return (data.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url }));
            }
            return [];
        }

        // FİLM & DİZİ (IMDb ID tt... yapısı)
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const obj = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        if (!obj) return [];

        const title = obj.title || obj.name;
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        const pool = (type === 'series') ? (sData.series || []) : (sData.posters || []);
        const found = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase()));

        if (found) {
            const res = await fetch(`${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            return (data.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url }));
        }
    } catch (e) { return []; }
}

builder.defineStreamHandler(async (args) => ({ streams: await getStreams(args) }));

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
