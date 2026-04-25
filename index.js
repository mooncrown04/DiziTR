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
    id: "com.nuvio.rectv.hybrid.v230",
    version: "230.0.0",
    name: "RECTV Hybrid (Film+Dizi)",
    description: "Film ve Diziler Bir Arada - IMDb ttID",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        { 
            id: "rectv-hybrid-main", 
            type: "movie", 
            name: "🎬 RECTV Hepsi", 
            extra: [{ name: "search" }] 
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI: TMDB EŞLEŞTİRME ---
async function findRealImdbId(title, year, type) {
    try {
        const cleanYear = year ? year.toString().match(/\d{4}/)?.[0] : "";
        const searchType = type === 'series' ? 'tv' : 'movie';
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

// --- KATALOG & ARAMA HANDLER ---
builder.defineCatalogHandler(async ({ extra }) => {
    let combinedItems = [];

    try {
        if (extra && extra.search) {
            // ARAMA DURUMU: Film ve Dizileri tek aramada çek
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            const response = await fetch(searchUrl, { headers: FULL_HEADERS });
            const data = await response.json();
            // posters (filmler) + series (diziler) + channels (kanallar) birleşimi
            combinedItems = [
                ...(data.posters || []).map(i => ({ ...i, type: 'movie' })),
                ...(data.series || []).map(i => ({ ...i, type: 'series' })),
                ...(data.channels || []).map(i => ({ ...i, type: 'movie' }))
            ];
        } else {
            // KATALOG DURUMU: Hem son filmleri hem son dizileri çekip birleştir
            const movieUrl = `${BASE_URL}/api/movie/by/filtres/0/created/0/${SW_KEY}/`;
            const seriesUrl = `${BASE_URL}/api/serie/by/filtres/0/created/0/${SW_KEY}/`;

            const [mRes, sRes] = await Promise.all([
                fetch(movieUrl, { headers: FULL_HEADERS }),
                fetch(seriesUrl, { headers: FULL_HEADERS })
            ]);

            const mData = await mRes.json();
            const sData = await sRes.json();

            combinedItems = [
                ...(Array.isArray(mData) ? mData : (mData.posters || [])).map(i => ({ ...i, type: 'movie' })),
                ...(Array.isArray(sData) ? sData : (sData.posters || [])).map(i => ({ ...i, type: 'series' }))
            ];
        }

        // IMDb ttID eşleştirmesi
        const metas = await Promise.all(combinedItems.slice(0, 30).map(async (item) => {
            const title = item.title || item.name;
            const year = item.year || item.sublabel;
            const imdbId = await findRealImdbId(title, year, item.type);

            if (!imdbId) return null;

            return {
                id: imdbId,
                type: item.type,
                name: title,
                poster: item.image || item.thumbnail,
                description: `Tür: ${item.type === 'movie' ? 'Film' : 'Dizi'} | ${year || ''}`
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
        const searchType = type === 'series' ? 'tv' : 'movie';
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const movie = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        
        if (!movie) return { streams: [] };
        const title = movie.title || movie.name;

        // RecTV'de ara
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        
        // Türüne göre doğru yerden bul (posters veya series)
        const pool = type === 'series' ? (sData.series || []) : (sData.posters || []);
        const found = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase()));

        if (!found) return { streams: [] };

        // Linkleri getir (Dizi ise bölüm yapısı, film ise direkt kaynaklar)
        // Şimdilik film mantığıyla kaynakları çekiyoruz
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
