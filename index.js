import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

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

const manifest = {
    id: "com.nuvio.rectv.v480",
    version: "4.8.0",
    name: "RECTV Pro Dual",
    description: "V18 Final Kazıyıcı Entegre Edildi",
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

// --- YARDIMCI FONKSİYONLAR (SENİN KODUN) ---
function analyzeStream(url, index, itemLabel) {
    const lowUrl = url.toLowerCase();
    const lowLabel = (itemLabel || "").toLowerCase();
    let info = { icon: "🌐", text: "Altyazı" };
    if (lowLabel.includes("dublaj") || lowUrl.includes("dublaj")) {
        if (lowLabel.includes("altyazı") && index === 1) {
            info.icon = "🌐"; info.text = "Altyazı";
        } else {
            info.icon = "🇹🇷"; info.text = "Dublaj";
        }
    }
    return info;
}

async function findRealImdbId(title, year, type) {
    try {
        const searchType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${searchType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`;
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

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    let rawItems = [];
    try {
        if (extra && extra.search) {
            const response = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`, { headers: HEADERS });
            const data = await response.json();
            rawItems = (type === "series") ? (data.series || []) : (data.posters || []);
        } else {
            const apiPath = type === 'series' ? 'serie' : 'movie';
            const genreId = (extra && extra.genre) ? (CATEGORY_MAP[extra.genre] || "0") : "0";
            const response = await fetch(`${BASE_URL}/api/${apiPath}/by/filtres/${genreId}/created/0/${SW_KEY}/`, { headers: HEADERS });
            const data = await response.json();
            rawItems = Array.isArray(data) ? data : (data.posters || []);
        }

        const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
            const title = item.title || item.name;
            const imdb = await findRealImdbId(title, item.year || item.sublabel, type);
            if (!imdb) return null;
            const finalId = (type === "series") ? `${imdb}:series` : imdb;
            return {
                id: finalId, type: type, name: title,
                poster: item.image || item.thumbnail,
                description: `RecTV | ${item.year || item.sublabel || ''}`
            };
        }));
        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

// --- STREAM HANDLER (Gelişmiş Kazıyıcı Entegrasyonu) ---
builder.defineStreamHandler(async (args) => {
    const { id, type } = args;
    const cleanId = id.split(":")[0];
    const isActuallySeries = id.includes(":series") || type === "series";
    let finalResults = [];

    try {
        // 1. TMDB Bilgilerini Al (Başlık için)
        const tmdbUrl = `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        const tmdbItem = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
        if (!tmdbItem) return { streams: [] };

        const trTitle = (tmdbItem.title || tmdbItem.name || "").trim();
        const orgTitle = (tmdbItem.original_title || tmdbItem.original_name || "").trim();
        const searchTitleLower = trTitle.toLowerCase().trim();

        // 2. RecTV'de Ara
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(trTitle)}/${SW_KEY}/`, { headers: HEADERS });
        const sData = await sRes.json();
        const allItems = (sData.series || []).concat(sData.posters || []);

        // 3. Kesin Eşleşme ve Kaynak Çekme
        for (let target of allItems) {
            const targetTitleLower = (target.title || target.name).toLowerCase().trim();
            
            // --- SENİN KESİN EŞLEŞME FİLTREN ---
            let isMatch = false;
            if (searchTitleLower === "from") {
                isMatch = (targetTitleLower === "from" || targetTitleLower === "from dizi");
            } else {
                isMatch = targetTitleLower.includes(searchTitleLower) || (orgTitle && targetTitleLower.includes(orgTitle.toLowerCase()));
            }
            if (!isMatch) continue;

            const isTargetSerie = target.type === "serie" || (target.label && target.label.toLowerCase().includes("dizi"));
            if (isActuallySeries && isTargetSerie) {
                // Dizi Kaynakları (Sezon/Bölüm eşleşmesi gerekecekse buraya eklenebilir, şimdilik genel liste)
                const detRes = await fetch(`${BASE_URL}/api/serie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
                const detData = await detRes.json();
                (detData.sources || []).forEach((src, idx) => {
                    const info = analyzeStream(src.url, idx, target.label);
                    finalResults.push({
                        name: "RECTV",
                        title: `⌜ RECTV ⌟ | ${src.quality || "HD"} | ${info.icon} ${info.text}`,
                        url: src.url
                    });
                });
            } else if (!isActuallySeries && !isTargetSerie) {
                // Film Kaynakları
                const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
                const detData = await detRes.json();
                (detData.sources || []).forEach((src, idx) => {
                    const info = analyzeStream(src.url, idx, target.label);
                    finalResults.push({
                        name: "RECTV",
                        title: `⌜ RECTV ⌟ | ${src.quality || "HD"} | ${info.icon} ${info.text}`,
                        url: src.url
                    });
                });
            }
        }
        return { streams: finalResults.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i) };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
