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

const MOVIE_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4" };
const SERIES_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Netflix": "33" };
const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4" };

export const manifest = {
    id: "com.nuvio.rectv.final.v1",
    version: "1.0.0",
    name: "RECTV Pro",
    description: "TV, Film ve Dizi Arama Düzeltmeli",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "ch_"],
    catalogs: [
        // DİKKAT: Her katalog için 'search' desteği ekledik
        { id: "rc_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(SERIES_MAP) }] },
        { id: "rc_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] },
        { id: "rc_live", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "search" }, { name: "genre", options: Object.keys(TV_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- IMDb ID BULUCU ---
async function findRealImdbId(title, type) {
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

// --- KATALOG HANDLER (ARAMA DÜZELTİLDİ) ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    
    try {
        // 1. CANLI TV ARAMASI VE LİSTELEME
        if (type === "tv") {
            let tvUrl = extra?.search 
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
                : `${BASE_URL}/api/channel/by/filtres/${TV_MAP[extra?.genre] || "3"}/0/0/${SW_KEY}/`;
            
            const res = await fetch(tvUrl, { headers: FULL_HEADERS });
            const data = await res.json();
            
            // Arama yaptıysak data.channels, filtre yaptıysak data'nın kendisi gelir
            const channels = extra?.search ? (data.channels || []) : (data || []);
            
            return {
                metas: channels.map(ch => ({
                    id: `ch_${ch.title || ch.name}`,
                    type: "tv",
                    name: ch.title || ch.name,
                    poster: ch.image
                }))
            };
        }

        // 2. FİLM & DİZİ ARAMASI VE LİSTELEME
        let rawItems = [];
        if (extra?.search) {
            const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`);
            const data = await res.json();
            rawItems = (type === "series") ? (data.series || []) : (data.posters || []);
        } else {
            const path = type === 'series' ? 'serie' : 'movie';
            const gid = (type === 'series' ? SERIES_MAP : MOVIE_MAP)[extra?.genre] || "0";
            const res = await fetch(`${BASE_URL}/api/${path}/by/filtres/${gid}/created/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            rawItems = Array.isArray(data) ? data : (data.posters || []);
        }

        const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
            const title = item.title || item.name;
            const imdbId = await findRealImdbId(title, type);
            if (!imdbId) return null;

            return { 
                id: type === 'series' ? `${imdbId}:1:1` : imdbId, 
                type: type, 
                name: title, 
                poster: item.image || item.thumbnail 
            };
        }));
        return { metas: metas.filter(m => m !== null) };

    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => ({
    meta: { 
        id, 
        type, 
        name: id.startsWith("ch_") ? id.replace("ch_", "") : "Yükleniyor...",
        posterShape: type === "tv" ? "landscape" : "poster"
    }
}));

// --- STREAM HANDLER (DIŞA AKTARILDI) ---
async function getStreams(args) {
    const { id, type } = args;
    try {
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
        } else {
            const pureId = id.split(':')[0];
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${pureId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            const obj = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
            if (obj) {
                const title = obj.title || obj.name;
                const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const sData = await sRes.json();
                const pool = (type === 'series') ? (sData.series || []) : (sData.posters || []);
                const found = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase().split(':')[0]));
                if (found) {
                    const res = await fetch(`${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                    const data = await res.json();
                    if (type === 'series' && args.season && args.episode) {
                        const targetS = (data.seasons || []).find(s => s.season_number == args.season);
                        const targetE = (targetS?.episodes || []).find(e => e.episode_number == args.episode);
                        if (targetE?.sources) return targetE.sources.map(src => ({ name: "RECTV", title: src.title, url: src.url }));
                    }
                    return (data.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url }));
                }
            }
        }
    } catch (e) { return []; }
    return [];
}

builder.defineStreamHandler(async (args) => ({ streams: await getStreams(args) }));

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
