import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "com.nuvio.rectv.final.v150",
    version: "150.0.0",
    name: "RECTV IMDb ID Matcher",
    description: "RecTV Afişleri + Gerçek IMDb ID Eşleşmesi",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        { id: "rectv-imdb-movies", type: "movie", name: "🎬 RECTV IMDb Filmler" }
    ]
};

const builder = new addonBuilder(manifest);

// --- GELİŞMİŞ EŞLEŞTİRME FONKSİYONU ---
async function getRealImdbId(title, year, type) {
    try {
        const searchType = type === 'series' ? 'tv' : 'movie';
        // TMDB araması (Hem Türkçe hem Orijinal isim kontrolü için dili boş bırakıyoruz bazen)
        const url = `https://api.themoviedb.org/3/search/${searchType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            // İlk sonucu alıp dış ID'lerini sorgula
            const extUrl = `https://api.themoviedb.org/3/${searchType}/${data.results[0].id}/external_ids?api_key=${TMDB_API_KEY}`;
            const extRes = await fetch(extUrl);
            const extData = await extRes.json();
            return extData.imdb_id; // "tt12345"
        }
    } catch (e) { return null; }
    return null;
}

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type }) => {
    try {
        const resNonce = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        const token = (await resNonce.text()).trim();

        // Kataloğu doldurmak için güncel bir arama
        const response = await fetch(`${BASE_URL}/api/search/2025/${SW_KEY}/`, { 
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` } 
        });
        const data = await response.json();
        const rawItems = data.posters || [];

        const metas = await Promise.all(rawItems.slice(0, 25).map(async (item) => {
            // Eşleştirme yapılıyor ama afiş RecTV'den kalıyor
            const imdbId = await getRealImdbId(item.title, item.sublabel, type);
            
            if (!imdbId) return null; // IMDb karşılığı olmayanları listede gösterme (Kaliteyi korur)

            return {
                id: imdbId, // ID artık gerçek tt12345
                type: type,
                name: item.title,
                poster: item.image, // Afiş IMDb'den DEĞİL, RecTV'den çekiliyor
                description: `Yıl: ${item.sublabel} (ID: ${imdbId})`
            };
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id }) => {
    // Nuvio'nun kendi metadata servisini kullanması için boş dönüyoruz 
    // ama id'yi tt olarak paslıyoruz.
    return { meta: { id } }; 
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ id, type }) => {
    try {
        const resNonce = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        const token = (await resNonce.text()).trim();
        const headers = { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` };

        // 1. ttID'den filmin ismini TMDB üzerinden geri çöz
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const movie = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];

        if (!movie) return { streams: [] };
        const targetTitle = movie.title || movie.name;

        // 2. RecTV'de bu isimle arama yap
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(targetTitle)}/${SW_KEY}/`, { headers });
        const sData = await sRes.json();
        
        // İsme göre en yakın sonucu bul
        const found = (sData.posters || []).find(p => 
            p.title.toLowerCase().includes(targetTitle.toLowerCase()) || 
            targetTitle.toLowerCase().includes(p.title.toLowerCase())
        );

        if (!found) return { streams: [] };

        // 3. Linkleri getir
        const res = await fetch(`${BASE_URL}/api/movie/${found.id}/${SW_KEY}/`, { headers });
        const finalData = await res.json();
        
        const streams = (finalData.sources || []).map(src => ({
            name: "RECTV",
            title: `${src.quality || "HD"} - ${src.title || "Kaynak"}`,
            url: src.url
        }));

        return { streams };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
