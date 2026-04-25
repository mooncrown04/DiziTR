import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const VERSION = "5.4.0";
// Başlangıçta versiyonu bas (Hata loglarında en üstte görünmesi için error olarak basıyoruz)
console.error(`!!! EKLENTI BASLATILDI - VERSIYON: ${VERSION} !!!`);

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

const manifest = {
    id: "com.nuvio.rectv.v540",
    version: VERSION,
    name: "RECTV v5.4.0",
    description: "ID Düzeltmesi ve Debug Modu",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "tv"],
    idPrefixes: ["tt"],
    catalogs: [
        { id: "rectv_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }] },
        { id: "rectv_tv", type: "tv", name: "🍿 RECTV Diziler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async (args) => {
    console.error(`[LOG] Katalog İsteği: ${args.type} | Arama: ${args.extra?.search || 'Yok'}`);
    
    try {
        const isMovie = args.type === 'movie';
        const search = args.extra?.search;
        let url = search 
            ? `${BASE_URL}/api/search/${encodeURIComponent(search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${isMovie ? 'movie' : 'serie'}/by/filtres/0/created/0/${SW_KEY}/`;

        const response = await fetch(url, { headers: HEADERS });
        const data = await response.json();
        const items = isMovie ? (data.posters || data) : (data.series || data);

        if (!Array.isArray(items)) return { metas: [] };

        const metas = await Promise.all(items.slice(0, 15).map(async (item) => {
            const title = item.title || item.name;
            try {
                const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/${isMovie ? 'movie' : 'tv'}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`);
                const tmdbData = await tmdbRes.json();
                if (tmdbData.results?.[0]) {
                    const ext = await fetch(`https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${tmdbData.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
                    const extData = await ext.json();
                    if (extData.imdb_id) {
                        return {
                            id: extData.imdb_id, // FIX: :tv takısını kaldırdık, sadece tt123456
                            type: args.type,
                            name: title,
                            poster: item.image || item.thumbnail,
                            description: `RecTV | ${item.year || ''}`
                        };
                    }
                }
            } catch (e) { console.error(`[HATA] TMDB ID Eşleşmedi: ${title}`); }
            return null;
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (err) {
        console.error("[HATA] Katalog API Hatası:", err.message);
        return { metas: [] };
    }
});

builder.defineMetaHandler(async ({ id }) => ({ meta: { id } }));

builder.defineStreamHandler(async (args) => {
    // FIX: Eğer ID tt12345:tv:1:1 şeklinde gelirse, sadece baştaki tt kısmını al
    const cleanId = args.id.split(":")[0];
    console.error(`--- !!! STREAM BASLATILDI !!! ---`);
    console.error(`[LOG] Gelen ID: ${args.id} | Temiz ID: ${cleanId} | Tip: ${args.type}`);

    try {
        const isTV = args.type === "tv" || args.id.includes(":");
        const tmdbType = isTV ? 'tv' : 'movie';
        
        const tmdbUrl = `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        const tmdbItem = isTV ? tmdbData.tv_results?.[0] : tmdbData.movie_results?.[0];

        if (!tmdbItem) {
            console.error(`[HATA] TMDB üzerinde ${cleanId} bulunamadı.`);
            return { streams: [] };
        }

        const queryTitle = tmdbItem.name || tmdbItem.title;
        console.error(`[LOG] RecTV'de Aranan Başlık: ${queryTitle}`);

        const searchRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(queryTitle)}/${SW_KEY}/`, { headers: HEADERS });
        const searchData = await searchRes.json();
        const pool = isTV ? (searchData.series || []) : (searchData.posters || []);
        
        const target = pool.find(p => (p.title || p.name).toLowerCase().includes(queryTitle.toLowerCase()));

        if (!target) {
            console.error(`[HATA] RecTV API'de sonuç bulunamadı: ${queryTitle}`);
            return { streams: [] };
        }

        let results = [];
        if (isTV) {
            const season = args.season || 1;
            const episode = args.episode || 1;
            console.error(`[LOG] Dizi Detayı Çekiliyor: S${season} E${episode}`);
            
            const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
            const seasons = await seasonRes.json();
            
            for (let s of seasons) {
                if (parseInt(s.title.match(/\d+/)) == season) {
                    const ep = s.episodes.find(e => parseInt(e.title.match(/\d+/)) == episode);
                    if (ep && ep.sources) {
                        ep.sources.forEach(src => {
                            results.push({ name: "RECTV", title: `🎬 ${src.quality || 'Auto'}`, url: src.url });
                        });
                    }
                }
            }
        } else {
            console.error(`[LOG] Film Detayı Çekiliyor: ${target.id}`);
            const movieRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
            const movieData = await movieRes.json();
            (movieData.sources || []).forEach(src => {
                results.push({ name: "RECTV", title: `🎬 ${src.quality || 'HD'}`, url: src.url });
            });
        }

        console.error(`[BASARI] Toplam ${results.length} kaynak eklendi.`);
        return { streams: results };
    } catch (err) {
        console.error("[KRITIK HATA] Stream Oluşturulamadı:", err.message);
        return { streams: [] };
    }
});

serveHTTP(builder.getInterface(), { port: PORT });
