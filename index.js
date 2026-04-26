import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const MOVIE_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4", "Drama": "8", "Korku": "10", "Dublaj": "26", "Altyazı": "27" };
const SERIES_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4", "Netflix": "33", "Exxen": "35" };
const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };

export const manifest = {
    id: "com.nuvio.rectv.v481.force_meta", // ID değişti ki cache temizlensin
    version: "4.8.1",
    name: "RECTV Pro Meta Fix",
    description: "Kendi Metasını Göstermeye Zorlanmış Sürüm",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv_", "ch_", "CH_"], // Sadece bu ön ekleri biz yöneteceğiz
    catalogs: [
        { id: "rc_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(SERIES_MAP) }] },
        { id: "rc_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] },
        { id: "rc_live", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "search" }, { name: "genre", options: Object.keys(TV_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- IMDb ID BULUCU (tt'siz) ---
async function findPureImdbId(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results?.[0]) {
            const ext = await fetch(`https://api.themoviedb.org/3/${sType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await ext.json();
            return extData.imdb_id ? extData.imdb_id.replace("tt", "") : null;
        }
    } catch (e) { return null; }
    return null;
}

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const { id, extra } = args;
    let rawItems = [];
    let currentType = "movie";

    try {
        if (id === "rc_live") {
            const gid = (extra?.genre) ? (TV_MAP[extra.genre] || "3") : "3";
            const res = await fetch(extra?.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/channel/by/filtres/${gid}/0/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            const channels = extra?.search ? (data.channels || []) : (data || []);
            return { metas: channels.map(ch => ({ 
                id: `CH_${ch.title || ch.name}`, 
                type: "tv", 
                name: ch.title || ch.name, 
                poster: ch.image, 
                posterShape: "landscape"
            })) };
        }

        if (id === "rc_series") {
            currentType = "series";
            const res = await fetch(extra?.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/serie/by/filtres/${SERIES_MAP[extra?.genre] || "0"}/created/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            rawItems = extra?.search ? (data.series || []) : (Array.isArray(data) ? data : data.posters || []);
        } else {
            currentType = "movie";
            const res = await fetch(extra?.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/movie/by/filtres/${MOVIE_MAP[extra?.genre] || "0"}/created/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            rawItems = extra?.search ? (data.posters || []) : (Array.isArray(data) ? data : data.posters || []);
        }

        const metas = await Promise.all(rawItems.slice(0, 15).map(async (item) => {
            const title = item.title || item.name;
            const pureId = await findPureImdbId(title, currentType);
            if (!pureId) return null;
            // Çakışmayı önlemek için ID'nin başına 'rectv_' ekliyoruz
            const finalId = currentType === 'series' ? `rectv_${pureId}:1:1` : `rectv_${pureId}`;
            return { 
                id: finalId, 
                type: currentType, 
                name: title, 
                poster: item.image || item.thumbnail 
            };
        }));
        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => {
    if (id.startsWith("ch_")) {
        const channelName = id.replace("ch_", "");
        try {
            const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(channelName)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            const ch = (data.channels || []).find(c => (c.title || c.name) === channelName);
            if (ch) {
                return { meta: {
                    id, type: "tv", name: ch.title || ch.name, poster: ch.image, background: ch.image,
                    description: `⭐ Puan: ${ch.rating}\n👁️ İzlenme: ${ch.views}\n📺 Kategori: ${ch.label}`,
                    posterShape: "landscape"
                }};
            }
        } catch (e) {}
        return { meta: { id, type, name: channelName, posterShape: "landscape" } };
    }

    try {
        // 'rectv_' ön ekini temizleyerek IMDb ID'yi alıyoruz
        const cleanId = id.replace("rectv_", "");
        const pureId = cleanId.split(':')[0];
        const imdbId = `tt${pureId}`;
        
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(pureId)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        const recItem = (type === 'series' ? (sData.series || []) : (sData.posters || [])).find(x => x.imdb == pureId || x.title?.includes(pureId));

        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const obj = type === 'series' ? tmdbData.tv_results?.[0] : tmdbData.movie_results?.[0];

        const infoDescription = [
            recItem?.description || obj?.overview || "",
            recItem?.imdb ? `\n\n⭐ IMDb: ${recItem.imdb}` : "",
            recItem?.views ? `\n👁️ İzlenme: ${recItem.views}` : "",
            recItem?.classification ? `\n🔞 Sınıf: ${recItem.classification}` : "",
            recItem?.label ? `\n📅 Durum: ${recItem.label}` : ""
        ].join("");

        const meta = {
            id, type,
            name: recItem?.title || obj?.name || obj?.title,
            poster: recItem?.image || `https://image.tmdb.org/t/p/w500${obj?.poster_path}`,
            background: recItem?.cover || `https://image.tmdb.org/t/p/original${obj?.backdrop_path}`,
            description: infoDescription,
            releaseInfo: recItem?.year?.toString() || obj?.first_air_date?.split('-')[0],
            genres: recItem?.genres?.map(g => g.title) || [],
            trailers: recItem?.trailer?.url ? [{ 
                source: recItem.trailer.url.split('v=')[1] || recItem.trailer.url.split('/').pop(), 
                type: "Trailer", service: "youtube" 
            }] : [],
            videos: []
        };

        if (type === 'series' && obj) {
            const detailRes = await fetch(`https://api.themoviedb.org/3/tv/${obj.id}?api_key=${TMDB_KEY}&language=tr-TR`);
            const detailData = await detailRes.json();
            for (const season of (detailData.seasons || [])) {
                if (season.season_number === 0) continue;
                const sRes = await fetch(`https://api.themoviedb.org/3/tv/${obj.id}/season/${season.season_number}?api_key=${TMDB_KEY}&language=tr-TR`);
                const sData = await sRes.json();
                (sData.episodes || []).forEach(ep => {
                    meta.videos.push({
                        id: `rectv_${pureId}:${ep.season_number}:${ep.episode_number}`,
                        title: ep.name || `${ep.episode_number}. Bölüm`,
                        season: ep.season_number, episode: ep.episode_number
                    });
                });
            }
        }
        return { meta };
    } catch (e) { return { meta: { id, type, name: "Yükleniyor..." } }; }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const { id, type } = args;
    try {
        if (id.startsWith("ch_")) {
            const channelName = id.replace("ch_", "");
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(channelName)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const sData = await sRes.json();
            const found = (sData.channels || []).find(c => (c.title || c.name) === channelName);
            if (found) {
                const res = await fetch(`${BASE_URL}/api/channel/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const data = await res.json();
                return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.title || src.size, url: src.url })) };
            }
        } else {
            const cleanId = id.replace("rectv_", "");
            const pureId = cleanId.split(':')[0];
            const season = args.season || cleanId.split(':')[1] || 1;
            const episode = args.episode || cleanId.split(':')[2] || 1;
            
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/tt${pureId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            const obj = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
            
            if (obj) {
                const title = obj.title || obj.name;
                const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const sData = await sRes.json();
                const found = (type === 'series' ? sData.series : sData.posters)?.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase().split(':')[0]));
                
                if (found) {
                    const res = await fetch(`${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                    const data = await res.json();
                    if (type === 'series') {
                        const targetS = (data.seasons || []).find(s => s.season_number == season);
                        const targetE = (targetS?.episodes || []).find(e => e.episode_number == episode);
                        if (targetE?.sources) return { streams: targetE.sources.map(src => ({ name: "RECTV", title: src.title, url: src.url })) };
                    }
                    return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url })) };
                }
            }
        }
    } catch (e) {}
    return { streams: [] };
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
