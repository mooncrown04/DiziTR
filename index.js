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
    id: "org.rectv.pro.multi.v70",
    version: "70.0.0",
    name: "RECTV Çoklu Katalog",
    description: "Tüm kategoriler arama motoru ile besleniyor.",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv"],
    catalogs: [
        { id: "rectv-populer", type: "movie", name: "🔥 Popüler Filmler" },
        { id: "rectv-yerli", type: "movie", name: "🇹🇷 Yerli Filmler" },
        { id: "rectv-aksiyon", type: "movie", name: "💥 Aksiyon & Macera" },
        { id: "rectv-dizi", type: "series", name: "📺 Güncel Diziler" }
    ]
};

const builder = new addonBuilder(manifest);

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        return (await res.text()).trim();
    } catch (e) { return null; }
}

// --- AKILLI KATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const token = await getAuthToken();
    
    // Hangi katalog için hangi kelimeyi aratacağımızı seçiyoruz
    let searchTerm = "2024"; // Varsayılan

    if (extra.search) {
        searchTerm = extra.search; // Kullanıcı bir şey aratırsa onu getir
    } else {
        if (id === "rectv-yerli") searchTerm = "yerli";
        else if (id === "rectv-aksiyon") searchTerm = "aksiyon";
        else if (id === "rectv-dizi") searchTerm = "2023"; // Diziler için genel bir tarih
        else if (id === "rectv-populer") searchTerm = "recep"; // Popülerler için sağlam bir başlangıç
    }

    const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(searchTerm)}/${SW_KEY}/`;

    try {
        const response = await fetch(searchUrl, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        // JSON'dan posterleri veya dizileri çek
        const rawItems = (type === 'movie' ? data.posters : data.series) || data.posters || [];

        const metas = rawItems.map(item => ({
            id: `rectv:${type}:${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.image || item.poster_path,
            description: item.label || "RECTV"
        }));

        return { metas };
    } catch (e) {
        return { metas: [] };
    }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();
    const endpoint = type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`;

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
                poster: data.image || data.poster_path,
                background: data.cover || data.backdrop_path,
                description: data.description || data.overview
            }
        };
    } catch (e) { return { meta: {} }; }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ id, type }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();
    
    // Önce detay sayfasına gidip kaynakları (sources) alıyoruz
    const endpoint = type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`;

    try {
        const res = await fetch(BASE_URL + endpoint, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        let sources = data.sources || [];

        // Eğer diziyse (Örnek olarak ilk sezon ilk bölüm kaynaklarını getirir - Geliştirilebilir)
        if (type === 'series' && data.seasons && data.seasons[0]) {
            sources = data.seasons[0].episodes[0].sources || [];
        }

        const streams = sources.map((src, i) => ({
            name: "RECTV",
            title: `${src.title || 'Kaynak'} - ${src.quality || 'HD'}`,
            url: src.url
        }));

        return { streams };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
