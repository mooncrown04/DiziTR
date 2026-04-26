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
const SERIES_MAP = {"Aksiyon": "1","Dram": "2","Komedi": "3","Bilim Kurgu": "4","Romantik": "5","Polisiye - Suç": "7","Korku": "8","Gerilim": "9","Fantastik": "10","Tarihi ve Savaş": "12","Animasyon": "13",
  "Aile": "14","Gizem": "15","Macera": "17","Belgesel": "19","Tarih": "21","Suç": "22","Yerli Dizi / Film": "23","Western": "25","Bilim-Kurgu": "28","Bilim Kurgu & Fantazi": "30","Aksiyon & Macera": "31","Savaş & Politik": "33",
  "Çocuklar": "34","Vahşi Batı": "35","Gerçeklik": "36","Pembe Dizi": "37","Talk": "39","Şarj Bitiren İçerikler": "42","Adult Swim": "49","Hallmark Channel": "50","Apple TV+": "51","CBS": "52",
  "FOX": "53","BBC One": "54","NBC": "55","Cinemax": "56","Netflix": "57","Showtime": "58","ABC": "59","NHK Educational TV": "60","Syfy": "61","HBO": "62","NIPPON TV": "63",
  "Disney Channel": "65","HBO Brasil": "66","Disney+": "67","Cartoon Network": "68","TSC": "69","TV Tokyo": "71","Fuji TV": "72","bilibili": "74"};
const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };
const YEARS = Array.from({ length: 27 }, (_, i) => (2026 - i).toString()); // 2026'dan 2000'e kadar

export const manifest = {
    id: "com.nuvio.rectv.v481.ultimate",
    version: "4.8.1",
    name: "RECTV Ultimate Pro",
    description: "Yıl Kataloğu & TV Alt Tire ID Fix",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["CH_", "tt"],
    catalogs: [
        { id: "rc_live", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "search" }, { name: "genre", options: Object.keys(TV_MAP) }] },
        { id: "rc_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] },
        { id: "rc_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(SERIES_MAP) }] },
        // CİNEMETA TARZI YIL KATALOGLARI
        { id: "rc_movie_year", type: "movie", name: "📅 Filmler (Yıla Göre)", extra: [{ name: "genre", options: YEARS, isRequired: true }] },
        { id: "rc_series_year", type: "series", name: "📅 Diziler (Yıla Göre)", extra: [{ name: "genre", options: YEARS, isRequired: true }] }
    ]
};

