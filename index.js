import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0', // Python kodundaki UA ile güncelledim
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "com.nuvio.rectv.final.v200",
    version: "200.0.0",
    name: "RECTV Pro + Kategoriler",
    description: "Gerçek Kategoriler ve IMDb Eşleşmesi",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        { id: "rectv-son-filmler", type: "movie", name: "🎬 Son Filmler" },
        { id: "rectv-aksiyon", type: "movie", name: "🔥 Aksiyon Filmleri" },
        { id: "rectv-korku", type: "movie", name: "💀 Korku Filmleri" },
        { id: "rectv-son-diziler", type: "series", name: "🍿 Son Diziler" }
    ]
};

const builder = new addonBuilder(manifest);

// --- IMDb ID BULUCU (Öncekiyle aynı mantık) ---
async function getRealImdbId(title, year, type) {
    try {
        const cleanYear = year ? year.toString().match(/\d{4}/)?.[0] : null;
        const searchType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${searchType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}${cleanYear ? `&year=${cleanYear}` : ''}&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const extRes = await fetch(`https://api.themoviedb.org/3/${searchType}/${data.results[0].id}/external_ids?api_key=${TMDB_API_KEY}`);
            const extData = await extRes.json();
            return extData.imdb_id;
        }
    } catch (e) { return null; }
    return null;
}

// --- KATALOG HANDLER (Python kodundaki yeni yapıya göre) ---
builder.defineCatalogHandler(async ({ type, id }) => {
    // Kategori ID Belirleme (Python kodundaki listeye göre)
    let catId = "0"; // Default: Son Filmler
    if (id === "rectv-aksiyon") catId = "1";
    if (id === "rectv-korku") catId = "8";
    
    // URL Yapısı: /api/movie/by/filtres/{cat}/created/{page}/{key}/
    const subPath = type === 'series' ? 'serie' : 'movie';
    const targetUrl = `${BASE_URL}/api/${subPath}/by/filtres/${catId}/created/0/${SW_KEY}/`;

    try {
        const response = await fetch(targetUrl, { headers: FULL_HEADERS });
        const data = await response.json(); // Python kodunda 'veriler = istek.json()' direkt liste dönüyor
        
        // Veri direkt liste olarak geliyorsa (Python'daki gibi)
        const rawItems = Array.isArray(data) ? data : (data.posters || []);

        const metas = await Promise.all(rawItems.slice(0, 20).map(async (item) => {
            const imdbId = await getRealImdbId(item.title, item.year || item.sublabel, type);
            if (!imdbId) return null;

            return {
                id: imdbId,
                type: type,
                name: item.title,
                poster: item.image, // Afiş RecTV'den
                description: `RecTV ID: ${item.id}`
            };
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

// Meta ve Stream işleyicileri aynı kalıyor...
builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

builder.defineStreamHandler(async ({ id, type }) => {
    try {
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const movie = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        if (!movie) return { streams: [] };
        
        const targetTitle = movie.title || movie.name;
        // Stream için yine arama kullanıyoruz çünkü en stabil yol bu
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(targetTitle)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        const found = (sData.posters || []).find(p => p.title.toLowerCase().includes(targetTitle.toLowerCase()));

        if (!found) return { streams: [] };

        const res = await fetch(`${BASE_URL}/api/movie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const finalData = await res.json();
        return { streams: (finalData.sources || []).map(src => ({ name: "RECTV", title: src.quality || "HD", url: src.url })) };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
