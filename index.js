import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0', // Python kodundaki UA
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "com.nuvio.rectv.pro.v210",
    version: "210.0.0",
    name: "RECTV Pro Search",
    description: "IMDb Eşleşmeli Gelişmiş Arama",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        { id: "rectv-search", type: "movie", name: "🔎 RECTV Arama", extra: [{ name: "search", isRequired: true }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI: TMDB ÜZERİNDEN GERÇEK IMDb ID BULMA ---
async function findRealImdbId(title, year, type) {
    try {
        const searchType = type === 'series' ? 'tv' : 'movie';
        const cleanYear = year ? year.toString().match(/\d{4}/)?.[0] : "";
        const url = `https://api.themoviedb.org/3/search/${searchType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}${cleanYear ? `&primary_release_year=${cleanYear}` : ""}&language=tr-TR`;
        
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            const ext = await fetch(`https://api.themoviedb.org/3/${searchType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await ext.json();
            return extData.imdb_id; // tt1234567
        }
    } catch (e) { return null; }
    return null;
}

// --- KATALOG HANDLER (ARAMA ODAKLI) ---
builder.defineCatalogHandler(async ({ type, extra }) => {
    if (!extra.search) return { metas: [] };

    const searchPath = `/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
    try {
        const response = await fetch(`${BASE_URL}${searchPath}`, { headers: FULL_HEADERS });
        const data = await response.json();

        // Python kodundaki gibi tüm verileri (posters ve channels) birleştiriyoruz
        const rawItems = [
            ...(data.posters || []),
            ...(data.channels || []),
            ...(data.series || [])
        ];

        const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
            // İsim ve yıl karşılaştırması yaparak gerçek IMDb ID'sini bul
            const imdbId = await findRealImdbId(item.title || item.name, item.year || item.sublabel, type);
            
            if (!imdbId) return null;

            return {
                id: imdbId, // Nuvio artık gerçek ttID görüyor
                type: type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail,
                description: `${item.sublabel || ''} - RecTV Kaynağı`
            };
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

// Nuvio'nun IMDb verilerini kendi sisteminden çekmesi için boş handler
builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ id, type }) => {
    try {
        // 1. ttID'den filmin ismini TMDB'den geri al
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const movie = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        if (!movie) return { streams: [] };
        
        const title = movie.title || movie.name;

        // 2. Bu isimle RecTV'de ara ve linki çek
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        const found = (sData.posters || []).find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase()));

        if (!found) return { streams: [] };

        const res = await fetch(`${BASE_URL}/api/movie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const finalData = await res.json();
        
        return { 
            streams: (finalData.sources || []).map(src => ({
                name: "RECTV",
                title: src.quality || "HD",
                url: src.url
            }))
        };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
