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
    id: "com.nuvio.rectv.v530",
    version: "5.3.0",
    name: "RECTV FULL DEBUG",
    description: "Arama ve Film Katalogları Onarıldı",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "tv", "series"], 
    idPrefixes: ["tt"],
    catalogs: [
        { id: "rectv_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }, { name: "genre", options: ["Aksiyon", "Korku", "Komedi"] }] },
        { id: "rectv_tv", type: "tv", name: "🍿 RECTV Diziler", extra: [{ name: "search" }, { name: "genre", options: ["Dizi", "Animasyon"] }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- KATALOG VE ARAMA LOGLAYICI ---
builder.defineCatalogHandler(async (args) => {
    // Arama yapıldığında veya kataloğa girildiğinde İLK BURASI ÇALIŞIR
    console.error(`!!! [KATALOG_ISTEGI] Tip: ${args.type} | Arama: ${args.extra?.search || 'Yok'}`);

    try {
        const { type, extra } = args;
        const isSearch = extra && extra.search;
        // Nuvio'da dizi için hem 'tv' hem 'series' gelebilir, film için 'movie'
        const apiPath = (type === 'movie') ? 'movie' : 'serie';
        
        let url = isSearch 
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${apiPath}/by/filtres/0/created/0/${SW_KEY}/`;

        console.error(`[API_YOLU]: ${url}`);

        const response = await fetch(url, { headers: HEADERS });
        const data = await response.json();
        
        // Gelen veriyi kontrol et
        let rawItems = (apiPath === 'movie') ? (data.posters || data) : (data.series || data);
        if (!Array.isArray(rawItems)) {
            console.error("[HATA] API'den dizi/film listesi gelmedi!");
            rawItems = [];
        }

        const metas = await Promise.all(rawItems.slice(0, 20).map(async (item) => {
            const title = item.title || item.name;
            const tmdbType = (apiPath === 'movie') ? 'movie' : 'tv';
            
            try {
                const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`);
                const tmdbData = await tmdbRes.json();
                
                if (tmdbData.results?.[0]) {
                    const ext = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbData.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
                    const extData = await ext.json();
                    
                    if (extData.imdb_id) {
                        return {
                            id: (apiPath === 'serie') ? `${extData.imdb_id}:tv` : extData.imdb_id,
                            type: type, // movie veya tv
                            name: title,
                            poster: item.image || item.thumbnail,
                            description: `RecTV | ${item.year || ''}`
                        };
                    }
                }
            } catch (tmdbErr) {
                console.error(`[TMDB_HATA] ${title} için ID alınamadı`);
            }
            return null;
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (e) {
        console.error("[KRITIK_KATALOG_HATASI]:", e.message);
        return { metas: [] };
    }
});

builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

// --- STREAM (POSTERE TIKLAMA) LOGLAYICI ---
builder.defineStreamHandler(async (args) => {
    console.error("--- !!! POSTERE BASILDI !!! ---");
    console.error("[ARGS_TAM_LISTE]:", JSON.stringify(args, null, 2));

    const { id, type } = args;
    const cleanId = id.split(":")[0];
    // Nuvio'da filmler 'movie', diziler 'tv' veya 'series' gelir
    const isActuallySeries = id.includes(":tv") || type === "tv" || type === "series";

    try {
        const tmdbType = isActuallySeries ? 'tv' : 'movie';
        const tmdbUrl = `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        const tmdbItem = isActuallySeries ? tmdbData.tv_results?.[0] : tmdbData.movie_results?.[0];

        if (!tmdbItem) {
            console.error(`[HATA] IMDB ${cleanId} TMDB'de karşılık bulamadı.`);
            return { streams: [] };
        }

        const trTitle = (tmdbItem.name || tmdbItem.title);
        console.error(`[BILGI] RecTV Aranan: ${trTitle} | Tür: ${tmdbType}`);

        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(trTitle)}/${SW_KEY}/`, { headers: HEADERS });
        const sData = await sRes.json();
        
        const pool = isActuallySeries ? (sData.series || []) : (sData.posters || []);
        const target = pool.find(p => (p.title || p.name).toLowerCase().includes(trTitle.toLowerCase()));

        if (!target) {
            console.error(`[HATA] RecTV API'de '${trTitle}' bulunamadı.`);
            return { streams: [] };
        }

        let results = [];
        if (isActuallySeries) {
            const sNum = args.season || 1;
            const eNum = args.episode || 1;
            const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
            const seasons = await seasonRes.json();

            for (let s of seasons) {
                if (parseInt(s.title.match(/\d+/)) == sNum) {
                    for (let ep of (s.episodes || [])) {
                        if (parseInt(ep.title.match(/\d+/)) == eNum) {
                            (ep.sources || []).forEach(src => {
                                results.push({ name: "RECTV", title: `🎬 ${src.quality || 'Auto'}`, url: src.url });
                            });
                        }
                    }
                }
            }
        } else {
            const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
            const detData = await detRes.json();
            (detData.sources || []).forEach(src => {
                results.push({ name: "RECTV", title: `🎬 ${src.quality || 'HD'}`, url: src.url });
            });
        }

        console.error(`[BASARI] ${results.length} adet kaynak bulundu.`);
        return { streams: results };
    } catch (e) {
        console.error("[STREAM_HATASI]:", e.message);
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
