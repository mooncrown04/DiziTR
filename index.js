import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const VERSION = "5.4.8"; // Versiyon güncellendi
const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

const CATEGORY_MAP = {
    "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4",
    "Suç": "5", "Drama": "8", "Korku": "8", "Gerilim": "9",
    "Gizem": "15", "Bilim-Kurgu": "16", "Türkçe Dublaj": "26", "Türkçe Altyazı": "27"
};

let cachedToken = null;

const manifest = {
    id: "com.nuvio.rectv.v547",
    version: VERSION,
    name: "RECTV Pro v18-Fix",
    description: "ID-Clean & Sezon Senkronizasyonu",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        {
            id: "rectv_series",
            type: "series",
            name: "🍿 RECTV Diziler",
            extra: [{ name: "search" }, { name: "genre", options: Object.keys(CATEGORY_MAP) }]
        },
        {
            id: "rectv_movie",
            type: "movie",
            name: "🎬 RECTV Filmler",
            extra: [{ name: "search" }, { name: "genre", options: Object.keys(CATEGORY_MAP) }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---

async function getAuthToken() {
    if (cachedToken) return cachedToken;
    try {
        const res = await fetch(BASE_URL + "/api/attest/nonce", { headers: HEADERS });
        const text = await res.text();
        try {
            const json = JSON.parse(text);
            cachedToken = json.accessToken || text.trim();
        } catch (e) { cachedToken = text.trim(); }
        return cachedToken;
    } catch (e) { return null; }
}

function analyzeStream(url, index, itemLabel) {
    const lowUrl = (url || "").toLowerCase();
    const lowLabel = (itemLabel || "").toLowerCase();
    let info = { icon: "🌐", text: "Altyazı" };

    if (lowLabel.includes("dublaj") || lowUrl.includes("dublaj")) {
        if (lowLabel.includes("altyazı") && index === 1) {
            info = { icon: "🌐", text: "Altyazı" };
        } else {
            info = { icon: "🇹🇷", text: "Dublaj" };
        }
    }
    return info;
}

// --- CATALOG HANDLER ---

builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    const token = await getAuthToken();
    const authHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });
    
    let rawItems = [];
    try {
        if (extra && extra.search) {
            const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            rawItems = type === "series" ? (data.series || []) : (data.posters || []);
        } else {
            const apiPath = type === 'series' ? 'serie' : 'movie';
            const genreId = extra?.genre ? (CATEGORY_MAP[extra.genre] || "0") : "0";
            const res = await fetch(`${BASE_URL}/api/${apiPath}/by/filtres/${genreId}/created/0/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            rawItems = Array.isArray(data) ? data : (data.posters || []);
        }

        const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
            const title = item.title || item.name;
            const searchType = type === 'series' ? 'tv' : 'movie';
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/${searchType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            
            if (tmdbData.results?.[0]) {
                const ext = await fetch(`https://api.themoviedb.org/3/${searchType}/${tmdbData.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
                const extData = await ext.json();
                if (extData.imdb_id) {
                    return {
                        id: extData.imdb_id, // Burası Nuvio'ya 'tt123' formatında gider (Manifest gereği)
                        type: type,
                        name: title,
                        poster: item.image || item.thumbnail,
                        description: `RecTV | ${item.year || item.sublabel || ''}`
                    };
                }
            }
            return null;
        }));
        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER (KRİTİK: SEZON LİSTESİNİ BURADA OLUŞTURUYORUZ) ---

