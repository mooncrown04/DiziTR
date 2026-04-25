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

const manifest = {
    id: "com.nuvio.rectv.onlyseries.v330",
    version: "3.3.0",
    name: "RECTV Dizi Test",
    description: "Sadece Dizi Katalogu Test Sürümü",
    resources: ["catalog", "meta", "stream"],
    types: ["series"], // Sadece series aktif
    idPrefixes: ["tt"],
    catalogs: [
        {
            id: "rectv_series_only", 
            type: "series",
            name: "🍿 RECTV Diziler",
            extra: [{ name: "search", isRequired: false }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- IMDb ID BULUCU (Dizi Odaklı) ---
async function findRealImdbId(title, year) {
    try {
        const cleanYear = year ? year.toString().match(/\d{4}/)?.[0] : "";
        const url = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}${cleanYear ? `&year=${cleanYear}` : ""}&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const ext = await fetch(`https://api.themoviedb.org/3/tv/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await ext.json();
            return extData.imdb_id;
        }
    } catch (e) { return null; }
    return null;
}

// --- KATALOG HANDLER (SADECE DİZİ) ---
builder.defineCatalogHandler(async (args) => {
    const { extra } = args;
    let rawItems = [];

    try {
        if (extra && extra.search) {
            // ARAMA: Sadece series havuzuna bakıyoruz
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            const response = await fetch(searchUrl, { headers: FULL_HEADERS });
            const data = await response.json();
            rawItems = data.series || []; 
        } else {
            // ANA SAYFA: Sadece dizi API'sine gidiyoruz
            const targetUrl = `${BASE_URL}/api/serie/by/filtres/0/created/0/${SW_KEY}/`;
            const response = await fetch(targetUrl, { headers: FULL_HEADERS });
            const data = await response.json();
            rawItems = Array.isArray(data) ? data : (data.posters || []);
        }

        const metas = await Promise.all(rawItems.slice(0, 20).map(async (item) => {
            const title = item.title || item.name;
            const year = item.year || item.sublabel;
            const imdbId = await findRealImdbId(title, year);
            if (!imdbId) return null;

            return {
                id: imdbId,
                type: "series",
                name: title,
                poster: item.image || item.thumbnail,
                description: `RECTV Dizi | ${year || ''}`
            };
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (e) {
        return { metas: [] };
    }
});

builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

// --- STREAM HANDLER (SADECE DİZİ) ---
builder.defineStreamHandler(async ({ id }) => {
    try {
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const show = tmdbData.tv_results?.[0];
        if (!show) return { streams: [] };
        
        const title = show.name;
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        
        const found = (sData.series || []).find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase()));
        if (!found) return { streams: [] };

        const res = await fetch(`${BASE_URL}/api/serie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
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
