import stremio from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = stremio;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

// --- MANIFEST ---
const manifest = {
    id: "org.rectv.pro.v18",
    version: "18.0.0",
    name: "RECTV Pro Fix",
    description: "TMDB Uyumlu Akıllı Arama ve Otomatik Kaynak Seçici",
    resources: ["stream", "catalog"], // Sadece stream ve katalog kullanıyoruz
    types: ["movie", "series"],
    catalogs: [
        { id: "rectv-trend-movies", type: "movie", name: "RECTV Trend Filmler" },
        { id: "rectv-trend-series", type: "series", name: "RECTV Trend Diziler" }
    ],
    idPrefixes: ["tt"] // ÖNEMLİ: Stremio'nun kendi ID'lerini (tt12345) kullanıyoruz
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI: AUTH TOKEN ---
async function getAuthToken() {
    try {
        const res = await fetch(BASE_URL + "/api/attest/nonce", { headers: HEADERS });
        const text = await res.text();
        return text.trim();
    } catch (e) { return null; }
}

// --- STREAM HANDLER (Senin Gönderdiğin Mantık) ---
builder.defineStreamHandler(async ({ type, id }) => {
    if (!id.startsWith('tt')) return { streams: [] };

    try {
        const tmdbId = id.split(':')[0]; // tt12345
        const isMovie = (type === 'movie');
        const seasonNum = id.split(':')[1] || 1;
        const episodeNum = id.split(':')[2] || 1;

        // 1. TMDB'den Türkçe İsim Al
        const tmdbUrl = `https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${tmdbId}?language=tr-TR&api_key=4ef0d7355d9ffb5151e987764708ce96`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        const trTitle = (tmdbData.title || tmdbData.name || "").trim();

        if (!trTitle) return { streams: [] };

        // 2. RECTV API'sinde Ara
        const token = await getAuthToken();
        const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(trTitle)}/${SW_KEY}/`;
        const sRes = await fetch(searchUrl, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
        const sData = await sRes.json();
        const foundItems = (sData.series || []).concat(sData.posters || []);

        let streams = [];

        for (let item of foundItems) {
            // İsim kontrolü (Basit eşleşme)
            if (!item.title.toLowerCase().includes(trTitle.toLowerCase())) continue;

            if (isMovie && (item.type === 'poster' || item.type === 'movie')) {
                const detRes = await fetch(`${BASE_URL}/api/movie/${item.id}/${SW_KEY}/`, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
                const detData = await detRes.json();
                (detData.sources || []).forEach((src, idx) => {
                    streams.push({
                        name: "RECTV",
                        title: `Kaynak ${idx + 1} | 🎬 Film`,
                        url: src.url
                    });
                });
            } else if (!isMovie && (item.type === 'serie' || item.type === 'series')) {
                const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${item.id}/${SW_KEY}/`, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
                const seasons = await seasonRes.json();
                
                // Doğru sezonu bul
                const targetSeason = seasons.find(s => s.title.includes(seasonNum.toString()));
                const targetEp = targetSeason?.episodes.find(e => e.title.includes(episodeNum.toString()));
                
                (targetEp?.sources || []).forEach((src, idx) => {
                    streams.push({
                        name: "RECTV",
                        title: `S${seasonNum}E${episodeNum} | Kaynak ${idx + 1}`,
                        url: src.url
                    });
                });
            }
        }

        return { streams: streams.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i) };

    } catch (err) {
        return { streams: [] };
    }
});

// --- CATALOG HANDLER (Trendleri Göstermek İçin) ---
builder.defineCatalogHandler(async ({ id }) => {
    // Şimdilik boş dönüyoruz, asıl işimiz Stream tarafında (tt id'leri ile)
    return { metas: [] };
});

// --- SERVERI BAŞLAT ---
const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT }).then(() => {
    console.log(`✅ RECTV v18 Fixed listening on port ${PORT}`);
});
