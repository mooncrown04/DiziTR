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

// Senin paylaştığın veriden alınan kesin ID eşleşmeleri
const CATEGORY_MAP = {
    "Korku": "8",
    "Gerilim": "9",
    "Gizem": "15",
    "Suç": "22",
    "Macera": "2",
    "Aksiyon": "1",
    "Komedi": "4",
    "Animasyon": "3",
    "Türkçe Dublaj": "26",
    "Türkçe Altyazı": "27"
};

const GENRES = Object.keys(CATEGORY_MAP);

const manifest = {
    id: "com.nuvio.rectv.v430",
    version: "4.3.0",
    name: "RECTV Pro Dual",
    description: "Kategori ID'leri Güncellendi",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        {
            id: "rectv_movie",
            type: "movie",
            name: "🎬 RECTV Filmler",
            extra: [{ name: "search" }, { name: "genre", options: GENRES }]
        },
        {
            id: "rectv_series",
            type: "series",
            name: "🍿 RECTV Diziler",
            extra: [{ name: "search" }, { name: "genre", options: GENRES }]
        }
    ]
};

const builder = new addonBuilder(manifest);

async function findRealImdbId(title, year, type) {
    try {
        const searchType = type === 'series' ? 'tv' : 'movie';
        const cleanYear = year ? year.toString().match(/\d{4}/)?.[0] : "";
        const url = `https://api.themoviedb.org/3/search/${searchType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}${cleanYear ? `&year=${cleanYear}` : ""}&language=tr-TR`;
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

builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    let rawItems = [];

    try {
        if (extra && extra.search) {
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            const response = await fetch(searchUrl, { headers: FULL_HEADERS });
            const data = await response.json();
            rawItems = (type === "series") ? (data.series || []) : (data.posters || []);
        } 
        else {
            const apiPath = type === 'series' ? 'serie' : 'movie';
            // Eğer kategori seçildiyse CATEGORY_MAP'ten ID alıyoruz, yoksa 0 (hepsi)
            const genreId = (extra && extra.genre) ? (CATEGORY_MAP[extra.genre] || "0") : "0";
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

builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

builder.defineStreamHandler(async ({ id, type }) => {
    try {
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const item = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        if (!item) return { streams: [] };
        
        const title = item.title || item.name;
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        
        const pool = type === 'series' ? (sData.series || []) : (sData.posters || []);
        const found = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase()));

        if (!found) return { streams: [] };

        const res = await fetch(`${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const finalData = await res.json();
        
        return { 
            streams: (finalData.sources || []).map(src => ({
                name: "RECTV",
                title: `${src.quality || "HD"} - ${src.title || "Kaynak"}`,
                url: src.url
            }))
        };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
