import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const MOVIE_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4", "Drama": "8", "Korku": "10", "Dublaj": "26", "Altyazı": "27" };
const SERIES_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4", "Netflix": "33", "Exxen": "35" };
const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };

export const manifest = {
    id: "com.nuvio.rectv.v480",
    version: "4.8.0",
    name: "RECTV Pro",
    description: "Scraper Kaldırıldı | TV ch_İsim Yapısı",
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

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    let rawItems = [];

    try {
        // 1. CANLI TV (İstediğin ch_ATV formatı)
        if (type === "tv") {
            const genreId = (extra?.genre) ? (TV_MAP[extra.genre] || "3") : "3";
            const res = await fetch(`${BASE_URL}/api/channel/by/filtres/${genreId}/0/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            return { 
                metas: (data || []).map(ch => ({ 
                    id: `ch_${ch.title || ch.name}`, 
                    type: "tv", 
                    name: ch.title || ch.name, 
                    poster: ch.image,
                    description: `${ch.category_name || 'Canlı TV'}`
                })) 
            };
        }

        // 2. ARAMA & KATEGORİ (Scraper olmadan doğrudan RecTV verisi)
        if (extra?.search) {
            const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`);
            const data = await res.json();
            rawItems = (type === "series") ? (data.series || []) : (data.posters || []);
        } else {
            const apiPath = type === 'series' ? 'serie' : 'movie';
            const genreId = (extra?.genre) ? ((type === 'series' ? SERIES_MAP : MOVIE_MAP)[extra.genre] || "0") : "0";
            const res = await fetch(`${BASE_URL}/api/${apiPath}/by/filtres/${genreId}/created/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            rawItems = Array.isArray(data) ? data : (data.posters || []);
        }

        return {
            metas: rawItems.slice(0, 20).map(item => ({
                id: item.id.toString(), // RecTV ID'sini doğrudan kullanıyoruz
                type: type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail,
                description: `RecTV | ${item.year || item.sublabel || ''}`
            }))
        };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => {
    return { meta: { id, type, name: id.startsWith("ch_") ? id.replace("ch_", "") : "İçerik" } };
});

// --- STREAM HANDLER ---
export async function getStreams(args) {
    const { id, type } = args;
    try {
        // CANLI TV
        if (id.startsWith("ch_")) {
            const channelName = id.replace("ch_", "");
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(channelName)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const sData = await sRes.json();
            const found = (sData.channels || []).find(c => (c.title || c.name).toLowerCase() === channelName.toLowerCase());
            if (found) {
                const res = await fetch(`${BASE_URL}/api/channel/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const data = await res.json();
                return (data.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url }));
            }
            return [];
        }

        // FİLM & DİZİ (Doğrudan RecTV ID ile çekilir)
        const apiPath = type === 'series' ? 'serie' : 'movie';
        const res = await fetch(`${BASE_URL}/api/${apiPath}/${id}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const data = await res.json();
        return (data.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url }));

    } catch (e) { return []; }
}

builder.defineStreamHandler(async (args) => ({ streams: await getStreams(args) }));

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });

export default { getStreams };
