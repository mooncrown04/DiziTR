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

const manifest = {
    id: "com.nuvio.rectv.v500",
    version: "5.0.0",
    name: "RECTV Pro Dual",
    description: "Nuvio Koleksiyon Standart Yapılandırması",
    resources: ["catalog", "meta", "stream"],
    // KRİTİK: Nuvio koleksiyonlarında diziler için "tv" tipi kullanılır.
    types: ["movie", "tv", "series"], 
    idPrefixes: ["tt"],
    catalogs: [
        {
            id: "rectv_dizi_katalog",
            type: "tv", // Koleksiyon JSON'una uygun hale getirildi
            name: "🍿 RECTV Diziler",
            extra: [{ name: "search" }, { name: "genre", options: ["Aksiyon", "Drama", "Komedi", "Korku", "Bilim-Kurgu"] }]
        },
        {
            id: "rectv_film_katalog",
            type: "movie",
            name: "🎬 RECTV Filmler",
            extra: [{ name: "search" }, { name: "genre", options: ["Aksiyon", "Drama", "Komedi", "Korku", "Bilim-Kurgu"] }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI ANALİZ ---
function analyzeStream(url, index, itemLabel) {
    const lowUrl = url.toLowerCase();
    const lowLabel = (itemLabel || "").toLowerCase();
    let info = { icon: "🌐", text: "Altyazı" };
    if (lowLabel.includes("dublaj") || lowUrl.includes("dublaj")) {
        info.icon = "🇹🇷"; info.text = "Dublaj";
    }
    return info;
}

// --- KATALOG (Arama ve Listeleme) ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    try {
        const isSearch = extra && extra.search;
        // Nuvio "tv" veya "series" tipini dizi için kullanabilir, ikisini de serie API'sine yönlendiriyoruz.
        const apiPath = (type === 'tv' || type === 'series') ? 'serie' : 'movie';
        
        let url = isSearch 
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${apiPath}/by/filtres/0/created/0/${SW_KEY}/`;

        const response = await fetch(url, { headers: HEADERS });
        const data = await response.json();
        let rawItems = (apiPath === 'serie') ? (data.series || data) : (data.posters || data);
        if (!Array.isArray(rawItems)) rawItems = [];

        const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
            const title = item.title || item.name;
            // Arama türüne göre TMDB'den doğru ID'yi alıyoruz
            const tmdbType = (apiPath === 'serie') ? 'tv' : 'movie';
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            
            if (tmdbData.results && tmdbData.results.length > 0) {
                const ext = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbData.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
                const extData = await ext.json();
                if (extData.imdb_id) {
                    return {
                        id: (apiPath === 'serie') ? `${extData.imdb_id}:tv` : extData.imdb_id,
                        type: type, // Nuvio'nun beklediği orijinal tür (tv veya movie)
                        name: title,
                        poster: item.image || item.thumbnail,
                        description: `RecTV | ${item.year || ''}`
                    };
                }
            }
            return null;
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

// --- KAZIYICI (Stream) ---
builder.defineStreamHandler(async (args) => {
    const { id } = args;
    const cleanId = id.split(":")[0];
    const isSeries = id.includes(":tv");
    
    try {
        const tmdbUrl = `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        const tmdbItem = isSeries ? tmdbData.tv_results?.[0] : tmdbData.movie_results?.[0];
        if (!tmdbItem) return { streams: [] };

        const trTitle = (tmdbItem.name || tmdbItem.title).toLowerCase().trim();
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(trTitle)}/${SW_KEY}/`, { headers: HEADERS });
        const sData = await sRes.json();
        const pool = isSeries ? (sData.series || []) : (sData.posters || []);

        const target = pool.find(p => (p.title || p.name).toLowerCase().includes(trTitle));
        if (!target) return { streams: [] };

        let finalResults = [];
        if (isSeries) {
            // Sezon/Bölüm eşleşmesi (V18 mantığı)
            const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
            const seasons = await seasonRes.json();
            const sNum = args.season || 1;
            const eNum = args.episode || 1;

            for (let s of seasons) {
                if (parseInt(s.title.match(/\d+/)) == sNum) {
                    for (let ep of (s.episodes || [])) {
                        if (parseInt(ep.title.match(/\d+/)) == eNum) {
                            (ep.sources || []).forEach((src, idx) => {
                                const info = analyzeStream(src.url, idx, ep.label);
                                finalResults.push({
                                    name: "RECTV",
                                    title: `⌜ RECTV ⌟ | ${info.icon} ${info.text} | Bölüm ${eNum}`,
                                    url: src.url
                                });
                            });
                        }
                    }
                }
            }
        } else {
            const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
            const detData = await detRes.json();
            (detData.sources || []).forEach((src, idx) => {
                const info = analyzeStream(src.url, idx, target.label);
                finalResults.push({
                    name: "RECTV",
                    title: `⌜ RECTV ⌟ | ${info.icon} ${info.text}`,
                    url: src.url
                });
            });
        }
        return { streams: finalResults };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
