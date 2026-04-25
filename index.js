import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96"; // Standart TMDB Key

const FULL_HEADERS = {
    'User-Agent': 'EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "com.nuvio.rectv.imdb.v130",
    version: "130.0.0",
    name: "RECTV Real IMDb",
    description: "Gerçek IMDb ID Eşleştirmeli Katalog",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        { id: "rectv-imdb-movies", type: "movie", name: "🎬 Gerçek IMDb Filmler" }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI: İSİM VE YILDAN GERÇEK IMDb ID BULUCU ---
async function findImdbId(title, year, type) {
    try {
        const searchType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${searchType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&primary_release_year=${year}&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            const externalRes = await fetch(`https://api.themoviedb.org/3/${searchType}/${data.results[0].id}/external_ids?api_key=${TMDB_API_KEY}`);
            const externalData = await externalRes.json();
            return externalData.imdb_id; // tt1234567 döner
        }
    } catch (e) { return null; }
    return null;
}

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type }) => {
    const resNonce = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
    const token = (await resNonce.text()).trim();

    // Katalog dolması için genel bir arama yapıyoruz
    const searchUrl = `${BASE_URL}/api/search/2024/${SW_KEY}/`;
    const response = await fetch(searchUrl, { headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` } });
    const data = await response.json();
    
    const rawItems = data.posters || [];
    
    // Her bir RecTV sonucunu gerçek IMDb ID'siyle eşleştiriyoruz
    const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
        const realImdbId = await findImdbId(item.title, item.sublabel, type);
        
        return {
            // Eğer IMDb ID bulduysak onu kullanıyoruz, bulamazsak RecTV ID'sini tutuyoruz
            id: realImdbId || `rectv_${item.id}`, 
            type: type,
            name: item.title,
            poster: item.image,
            description: `${item.sublabel} - RECTV Kaynağı`
        };
    }));

    return { metas: metas.filter(m => m.id) };
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ id, type }) => {
    const resNonce = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
    const token = (await resNonce.text()).trim();
    const headers = { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` };

    let rectvId = null;

    // 1. Durum: ID zaten rectv_1405 gibi gelmişse direkt al
    if (id.startsWith('rectv_')) {
        rectvId = id.split('_')[1];
    } 
    // 2. Durum: ID gerçek tt12345 gibi gelmişse, isme göre RecTV'de ara
    else if (id.startsWith('tt')) {
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const movieData = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        
        if (movieData) {
            const title = movieData.title || movieData.name;
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers });
            const sData = await sRes.json();
            const found = (sData.posters || []).find(p => p.title.toLowerCase().includes(title.toLowerCase()));
            if (found) rectvId = found.id;
        }
    }

    if (!rectvId) return { streams: [] };

    // Linkleri getir
    const res = await fetch(`${BASE_URL}/api/movie/${rectvId}/${SW_KEY}/`, { headers });
    const finalData = await res.json();
    
    const streams = (finalData.sources || []).map(src => ({
        name: "RECTV",
        title: src.quality || "HD",
        url: src.url
    }));

    return { streams };
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
