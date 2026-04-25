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
    id: "com.nuvio.rectv.v520",
    version: "5.2.0",
    name: "RECTV LOGGERS",
    description: "Tüm Hatalar Console Error Olarak Basılır",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "tv", "series"], // Nuvio "tv" gönderdiği için ekledik
    idPrefixes: ["tt"],
    catalogs: [
        { id: "rectv_tv", type: "tv", name: "🍿 RECTV Diziler" },
        { id: "rectv_movie", type: "movie", name: "🎬 RECTV Filmler" }
    ]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async (args) => {
    console.error(`[RECTV] Katalog Isteği: Type=${args.type} Search=${args.extra?.search || 'Yok'}`);
    try {
        const type = args.type;
        const isSearch = args.extra && args.extra.search;
        const apiPath = (type === 'tv' || type === 'series') ? 'serie' : 'movie';
        
        let url = isSearch 
            ? `${BASE_URL}/api/search/${encodeURIComponent(args.extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${apiPath}/by/filtres/0/created/0/${SW_KEY}/`;

        const response = await fetch(url, { headers: HEADERS });
        const data = await response.json();
        let rawItems = (apiPath === 'serie') ? (data.series || data) : (data.posters || data);

        const metas = await Promise.all((rawItems || []).slice(0, 10).map(async (item) => {
            const title = item.title || item.name;
            const tmdbType = (apiPath === 'serie') ? 'tv' : 'movie';
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            
            if (tmdbData.results?.[0]) {
                const ext = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbData.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
                const extData = await ext.json();
                if (extData.imdb_id) {
                    return {
                        id: (apiPath === 'serie') ? `${extData.imdb_id}:tv` : extData.imdb_id,
                        type: type,
                        name: title,
                        poster: item.image || item.thumbnail
                    };
                }
            }
            return null;
        }));
        return { metas: metas.filter(m => m !== null) };
    } catch (e) {
        console.error("[RECTV] Katalog Hatası:", e.message);
        return { metas: [] };
    }
});

builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

builder.defineStreamHandler(async (args) => {
    // SENİN İSTEDİĞİN CONSOLE ERROR BURASI
    console.error("--- !!! NUVIO POSTERE BASTI !!! ---");
    console.error("[NUVIO_RAW_ARGS]:", JSON.stringify(args, null, 2));

    const { id, type } = args;
    const cleanId = id.split(":")[0];
    const isSeries = id.includes(":tv") || type === "tv" || type === "series";

    try {
        // 1. TMDB Bilgisi
        const tmdbUrl = `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        const tmdbItem = isSeries ? tmdbData.tv_results?.[0] : tmdbData.movie_results?.[0];

        if (!tmdbItem) {
            console.error("[RECTV_HATA] TMDB ID Bulunamadı:", cleanId);
            return { streams: [] };
        }

        const trTitle = (tmdbItem.name || tmdbItem.title);
        console.error(`[RECTV_INFO] Aranan Başlık: ${trTitle} (Tür: ${isSeries ? 'Dizi' : 'Film'})`);

        // 2. RecTV Arama
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(trTitle)}/${SW_KEY}/`, { headers: HEADERS });
        const sData = await sRes.json();
        const pool = isSeries ? (sData.series || []) : (sData.posters || []);

        const target = pool.find(p => (p.title || p.name).toLowerCase().includes(trTitle.toLowerCase()));
        if (!target) {
            console.error("[RECTV_HATA] RecTV API'sinde bu isimde bir şey yok.");
            return { streams: [] };
        }

        let streams = [];
        if (isSeries) {
            const sNum = args.season || 1;
            const eNum = args.episode || 1;
            console.error(`[RECTV_INFO] Kazınıyor: Sezon ${sNum}, Bölüm ${eNum}`);

            const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
            const seasons = await seasonRes.json();

            for (let s of seasons) {
                let matchS = parseInt(s.title.match(/\d+/) || 0);
                if (matchS == sNum) {
                    for (let ep of (s.episodes || [])) {
                        let matchE = parseInt(ep.title.match(/\d+/) || 0);
                        if (matchE == eNum) {
                            console.error(`[RECTV_SUCCESS] Kaynaklar Bulundu (Adet: ${ep.sources?.length})`);
                            (ep.sources || []).forEach(src => {
                                streams.push({ 
                                    name: "RECTV", 
                                    title: `🎬 ${src.quality || 'Auto'} - Bölüm ${eNum}`, 
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
            (detData.sources || []).forEach(src => {
                streams.push({ name: "RECTV", title: `🎬 ${src.quality || 'HD'}`, url: src.url });
            });
        }

        return { streams };
    } catch (e) {
        console.error("[RECTV_KRITIK_HATA]:", e.message);
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
