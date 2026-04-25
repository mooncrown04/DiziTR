import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const VERSION = "5.4.6";
const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

let cachedToken = null;

const manifest = {
    id: "com.nuvio.rectv.v546",
    version: VERSION,
    name: `RECTV v${VERSION}`,
    description: "Auth Token & Auto Dublaj/Altyazı Desteği",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        { id: "rectv_movie", type: "movie", name: "🎬 Filmler" },
        { id: "rectv_series", type: "series", name: "🍿 Diziler" }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR (Paylaştığın Koddan Alındı) ---

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

// --- STREAM HANDLER ---

builder.defineStreamHandler(async (args) => {
    const cleanId = args.id.split(":")[0];
    const isMovie = args.type === 'movie';
    const seasonNum = args.season || (args.id.includes(":") ? args.id.split(":")[1] : null);
    const episodeNum = args.episode || (args.id.includes(":") ? args.id.split(":")[2] : null);

    try {
        // 1. TMDB Bilgilerini Al
        const tmdbUrl = `https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${cleanId}?language=tr-TR&api_key=${TMDB_KEY}`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        
        const trTitle = (tmdbData.title || tmdbData.name || "").trim();
        const orgTitle = (tmdbData.original_title || tmdbData.original_name || "").trim();
        if (!trTitle) return { streams: [] };

        // 2. Auth Token ve Arama
        const token = await getAuthToken();
        const searchHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });
        
        let searchQueries = [trTitle];
        if (isMovie && orgTitle && orgTitle !== trTitle) searchQueries.push(orgTitle);

        let allItems = [];
        for (let q of searchQueries) {
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(q)}/${SW_KEY}/`;
            const sRes = await fetch(searchUrl, { headers: searchHeaders });
            const sData = await sRes.json();
            const found = (sData.series || []).concat(sData.posters || []);
            if (found.length > 0) {
                allItems = allItems.concat(found);
                if (isMovie) break;
            }
        }

        let finalStreams = [];
        const searchTitleLower = trTitle.toLowerCase().trim();

        for (let target of allItems) {
            const targetTitleLower = target.title.toLowerCase().trim();
            
            // Kesin Eşleşme ve Tip Kontrolü
            let isMatch = (searchTitleLower === "from") 
                ? (targetTitleLower === "from" || targetTitleLower === "from dizi")
                : (targetTitleLower.includes(searchTitleLower));

            if (!isMatch) continue;

            const isActuallySerie = target.type === "serie" || (target.label && target.label.toLowerCase().includes("dizi"));
            if (isMovie && isActuallySerie) continue;
            if (!isMovie && !isActuallySerie) continue;

            if (isActuallySerie) {
                // DIZI MANTIGI
                const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
                const seasons = await seasonRes.json();
                for (let s of seasons) {
                    let sNumber = parseInt(s.title.match(/\d+/) || 0);
                    if (sNumber == seasonNum) {
                        for (let ep of s.episodes) {
                            let epNumber = parseInt(ep.title.match(/\d+/) || 0);
                            if (epNumber == episodeNum) {
                                (ep.sources || []).forEach((src, idx) => {
                                    const info = analyzeStream(src.url, idx, ep.label || s.title || target.label);
                                    finalStreams.push({
                                        name: "RECTV",
                                        title: `Kaynak ${idx + 1} | ${info.icon} ${info.text}`,
                                        url: src.url,
                                        behaviorHints: { notClickable: false }
                                    });
                                });
                            }
                        }
                    }
                }
            } else {
                // FILM MANTIGI
                let movieSources = target.sources || [];
                if (movieSources.length === 0) {
                    const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
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

        // Tekilleştirme
        return { streams: finalStreams.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i) };

    } catch (err) {
        return { streams: [] };
    }
});

// Katalog ve Meta (Boş bırakıldı, Nuvio meta bilgisi için sadece define etmek yeterli)
builder.defineMetaHandler(async (args) => ({ meta: { id: args.id, type: args.type, name: "Yükleniyor..." } }));
builder.defineCatalogHandler(async (args) => {
    // Katalog listeleme mantığı isteğe göre doldurulabilir. 
    // Şu anlık boş meta dönerek sadece stream odaklı çalışır.
    return { metas: [] }; 
});

serveHTTP(builder.getInterface(), { port: PORT });