builder.defineMetaHandler(async ({ id, type }) => {
    // ID'den tt temizleme (Sadece sayısal ID ile TMDB'ye sormak için)
    const cleanId = id.replace("tt", "");
    const searchType = type === "series" ? "tv" : "movie";

    let meta = { id, type };

    try {
        // TMDB'den sezon bilgilerini alıyoruz
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/${searchType}/${cleanId}?api_key=${TMDB_KEY}&language=tr-TR`);
        const tmdbData = await tmdbRes.json();

        meta.name = tmdbData.name || tmdbData.title;
        meta.poster = `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`;

        if (type === "series" && tmdbData.seasons) {
            // Nuvio'nun "dizi" olduğunu anlaması için videoları (sezon/bölüm) ekliyoruz
            meta.videos = [];
            tmdbData.seasons.forEach(s => {
                if (s.season_number === 0) return; // Special bölümleri geç
                for (let i = 1; i <= s.episode_count; i++) {
                    meta.videos.push({
                        id: `${id}:${s.season_number}:${i}`,
                        title: `Sezon ${s.season_number}, Bölüm ${i}`,
                        season: s.season_number,
                        episode: i,
                        released: new Date().toISOString()
                    });
                }
            });
        }
        return { meta };
    } catch (e) {
        return { meta };
    }
});

// --- STREAM HANDLER ---

builder.defineStreamHandler(async (args) => {
    // 1. ADIM: ID'Yİ TEMİZLE (tt var mı yok mu bakma, hepsini temizle)
    const rawId = args.id.split(":")[0];
    const cleanId = rawId.replace("tt", ""); 
    
    const isMovie = args.type === 'movie';
    const seasonNum = args.season || (args.id.includes(":") ? args.id.split(":")[1] : 1);
    const episodeNum = args.episode || (args.id.includes(":") ? args.id.split(":")[2] : 1);

    console.error(`[NUVIO_DEBUG] CleanID: ${cleanId} | S: ${seasonNum} | E: ${episodeNum}`);

    try {
        const token = await getAuthToken();
        const authHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });

        // TMDB Verisi
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${cleanId}?api_key=${TMDB_KEY}&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const trTitle = (tmdbData.title || tmdbData.name || "").trim();
        const orgTitle = (tmdbData.original_title || tmdbData.original_name || "").trim();

        if (!trTitle) return { streams: [] };

        let searchQueries = [trTitle];
        if (isMovie && orgTitle && orgTitle !== trTitle) searchQueries.push(orgTitle);

        let allItems = [];
        for (let q of searchQueries) {
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(q)}/${SW_KEY}/`, { headers: authHeaders });
            const sData = await sRes.json();
            allItems = allItems.concat((sData.series || []).concat(sData.posters || []));
        }

        let finalStreams = [];
        const searchTitleLower = trTitle.toLowerCase().trim();

        for (let target of allItems) {
            const targetTitleLower = target.title.toLowerCase().trim();
            
            // From gibi kısa isimler için kesin eşleşme
            let isMatch = (searchTitleLower === "from") 
                ? (targetTitleLower === "from" || targetTitleLower === "from dizi")
                : (targetTitleLower.includes(searchTitleLower));

            if (!isMatch) continue;

            const isActuallySerie = target.type === "serie" || (target.label && target.label.toLowerCase().includes("dizi"));
            if (isMovie && isActuallySerie) continue;
            if (!isMovie && !isActuallySerie) continue;

            if (isActuallySerie) {
                const sRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: authHeaders });
                const seasons = await sRes.json();
                for (let s of seasons) {
                    let sMatch = parseInt(s.title.match(/\d+/) || 0);
                    if (sMatch == seasonNum) {
                        for (let ep of s.episodes) {
                            let eMatch = parseInt(ep.title.match(/\d+/) || 0);
                            if (eMatch == episodeNum) {
                                (ep.sources || []).forEach((src, idx) => {
                                    const info = analyzeStream(src.url, idx, ep.label || s.title);
                                    finalStreams.push({
                                        name: "RECTV",
                                        title: `Kaynak ${idx + 1} | ${info.icon} ${info.text}`,
                                        url: src.url,
                                        behaviorHints: { notClickable: false, proxyHeaders: { "User-Agent": "okhttp/4.12.0" } }
                                    });
                                });
                            }
                        }
                    }
                }
            } else {
                let movieSources = target.sources || [];
                if (movieSources.length === 0) {
                    const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: authHeaders });
                    const detData = await detRes.json();
                    movieSources = detData.sources || [];
                }
                movieSources.forEach((src, idx) => {
                    const info = analyzeStream(src.url, idx, target.label);
                    finalStreams.push({
                        name: "RECTV",
                        title: `Kaynak ${idx + 1} | ${info.icon} ${info.text}`,
                        url: src.url
                    });
                });
            }
        }

        return { streams: finalStreams.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i) };
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
