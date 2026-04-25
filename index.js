import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const VERSION = "5.6.0"; 
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
    id: "com.nuvio.rectv.v547",
    version: VERSION,
    name: "RECTV Pro v18-Scraper",
    description: "Auto-Scraper & IMDb Series Sync",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        { id: "rectv_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }] },
        { id: "rectv_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- AUTH SCRAPER ---
let cachedToken = null;
async function getAuthToken() {
    if (cachedToken) return cachedToken;
    try {
        const res = await fetch(BASE_URL + "/api/attest/nonce", { headers: HEADERS });
        const text = await res.text();
        cachedToken = text.includes("accessToken") ? JSON.parse(text).accessToken : text.trim();
        return cachedToken;
    } catch (e) { return null; }
}

// --- META HANDLER (SCRAPER ÖZELLİĞİ BURADA) ---
builder.defineMetaHandler(async ({ id, type }) => {
    if (!id.startsWith("tt")) return { meta: { id, type } };

    const cleanId = id.replace("tt", "");
    const searchType = type === "series" ? "tv" : "movie";

    try {
        // 1. TMDB Verisi Çek (Cihazı doyurmak için)
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/${searchType}/${cleanId}?api_key=${TMDB_KEY}&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const trTitle = tmdbData.name || tmdbData.title;

        let meta = {
            id: id,
            type: type,
            name: trTitle,
            poster: `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`,
            background: `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}`,
            description: tmdbData.overview,
            videos: []
        };

        if (type === "series") {
            const token = await getAuthToken();
            const authHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });
            
            // 2. SCRAPER: RecTV'de bu diziyi bul ve sezonlarını tara
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(trTitle)}/${SW_KEY}/`, { headers: authHeaders });
            const sData = await sRes.json();
            const rectvItem = (sData.series || []).find(x => x.title.toLowerCase().includes(trTitle.toLowerCase()));

            if (rectvItem) {
                // Dizinin sezonlarını API'den çekiyoruz (DiziPal örneğindeki gibi)
                const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${rectvItem.id}/${SW_KEY}/`, { headers: authHeaders });
                const seasons = await seasonRes.json();

                seasons.forEach(s => {
                    const sNum = parseInt(s.title.match(/\d+/) || 1);
                    (s.episodes || []).forEach(ep => {
                        const eNum = parseInt(ep.title.match(/\d+/) || 1);
                        meta.videos.push({
                            id: `${id}:${sNum}:${eNum}`, // tt123:1:1
                            title: ep.title || `S${sNum} E${eNum}`,
                            season: sNum,
                            episode: eNum,
                            released: new Date().toISOString()
                        });
                    });
                });
            } else {
                // Eğer RecTV'de henüz yoksa TMDB'den boş iskelet oluştur (Nuvio filme kaçmasın diye)
                tmdbData.seasons.filter(s => s.season_number > 0).forEach(s => {
                    for (let i = 1; i <= s.episode_count; i++) {
                        meta.videos.push({
                            id: `${id}:${s.season_number}:${i}`,
                            title: `S${s.season_number} E${i} (Kaynak Bekleniyor)`,
                            season: s.season_number,
                            episode: i
                        });
                    }
                });
            }
        }
        return { meta };
    } catch (e) { return { meta: { id, type } }; }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const cleanId = args.id.split(":")[0].replace("tt", "");
    const isMovie = args.type === 'movie';
    const [ , seasonNum, episodeNum] = args.id.split(":");

    try {
        const token = await getAuthToken();
        const authHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });

        const tmdbRes = await fetch(`https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${cleanId}?api_key=${TMDB_KEY}&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const trTitle = (tmdbData.title || tmdbData.name || "").trim();

        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(trTitle)}/${SW_KEY}/`, { headers: authHeaders });
        const sData = await sRes.json();
        const allItems = (sData.series || []).concat(sData.posters || []);

        let streams = [];
        for (let target of allItems) {
            if (!target.title.toLowerCase().includes(trTitle.toLowerCase())) continue;

            if (target.type === "serie" && !isMovie) {
                const sRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: authHeaders });
                const seasons = await sRes.json();
                const targetSeason = seasons.find(s => parseInt(s.title.match(/\d+/) || 0) == (seasonNum || 1));
                if (targetSeason) {
                    const targetEp = targetSeason.episodes.find(e => parseInt(e.title.match(/\d+/) || 0) == (episodeNum || 1));
                    if (targetEp) {
                        (targetEp.sources || []).forEach((src, idx) => {
                            streams.push({
                                name: "RECTV",
                                title: `Kaynak ${idx + 1} | 📺 S${seasonNum} E${episodeNum}`,
                                url: src.url,
                                behaviorHints: { proxyHeaders: { "User-Agent": "okhttp/4.12.0" } }
                            });
                        });
                    }
                }
            } else if (isMovie && target.type !== "serie") {
                const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: authHeaders });
                const detData = await detRes.json();
                (detData.sources || []).forEach((src, idx) => {
                    streams.push({ name: "RECTV", title: `Film Kaynak ${idx + 1}`, url: src.url });
                });
            }
        }
        return { streams };
    } catch (e) { return { streams: [] }; }
});

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    const token = await getAuthToken();
    const authHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });
    
    if (extra && extra.search) {
        const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`, { headers: authHeaders });
        const data = await res.json();
        const rawItems = type === "series" ? (data.series || []) : (data.posters || []);

        const metas = await Promise.all(rawItems.slice(0, 10).map(async (item) => {
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/${type === 'series' ? 'tv' : 'movie'}?api_key=${TMDB_KEY}&query=${encodeURIComponent(item.title)}&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            if (tmdbData.results?.[0]) {
                const ext = await fetch(`https://api.themoviedb.org/3/${type === 'series' ? 'tv' : 'movie'}/${tmdbData.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
                const extData = await ext.json();
                if (extData.imdb_id) {
                    return {
                        id: extData.imdb_id,
                        type: type,
                        name: item.title,
                        poster: `https://image.tmdb.org/t/p/w500${tmdbData.results[0].poster_path}`,
                        description: `RecTV Scraper | ${item.year || ''}`
                    };
                }
            }
            return null;
        }));
        return { metas: metas.filter(m => m !== null) };
    }
    // Varsayılan katalog boş dönebilir veya RecTV ana sayfa api'sine bağlanabilir
    return { metas: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
