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
    id: "org.rectv.pro.final.v50", // Cache kırmak için yükseltildi
    version: "50.0.0",
    name: "RECTV Pro Ultra",
    description: "RecTV Çalışan Search Engine Entegreli",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv", "tt"],
    catalogs: [
        { id: "rectv-popular", type: "movie", name: "🔥 Popüler İçerikler" }
    ]
};

const builder = new addonBuilder(manifest);

// --- TOKEN ALICI ---
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        const token = await res.text();
        return token.trim();
    } catch (e) { return null; }
}

// --- KATALOG HANDLER (Arama Üzerinden Katalog Oluşturma) ---
builder.defineCatalogHandler(async () => {
    const token = await getAuthToken();
    // Filtreleme çalışmadığı için Popüler bir aramayı katalog yapıyoruz
    const searchUrl = `${BASE_URL}/api/search/2026/${SW_KEY}/`; 

    try {
        const response = await fetch(searchUrl, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const items = data.posters || [];

        const metas = items.map(item => ({
            id: `rectv:movie:${item.id}`,
            type: "movie",
            name: item.title,
            poster: item.image,
            description: item.description || "RECTV"
        }));

        return { metas };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();

    try {
        const response = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        return {
            meta: {
                id: id,
                type: "movie",
                name: data.title,
                poster: data.image,
                background: data.cover,
                description: data.description
            }
        };
    } catch (e) { return { meta: {} }; }
});

// --- STREAM HANDLER (Direkt Link Çekici) ---
builder.defineStreamHandler(async ({ id }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();

    try {
        const response = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        const streams = (data.sources || []).map((src, i) => ({
            name: "RECTV",
            title: `Kaynak ${i + 1} (${src.quality || 'HD'})`,
            url: src.url
        }));

        return { streams };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
