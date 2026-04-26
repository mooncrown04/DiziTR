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

export const manifest = {
    id: "com.nuvio.rectv.v481",
    version: "4.8.1",
    name: "RECTV Pro",
    description: "Cinemeta Uyumlu Dizi ve Film Kataloğu",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "ch_"], // tt ile başlaması diğer eklentilerin tetiklenmesini sağlar
    catalogs: [
        { id: "rectv_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(SERIES_MAP) }] },
        { id: "rectv_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- TMDB Üzerinden IMDb ID ve Meta Verisi Bulma ---
async function getCinemetaStyleMeta(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const searchUrl = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`;
        const res = await fetch(searchUrl);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            const item = data.results[0];
            const extRes = await fetch(`https://api.themoviedb.org/3/${sType}/${item.id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await extRes.json();
            
            if (extData.imdb_id) {
                return {
                    // DİZİ İSE tt12345:1:1 FORMATI ŞART
                    id: type === 'series' ? `${extData.imdb_id}:1:1` : extData.imdb_id,
                    name: item.title || item.name,
                    poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                    description: item.overview,
                    releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4)
                };
            }
        }
    } catch (e) { return null; }
    return null;
}

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    let rawItems = [];

    try {
        // RECTV API'den verileri çek
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

        // Her öğeyi Cinemeta/IMDb formatına dönüştür
        const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
            const meta = await getCinemetaStyleMeta(item.title || item.name, type);
            if (meta) {
                return {
                    id: meta.id,
                    type: type,
                    name: meta.name,
                    poster: meta.poster,
                    description: meta.description,
                    releaseInfo: meta.releaseInfo
                };
            }
            // TMDB'de bulunamazsa RECTV verisiyle devam et (Yine de formatı koru)
            return {
                id: type === 'series' ? `rectv_${item.id}:1:1` : `rectv_${item.id}`,
                type: type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail
            };
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => {
    // Burada "Yükleniyor" yerine ID'den veya TMDB'den tekrar çekim yapılabilir
    return { meta: { id, type, name: "İçerik Seçildi", posterShape: "poster" } };
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const { id, type } = args;
    // Logdaki NUVIO_RAW_IN verisini burada kontrol et
    console.log(`[STREAM_REQ] ID: ${id} Type: ${type} S: ${args.season} E: ${args.episode}`);

    // ... (Geri kalan stream bulma mantığı yukarıdaki tt parçalama ile aynı)
    return { streams: [] }; 
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
