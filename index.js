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
    id: "org.rectv.pro.tv.v80",
    version: "80.0.0",
    name: "RECTV Pro + Canlı TV",
    description: "Film, Dizi ve Canlı TV - Hepsi Bir Arada",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"], // TV tipi eklendi
    idPrefixes: ["rectv"],
    catalogs: [
        { id: "rectv-tv", type: "tv", name: "📺 RECTV Canlı TV" },
        { id: "rectv-movie", type: "movie", name: "🎬 Popüler Filmler" },
        { id: "rectv-series", type: "series", name: "🍿 Popüler Diziler" }
    ]
};

const builder = new addonBuilder(manifest);

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        return (await res.text()).trim();
    } catch (e) { return null; }
}

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const token = await getAuthToken();
    
    // Kataloglar için arama anahtarları
    let searchTerm = "2026";
    if (id === "rectv-tv") searchTerm = "ulusal"; // TV için 'ulusal' veya 'kanal' kelimelerini aratıyoruz
    else if (id === "rectv-movie") searchTerm = "recep";
    else if (id === "rectv-series") searchTerm = "dizi";
    
    if (extra.search) searchTerm = extra.search;

    const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(searchTerm)}/${SW_KEY}/`;

    try {
        const response = await fetch(searchUrl, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        // Senin attığın JSON'da "channels" veya "posters" içinde veri geliyor
        const rawItems = (type === 'tv' ? data.channels : data.posters) || data.posters || data.series || [];

        const metas = rawItems.map(item => ({
            id: `rectv:${type}:${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.image || item.thumbnail || "https://via.placeholder.com/300x450?text=TV",
            description: item.label || "RECTV Canlı Yayın"
        }));

        return { metas };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();
    
    // TV kanalları için farklı bir endpoint kullanılır
    const endpoint = type === 'tv' ? `/api/channel/${realId}/${SW_KEY}/` : 
                    (type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`);

    try {
        const res = await fetch(BASE_URL + endpoint, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        return {
            meta: {
                id: id,
                type: type,
                name: data.title || data.name,
                poster: data.image || data.thumbnail,
                background: data.cover || data.image,
                description: data.description || data.label || "Canlı TV Kanalı"
            }
        };
    } catch (e) { return { meta: {} }; }
});

// --- STREAM HANDLER (Kanal Linkini Getiren Yer) ---
builder.defineStreamHandler(async ({ id, type }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();
    
    const endpoint = type === 'tv' ? `/api/channel/${realId}/${SW_KEY}/` : 
                    (type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`);

    try {
        const res = await fetch(BASE_URL + endpoint, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        let streams = [];

        if (type === 'tv') {
            // TV Kanalları genellikle doğrudan "url" anahtarıyla gelir
            if (data.url) {
                streams.push({
                    name: "RECTV LIVE",
                    title: `Canlı Yayın (7/24)`,
                    url: data.url
                });
            }
        } else {
            // Film ve Dizi kaynakları
            const sources = data.sources || [];
            sources.forEach((src, i) => {
                streams.push({
                    name: "RECTV",
                    title: `${src.title || 'Kaynak'} - ${src.quality || 'HD'}`,
                    url: src.url
                });
            });
        }

        return { streams };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
