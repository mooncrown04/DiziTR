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
    id: "com.nuvio.rectv.tvmode.v320",
    version: "3.2.0",
    name: "RECTV Pro",
    description: "Film ve TV Katalogları Ayrıştırıldı",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "tv"], // series yerine tv kullanıyoruz
    idPrefixes: ["tt"],
    catalogs: [
        {
            id: "rectv_movie_search", 
            type: "movie",
            name: "RECTV",
            extra: [{ name: "search", isRequired: false }]
        },
        {
            id: "rectv_tv_search", 
            type: "tv", // Tetikleyiciyi tv yaptık
            name: "RECTV",
            extra: [{ name: "search", isRequired: false }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- IMDb ID BULUCU ---
async function findRealImdbId(title, year, type) {
    try {
        // TMDB'de dizi araması için 'tv' kullanılır
        const searchType = type === 'tv' ? 'tv' : 'movie';
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

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const { type, id, extra } = args;
    let rawItems = [];

    try {
        if (extra && extra.search) {
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            const response = await fetch(searchUrl, { headers: FULL_HEADERS });
            const data = await response.json();

            // Arama sonuçlarında RecTV 'series' içinde dizi döner
            if (id === "rectv_movie_search") {
                rawItems = data.posters || [];
            } else if (id === "rectv_tv_search") {
                rawItems = data.series || []; // RecTV'nin dizilerini tv kataloğuna basıyoruz
            }
        } else {
            // Ana sayfa: Diziler için hala 'serie' API endpointini kullanıyoruz
            const apiPath = type === 'tv' ? 'serie' : 'movie';
            const targetUrl = `${BASE_URL}/api/${apiPath}/by/filtres/0/created/0/${SW_KEY}/`;
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
                description: `RecTV ${type === 'tv' ? 'Dizi' : 'Film'} | ${year || ''}`
            };
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (e) {
        return { metas: [] };
    }
});

builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ id, type }) => {
    try {
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const movie = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        if (!movie) return { streams: [] };
        
        const title = movie.title || movie.name;
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        
        // Havuz seçimi: tv ise series listesine bak
        const pool = type === 'tv' ? (sData.series || []) : (sData.posters || []);
        const found = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase()));

        if (!found) return { streams: [] };

        // Link alma: tv ise 'serie' endpointine git
        const res = await fetch(`${BASE_URL}/api/${type === 'tv' ? 'serie' : 'movie'}/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
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
