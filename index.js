import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

// Sinewix'in kullandığı tam Header seti
const FULL_HEADERS = {
    'User-Agent': 'EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)',
    'Accept-Encoding': 'gzip',
    'Connection': 'Keep-Alive',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "org.rectv.pro.final.v30", // Cache kırmak için ID'yi yükselttim
    version: "30.0.0",
    name: "RECTV Pro Ultra",
    description: "RecTV API v7 - Sinewix Engine",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv", "tt"],
    catalogs: [
        { id: "rectv-movie", type: "movie", name: "🎬 RECTV Filmler" },
        { id: "rectv-series", type: "series", name: "🍿 RECTV Diziler" }
    ]
};

const builder = new addonBuilder(manifest);

// --- AKILLI TOKEN ALICI ---
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        const token = await res.text();
        return token.trim();
    } catch (e) { 
        console.error("Token Alınamadı:", e.message);
        return null; 
    }
}

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id }) => {
    const token = await getAuthToken();
    
    // API Yolu
    let apiPath = type === 'movie' 
        ? `/api/movie/by/filtres/0/created/1/${SW_KEY}/` 
        : `/api/serie/by/filtres/0/created/1/${SW_KEY}/`;

    try {
        const response = await fetch(BASE_URL + apiPath, {
            headers: { 
                ...FULL_HEADERS,
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });

        const data = await response.json();
        const rawItems = data.posters || data.series || data.channels || [];

        let metas = rawItems.map(item => ({
            id: `rectv:${type}:${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.poster_path || item.image || item.thumbnail,
            description: "RECTV Pro İçeriği"
        }));

        // --- DEBUG: EĞER LİSTE BOŞSA TEST KARTI GÖSTER ---
        if (metas.length === 0) {
            metas.push({
                id: "rectv:debug:1",
                type: type,
                name: "⚠️ API Bağlantı Hatası",
                poster: "https://via.placeholder.com/500x750?text=API+VERI+GONDERMIYOR",
                description: "Sunucu çalışıyor ama API'den boş liste dönüyor. SW_KEY veya IP engeli olabilir."
            });
        }

        return { metas };
    } catch (e) {
        console.error("Katalog Hatası:", e.message);
        return { metas: [] };
    }
});

// --- DUMMY META & STREAM ---
builder.defineMetaHandler(() => ({ meta: {} }));
builder.defineStreamHandler(() => ({ streams: [] }));

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
