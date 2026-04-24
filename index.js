import stremio from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = stremio;
import fetch from 'node-fetch';

const { addonBuilder: Builder, serveHTTP: Serve } = stremio;

// --- AYARLAR ---
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

// --- MANIFEST ---
const manifest = {
    id: 'org.rectv.addon',
    version: '1.0.0',
    name: 'RECTV',
    description: 'RecTV Film ve Dizi Kaynakları',
    resources: ['stream'], // Sadece stream kaynağı olarak çalışır (Catalog eklemek istersen ekleyebilirsin)
    types: ['movie', 'series'],
    idPrefixes: ['tt'] // IMDB ID'lerini desteklemek için
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---
let cachedToken = null;
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
    const lowUrl = url.toLowerCase();
    const lowLabel = (itemLabel || "").toLowerCase();
    let info = { icon: "🌐", text: "Altyazı" };

    if (lowLabel.includes("dublaj") || lowUrl.includes("dublaj")) {
        if (lowLabel.includes("altyazı") && index === 1) {
            info.icon = "🌐";
            info.text = "Altyazı";
        } else {
            info.icon = "🇹🇷";
            info.text = "Dublaj";
        }
    }
    return info;
}

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[Stream] Request for: ${type} ${id}`);
    
    // tt1234567:1:1 formatını veya tt1234567 (film) formatını çöz
    const parts = id.split(':');
    const imdbId = parts[0];
    const season = parts[1];
    const episode = parts[2];

    try {
        // 1. TMDB'den Türkçe başlığı al (API Türkçe başlık ile arama yapıyor)
        const tmdbUrl = `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&language=tr-TR&api_key=${TMDB_API_KEY}`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        
        const media = type === 'movie' ? tmdbData.movie_results[0] : tmdbData.tv_results[0];
        if (!media) return { streams: [] };

        const trTitle = (media.title || media.name || "").trim();
        const orgTitle = (media.original_title || media.original_name || "").trim();

        // 2. Token Al
        const token = await getAuthToken();
        const searchHeaders = { ...HEADERS, 'Authorization': 'Bearer ' + token };

        // 3. API'de Ara
        let searchQueries = [trTitle];
        if (type === 'movie' && orgTitle && orgTitle !== trTitle) searchQueries.push(orgTitle);

        let allItems = [];
        for (let q of searchQueries) {
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(q)}/${SW_KEY}/`;
            const sRes = await fetch(searchUrl, { headers: searchHeaders });
            const sData = await sRes.json();
            allItems = allItems.concat(sData.series || []).concat(sData.posters || []);
            if (type === 'movie' && allItems.length > 0) break;
        }

        let streams = [];
        const searchTitleLower = trTitle.toLowerCase().trim();

        for (let target of allItems) {
            const targetTitleLower = target.title.toLowerCase().trim();
            if (!targetTitleLower.includes(searchTitleLower)) continue;

            if (type === 'series') {
                // Dizi Mantığı
                const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
                const seasons = await seasonRes.json();
                
                for (let s of seasons) {
                    let sNumber = parseInt(s.title.match(/\d+/) || 0);
                    if (sNumber == season) {
                        for (let ep of s.episodes) {
                            let epNumber = parseInt(ep.title.match(/\d+/) || 0);
                            if (epNumber == episode) {
                                (ep.sources || []).forEach((src, idx) => {
                                    const info = analyzeStream(src.url, idx, ep.label || s.title);
                                    streams.push({
                                        name: `RECTV`,
                                        title: `Kaynak ${idx + 1}\n${info.icon} ${info.text}`,
                                        url: src.url,
                                        behaviorHints: { notClickable: false }
                                    });
                                });
                            }
                        }
                    }
                }
            } else {
                // Film Mantığı
                let movieSources = target.sources || [];
                if (movieSources.length === 0) {
                    const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
                    const detData = await detRes.json();
                    movieSources = detData.sources || [];
                }

                movieSources.forEach((src, idx) => {
                    const info = analyzeStream(src.url, idx, target.label);
                    streams.push({
                        name: `RECTV`,
                        title: `Kaynak ${idx + 1}\n${info.icon} ${info.text}`,
                        url: src.url
                    });
                });
            }
        }

        // URL Tekilleştirme
        return { streams: streams.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i) };

    } catch (err) {
        console.error("Stream Error:", err);
        return { streams: [] };
    }
});

// --- SERVER BAŞLAT ---
const addonInterface = builder.getInterface();
const PORT = process.env.PORT || 7010;

serveHTTP(addonInterface, { port: PORT }).then(() => {
    console.log(`✅ RECTV Addon listening on http://localhost:${PORT}/manifest.json`);
});

export default addonInterface;
