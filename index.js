import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

export const manifest = {
    id: "com.rectv.pro.fixed",
    version: "1.0.1",
    name: "RECTV Pro Fixed",
    description: "Çakışma Engelli İzole Sürüm",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv_"], // Sadece bu prefixi kullanıyoruz, tt ile çakışmayı kestik
    catalogs: [
        { id: "rc_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }] },
        { id: "rc_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- CATALOG: Hızlı ve Sorunsuz ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    try {
        let url = extra?.search 
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/by/filtres/0/created/0/${SW_KEY}/`;
        
        const res = await fetch(url, { headers: FULL_HEADERS });
        const data = await res.json();
        const items = (type === "series") ? (data.series || data || []) : (data.posters || data || []);

        return {
            metas: items.slice(0, 40).map(item => ({
                id: `rectv_${item.id}`, 
                type: type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail
            }))
        };
    } catch (e) { return { metas: [] }; }
});

// --- META: Veriyi Bekletmeden Veren Bölüm ---
builder.defineMetaHandler(async ({ id, type }) => {
    try {
        const cleanId = id.split(':')[0].replace("rectv_", "");
        
        const res = await fetch(`${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/${cleanId}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const data = await res.json();

        const meta = {
            id: `rectv_${cleanId}`,
            type: type,
            name: data.title || data.name,
            poster: data.image || data.thumbnail,
            background: data.backdrop || data.image,
            description: data.description || "İçerik Detayı",
            videos: []
        };

        // Dizilerde sezon/bölüm ağacını oluşturuyoruz
        if (type === 'series' && data.seasons) {
            data.seasons.forEach((s) => {
                const sNum = s.season_number || 1;
                if (s.episodes) {
                    s.episodes.forEach((ep) => {
                        meta.videos.push({
                            id: `rectv_${cleanId}:${sNum}:${ep.episode_number || 1}`,
                            title: ep.title || `${ep.episode_number}. Bölüm`,
                            season: sNum,
                            episode: ep.episode_number || 1
                        });
                    });
                }
            });
        }
        return { meta };
    } catch (e) { return { meta: { id, type, name: "Yüklenemedi" } }; }
});

// --- STREAM: Direkt Kaynağa Giden Yol ---
builder.defineStreamHandler(async (args) => {
    const { id, type } = args;
    try {
        const parts = id.split(':');
        const cleanId = parts[0].replace("rectv_", "");
        const season = parts[1];
        const episode = parts[2];

        const res = await fetch(`${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/${cleanId}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const data = await res.json();

        if (type === 'series' && season && episode) {
            const targetS = (data.seasons || []).find(s => s.season_number == season);
            const targetE = (targetS?.episodes || []).find(e => e.episode_number == episode);
            if (targetE && targetE.sources) {
                return { streams: targetE.sources.map(src => ({ name: "RECTV", title: src.title, url: src.url })) };
            }
        } else if (data.sources) {
            return { streams: data.sources.map(src => ({ name: "RECTV", title: src.title, url: src.url })) };
        }
        return { streams: [] };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