const builder = new addonBuilder(manifest);

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
    const { id, type, extra } = args;
    let rawItems = [];

    try {
        // 1. CANLI TV
        if (id === "rc_live") {
            const gid = (extra?.genre) ? (TV_MAP[extra.genre] || "3") : "3";
            const tvUrl = extra?.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/channel/by/filtres/${gid}/0/0/${SW_KEY}/`;
            const res = await fetch(tvUrl, { headers: FULL_HEADERS });
            const data = await res.json();
            const channels = extra?.search ? (data.channels || []) : (data || []);
            return { metas: channels.map(ch => ({
                id: `CH_${(ch.title || ch.name).replace(/\s+/g, '_')}`,
                type: "tv", name: ch.title || ch.name, poster: ch.image, posterShape: "landscape"
            })) };
        }

        // 2. FİLM & DİZİ (NORMAL VE YIL KATALOGLARI)
        let url;
        const path = type === 'series' ? 'serie' : 'movie';
        
        if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else if (id.includes("_year")) {
            // Yıla göre katalog seçildiyse:
            const selectedYear = extra?.genre || "2024";
            url = `${BASE_URL}/api/${path}/by/filtres/${selectedYear}/created/0/${SW_KEY}/`;
        } else {
            // Normal tür kataloğu seçildiyse:
            const map = type === 'series' ? SERIES_MAP : MOVIE_MAP;
            const gid = (extra?.genre) ? (map[extra.genre] || "0") : "0";
            url = `${BASE_URL}/api/${path}/by/filtres/${gid}/created/0/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers: FULL_HEADERS });
        const data = await res.json();
        rawItems = extra?.search ? (type === 'series' ? data.series : data.posters) : (Array.isArray(data) ? data : data.posters || []);

        const metas = await Promise.all((rawItems || []).slice(0, 15).map(async (item) => {
            const title = item.title || item.name;
            const pureId = await findPureImdbId(title, type);
            if (!pureId) return null;
            return {
                id: type === 'series' ? `${pureId}:1:1` : pureId,
                type: type, name: title, poster: item.image || item.thumbnail
            };
        }));
        return { metas: metas.filter(m => m !== null) };

    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => {
    if (id.startsWith("CH_")) {
        const channelName = id.replace("CH_", "").replace(/_/g, ' ');
        try {
            const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(channelName)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            const ch = (data.channels || []).find(c => (c.title || c.name).replace(/\s+/g, '_') === id.replace("CH_", ""));
            if (ch) {
                return { meta: {
                    id, type: "tv", name: ch.title || ch.name, poster: ch.image, background: ch.image,
                    description: `📺 Kategori: ${ch.label || "Canlı TV"}\n⭐ Puan: ${ch.rating || "N/A"}\n👁️ İzlenme: ${ch.views || "0"}`,
                    posterShape: "landscape"
                }};
            }
        } catch (e) {}
        return { meta: { id, type: "tv", name: channelName, posterShape: "landscape" } };
    }

    try {
        const pureId = id.split(':')[0];
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/tt${pureId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const tmdbData = await tmdbRes.json();
        const obj = type === 'series' ? tmdbData.tv_results?.[0] : tmdbData.movie_results?.[0];
        if (!obj) return { meta: { id, type, name: "Yükleniyor..." } };

        const meta = {
            id, type, name: obj.name || obj.title,
            poster: `https://image.tmdb.org/t/p/w500${obj.poster_path}`,
            background: `https://image.tmdb.org/t/p/original${obj.backdrop_path}`,
            description: obj.overview, videos: []
        };

        if (type === 'series') {
            const detailRes = await fetch(`https://api.themoviedb.org/3/tv/${obj.id}?api_key=${TMDB_KEY}&language=tr-TR`);
            const detailData = await detailRes.json();
            for (const season of (detailData.seasons || [])) {
                if (season.season_number === 0) continue;
                const sRes = await fetch(`https://api.themoviedb.org/3/tv/${obj.id}/season/${season.season_number}?api_key=${TMDB_KEY}&language=tr-TR`);
                const sData = await sRes.json();
                (sData.episodes || []).forEach(ep => {
                    meta.videos.push({
                        id: `${pureId}:${ep.season_number}:${ep.episode_number}`,
                        title: ep.name || `${ep.episode_number}. Bölüm`,
                        season: ep.season_number, episode: ep.episode_number
                    });
                });
            }
        }
        return { meta };
    } catch (e) { return { meta: { id, type, name: "Hata" } }; }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const { id, type } = args;
    try {
        if (id.startsWith("CH_")) {
            const channelName = id.replace("CH_", "").replace(/_/g, ' ');
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(channelName)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const sData = await sRes.json();
            const found = (sData.channels || []).find(c => (c.title || c.name).replace(/\s+/g, '_') === id.replace("CH_", ""));
            if (found) {
                const res = await fetch(`${BASE_URL}/api/channel/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const data = await res.json();
                return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.title || "Yayın", url: src.url })) };
            }
        } else {
            const pureId = id.split(':')[0];
            const season = args.season || id.split(':')[1] || 1;
            const episode = args.episode || id.split(':')[2] || 1;
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/tt${pureId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            const obj = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];
            if (obj) {
                const title = obj.title || obj.name;
                const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const sData = await sRes.json();
                const pool = (type === 'series' ? sData.series : sData.posters) || [];
                const found = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase().split(':')[0]));
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
    } catch (e) { return { streams: [] }; }
    return { streams: [] };
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
