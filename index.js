import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const VERSION = "5.4.2";
// Kritik: Versiyon logunu en başa basıyoruz
console.error(`\n==========================================\n[SİSTEM] RECTV v${VERSION} AKTİF\n==========================================\n`);

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
    id: "com.nuvio.rectv.v542",
    version: VERSION,
    name: "RECTV v5.4.2",
    description: "ID Temizleme ve Dizi Fix",
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
    console.error(`[KATALOG] Tip: ${args.type} | Sorgu: ${args.extra?.search || 'Genel'}`);
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
                            id: extData.imdb_id, // KRİTİK: Sadece 'tt123456' formatı
                            type: args.type,
                            name: title,
                            poster: item.image || item.thumbnail,
                            description: `v${VERSION} | ${item.year || ''}`
                        };
                    }
                }
            } catch (e) { console.error(`[TMDB] Atlandı: ${title}`); }
            return null;
        }));

        return { metas: metas.filter(m => m !== null) };
    } catch (err) {
        console.error("[KATALOG-HATA]", err.message);
        return { metas: [] };
    }
});

// Meta Handler: Nuvio Meta bilgisini katalogdaki ID üzerinden ister
builder.defineMetaHandler(async ({ id, type }) => {
    console.error(`[META] Detay istendi: ${id}`);
    return { meta: { id, type } };
});

builder.defineStreamHandler(async (args) => {
    // ID Split: "tt12345:1:1" -> "tt12345"
    const cleanId = args.id.split(":")[0];
    console.error(`[STREAM] İstek: ${args.id} | Temiz ID: ${cleanId}`);

    try {
        const isTV = args.type === "tv" || args.id.includes(":");
        const tmdbUrl = `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        const tmdbItem = isTV ? tmdbData.tv_results?.[0] : tmdbData.movie_results?.[0];

        if (!tmdbItem) return { streams: [] };

        const queryTitle = tmdbItem.name || tmdbItem.title;
        const searchRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(queryTitle)}/${SW_KEY}/`, { headers: HEADERS });
        const searchData = await searchRes.json();
        const pool = isTV ? (searchData.series || []) : (searchData.posters || []);
        
        // Strict Match: Tam isim eşleşmesi
        const target = pool.find(p => (p.title || p.name).toLowerCase() === queryTitle.toLowerCase());

        if (!target) {
            console.error(`[STREAM] RecTV'de bulunamadı: ${queryTitle}`);
            return { streams: [] };
        }

        let streams = [];
        if (isTV) {
            const season = args.season || 1;
            const episode = args.episode || 1;
            console.error(`[STREAM] Bölüm Aranıyor: S${season} E${episode}`);
            
            const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
            const seasons = await seasonRes.json();
            
            // RecTV API'den gelen sezon başlıklarını (Sezon 1, 1. Sezon vb.) parse et
            const activeSeason = seasons.find(s => {
                const sNum = s.title.replace(/\D/g, "");
                return parseInt(sNum) === parseInt(season);
            });

            if (activeSeason && activeSeason.episodes) {
                const activeEp = activeSeason.episodes.find(e => {
                    const eNum = e.title.replace(/\D/g, "");
                    return parseInt(eNum) === parseInt(episode);
                });

                if (activeEp && activeEp.sources) {
                    activeEp.sources.forEach(src => {
                        streams.push({ name: "RECTV", title: `S${season}E${episode} | ${src.quality || 'HD'}`, url: src.url });
                    });
                }
            }
        } else {
            const movieRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
            const movieData = await movieRes.json();
            (movieData.sources || []).forEach(src => {
                streams.push({ name: "RECTV", title: `Movie | ${src.quality || 'HD'}`, url: src.url });
            });
        }

        return { streams };
    } catch (err) {
        console.error("[STREAM-KRITIK]", err.message);
        return { streams: [] };
    }
});

serveHTTP(builder.getInterface(), { port: PORT });
