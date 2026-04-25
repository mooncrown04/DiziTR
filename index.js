import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const FULL_HEADERS = {
    'User-Agent': 'EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "org.rectv.pro.fixed.v95", // Her seferinde ID'yi değiştiriyoruz
    version: "95.0.0",
    name: "RECTV Pro + Katalog",
    description: "Tüm Kataloglar ve TV Aktif",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv"],
    catalogs: [
        // Movie tipindeki kataloglar ana ekranda daha kolay görünür
        { id: "rectv-movies-pop", type: "movie", name: "🎬 RECTV Popüler Filmler" },
        { id: "rectv-series-pop", type: "series", name: "🍿 RECTV Popüler Diziler" },
        { id: "rectv-tv-channels", type: "tv", name: "📺 RECTV Canlı TV" }
    ]
};

const builder = new addonBuilder(manifest);

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        return (await res.text()).trim();
    } catch (e) { return null; }
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const token = await getAuthToken();
    
    // Katalog eşleşmeleri (Senin JSON çıktındaki "posters" ve "channels" yapısına göre)
    let searchTerm = "2026";
    if (id === "rectv-tv-channels") searchTerm = "kanal";
    else if (id === "rectv-movies-pop") searchTerm = "recep";
    else if (id === "rectv-series-pop") searchTerm = "dizi";
    
    if (extra.search) searchTerm = extra.search;

    const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(searchTerm)}/${SW_KEY}/`;

    try {
        const response = await fetch(searchUrl, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        // JSON yapısını analiz et ve doğru diziyi seç
        let items = [];
        if (id === "rectv-tv-channels") items = data.channels || [];
        else items = data.posters || data.series || [];

        const metas = items.map(item => ({
            id: `rectv:${type}:${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.image || item.thumbnail || "https://via.placeholder.com/300x450?text=YOK",
            description: item.label || "RECTV"
        }));

        return { metas: metas };
    } catch (e) {
        return { metas: [] };
    }
});

// META ve STREAM kısımları önceki çalışan yapıyla aynı kalıyor...
builder.defineMetaHandler(async ({ id, type }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();
    const endpoint = type === 'tv' ? `/api/channel/${realId}/${SW_KEY}/` : (type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`);
    try {
        const res = await fetch(BASE_URL + endpoint, { headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        return { meta: { id, type, name: data.title || data.name, poster: data.image || data.thumbnail, background: data.cover || data.image, description: data.description } };
    } catch (e) { return { meta: {} }; }
});

builder.defineStreamHandler(async ({ id, type }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();
    const endpoint = type === 'tv' ? `/api/channel/${realId}/${SW_KEY}/` : (type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`);
    try {
        const res = await fetch(BASE_URL + endpoint, { headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        let streams = [];
        if (type === 'tv' && data.url) streams.push({ name: "RECTV", title: "Canlı Yayın", url: data.url });
        else (data.sources || []).forEach(src => streams.push({ name: "RECTV", title: src.quality || "HD", url: src.url }));
        return { streams };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
