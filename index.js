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
    id: "org.rectv.pro.working.v60", 
    version: "60.0.0",
    name: "RECTV Katalog",
    description: "Kataloglar Aktif - RecTV Engine",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv"],
    catalogs: [
        { 
            id: "rectv-all", 
            type: "movie", 
            name: "🎬 RECTV Tüm Filmler",
            extra: [{ name: "search" }] 
        }
    ]
};

const builder = new addonBuilder(manifest);

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        return (await res.text()).trim();
    } catch (e) { return null; }
}

// --- KATALOG OLUŞTURUCU ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const token = await getAuthToken();
    
    // Filtreleme çalışmadığı için "a" harfiyle arama yapıyoruz (Böylece çoğu film listelenir)
    // Veya direkt popüler bir kelime: "2024", "güncel" vb.
    const query = extra.search ? extra.search : "recep"; 
    const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(query)}/${SW_KEY}/`;

    try {
        const response = await fetch(searchUrl, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        // Senin attığın JSON'daki "posters" kısmını alıyoruz
        const items = data.posters || [];

        const metas = items.map(item => ({
            id: `rectv:movie:${item.id}`,
            type: "movie",
            name: item.title,
            poster: item.image, // JSON'daki görsel linki
            description: item.description || "RecTV Film"
        }));

        return { metas };
    } catch (e) {
        return { metas: [] };
    }
});

// --- META HANDLER (Tıklanan Filmin Detayı) ---
builder.defineMetaHandler(async ({ id }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();

    try {
        const res = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const item = await res.json();

        return {
            meta: {
                id: id,
                type: "movie",
                name: item.title,
                poster: item.image,
                background: item.cover,
                description: item.description,
                runtime: item.duration,
                releaseInfo: item.sublabel
            }
        };
    } catch (e) { return { meta: {} }; }
});

// --- STREAM HANDLER (Video Linki) ---
builder.defineStreamHandler(async ({ id }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();

    try {
        const res = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        // JSON'daki "sources" kısmını Stremio formatına çeviriyoruz
        const streams = (data.sources || []).map((src, i) => ({
            name: "RECTV",
            title: `${src.title || 'Kaynak'} - ${src.quality || 'HD'}`,
            url: src.url
        }));

        return { streams };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
