import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const VERSION = "6.0.0"; 
const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

const manifest = {
    id: "com.nuvio.rectv.v6",
    version: VERSION,
    name: "RECTV Pro Scraper V6",
    description: "Advanced Search & Scraper Sync",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv", "tt"], // Hem kendi ID'lerini hem IMDb'yi destekler
    catalogs: [
        { id: "rectv_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }] },
        { id: "rectv_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---
let cachedToken = null;
async function getAuthToken() {
    if (cachedToken) return cachedToken;
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const text = await res.text();
        cachedToken = text.includes("accessToken") ? JSON.parse(text).accessToken : text.trim();
        return cachedToken;
    } catch (e) { return null; }
}

// ID'leri ayrıştırmak için (Sinewix örneğindeki gibi)
function parseId(id) {
    if (id.startsWith("tt")) return { imdbId: id, type: id.includes(":") ? "series" : "movie" };
    const match = id.match(/rectv(s|m)(\d+)/);
    if (match) return { rectvId: match[2], type: match[1] === "s" ? "series" : "movie" };
    return null;
}

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, extra }) => {
    const token = await getAuthToken();
    const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    if (extra && extra.search) {
        try {
            const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            const rawItems = type === "series" ? (data.series || []) : (data.posters || []);

            const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
                // Her sonucu TMDB ile eşleştirip IMDb ID almaya çalışıyoruz
                const tmdbSearch = await fetch(`https://api.themoviedb.org/3/search/${type === 'series' ? 'tv' : 'movie'}?api_key=${TMDB_KEY}&query=${encodeURIComponent(item.title)}&language=tr-TR`);
                const tmdbData = await tmdbSearch.json();
                
                let finalId = `rectv${type === "series" ? "s" : "m"}${item.id}`; // Default ID
                let poster = item.image;

                if (tmdbData.results?.[0]) {
                    const t = tmdbData.results[0];
                    const ext = await fetch(`https://api.themoviedb.org/3/${type === 'series' ? 'tv' : 'movie'}/${t.id}/external_ids?api_key=${TMDB_KEY}`);
                    const extData = await ext.json();
                    if (extData.imdb_id) finalId = extData.imdb_id; // IMDb bulunduysa onu kullan
                    poster = t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : item.image;
                }

                return {
                    id: finalId,
                    type: type,
                    name: item.title,
                    poster: poster,
                    description: `Yıl: ${item.year || 'Bilinmiyor'}`
                };
            }));
            return { metas: metas.filter(m => m !== null) };
        } catch (e) { return { metas: [] }; }
    }
    return { metas: [] };
});

// --- META HANDLER (SCRAPER MANTIĞI) ---
builder.defineMetaHandler(async ({ id, type }) => {
    const parsed = parseId(id);
    const token = await getAuthToken();
    const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let metaData = { id, type, videos: [] };
        let queryTitle = "";

        // 1. Eğer IMDb ID ise TMDB'den detayları al
        if (id.startsWith("tt")) {
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/${type === "series" ? "tv" : "movie"}/${id.replace("tt","")}?api_key=${TMDB_KEY}&language=tr-TR`);
            const tmdb = await tmdbRes.json();
            queryTitle = tmdb.name || tmdb.title;
            metaData = {
                ...metaData,
                name: queryTitle,
                poster: `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`,
                background: `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}`,
                description: tmdb.overview
            };
        }

        // 2. SCRAPER: RecTV API'sinde bu içeriği bul ve bölümleri tara
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(queryTitle)}/${SW_KEY}/`, { headers: authHeaders });
        const sData = await sRes.json();
        const rectvItem = (type === "series" ? sData.series : sData.posters)?.find(x => x.title.toLowerCase().includes(queryTitle.toLowerCase()));

        if (rectvItem && type === "series") {
            const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${rectvItem.id}/${SW_KEY}/`, { headers: authHeaders });
            const seasons = await seasonRes.json();

            seasons.forEach(s => {
                const sNum = parseInt(s.title.match(/\d+/) || 1);
                (s.episodes || []).forEach(ep => {
                    const eNum = parseInt(ep.title.match(/\d+/) || 1);
                    metaData.videos.push({
                        id: `${id}:${sNum}:${eNum}`,
                        title: ep.title || `Sezon ${sNum} Bölüm ${eNum}`,
                        season: sNum,
                        episode: eNum,
                        released: new Date().toISOString()
                    });
                });
            });
        }
        return { meta: metaData };
    } catch (e) { return { meta: { id, type } }; }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ id, type }) => {
    const [mainId, sNum, eNum] = id.split(":");
    const token = await getAuthToken();
    const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        // İçerik ismini bul (Arama yapmak için)
        let title = "";
        if (mainId.startsWith("tt")) {
            const tmdb = await fetch(`https://api.themoviedb.org/3/${type === "series" ? "tv" : "movie"}/${mainId.replace("tt","")}?api_key=${TMDB_KEY}&language=tr-TR`).then(r => r.json());
            title = tmdb.name || tmdb.title;
        }

        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: authHeaders });
        const sData = await sRes.json();
        const rectvItem = (type === "series" ? sData.series : sData.posters)?.find(x => x.title.toLowerCase().includes(title.toLowerCase()));

        if (!rectvItem) return { streams: [] };

        if (type === "series") {
            const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${rectvItem.id}/${SW_KEY}/`, { headers: authHeaders });
            const seasons = await seasonRes.json();
            const targetSeason = seasons.find(s => parseInt(s.title.match(/\d+/) || 0) == sNum);
            const targetEp = targetSeason?.episodes.find(e => parseInt(e.title.match(/\d+/) || 0) == eNum);

            return {
                streams: (targetEp?.sources || []).map((src, i) => ({
                    name: "RECTV",
                    title: `Kaynak ${i + 1} | ${targetEp.label || 'HLS'}`,
                    url: src.url,
                    behaviorHints: { proxyHeaders: { "User-Agent": "okhttp/4.12.0" } }
                }))
            };
        } else {
            const det = await fetch(`${BASE_URL}/api/movie/${rectvItem.id}/${SW_KEY}/`, { headers: authHeaders }).then(r => r.json());
            return {
                streams: (det.sources || []).map((src, i) => ({
                    name: "RECTV",
                    title: `Film Kaynağı ${i + 1}`,
                    url: src.url
                }))
            };
        }
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
