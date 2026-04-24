import stremio from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = stremio;
import fetch from 'node-fetch';

// --- AYARLAR ---
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

// --- KATALOG TANIMLARI ---
const RECTV_CATALOGS = [
    { id: 'rec-son-filmler', type: 'movie', name: 'RECTV Son Filmler', path: `/api/movie/by/filtres/0/created/PAGE/${SW_KEY}/` },
    { id: 'rec-son-diziler', type: 'series', name: 'RECTV Son Diziler', path: `/api/serie/by/filtres/0/created/PAGE/${SW_KEY}/` },
    { id: 'rec-aksiyon', type: 'movie', name: 'RECTV Aksiyon', path: `/api/movie/by/filtres/1/created/PAGE/${SW_KEY}/` },
    { id: 'rec-animasyon', type: 'movie', name: 'RECTV Animasyon', path: `/api/movie/by/filtres/13/created/PAGE/${SW_KEY}/` },
    { id: 'rec-bilim-kurgu', type: 'movie', name: 'RECTV Bilim Kurgu', path: `/api/movie/by/filtres/4/created/PAGE/${SW_KEY}/` },
    { id: 'rec-korku', type: 'movie', name: 'RECTV Korku', path: `/api/movie/by/filtres/8/created/PAGE/${SW_KEY}/` }
    // Diğerlerini de aynı formatta buraya ekleyebilirsin
];

// --- MANIFEST ---
const manifest = {
    id: 'org.rectv.pro',
    version: '1.2.0',
    name: 'RECTV Pro',
    description: 'RecTV Katalog ve İzleme Eklentisi',
    catalogs: RECTV_CATALOGS.map(c => ({
        id: c.id,
        type: c.type,
        name: c.name,
        extra: [{ name: 'skip' }]
    })),
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'rec_']
};

const builder = new addonBuilder(manifest);

// --- AUTH TOKEN ---
let cachedToken = null;
async function getAuthToken() {
    if (cachedToken) return cachedToken;
    try {
        const res = await fetch(BASE_URL + "/api/attest/nonce", { headers: HEADERS });
        const text = await res.text();
        cachedToken = text.trim();
        return cachedToken;
    } catch (e) { return null; }
}

// --- CATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const catalog = RECTV_CATALOGS.find(c => c.id === id);
    if (!catalog) return { metas: [] };

    const skip = extra.skip || 0;
    const page = Math.floor(skip / 20) + 1; // Her sayfada 20 içerik varsayıldı
    const token = await getAuthToken();
    
    const finalUrl = BASE_URL + catalog.path.replace('PAGE', page);
    
    try {
        const res = await fetch(finalUrl, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        const items = data.posters || data.series || [];

        const metas = items.map(item => ({
            id: `rec_${item.id}`, // Meta ID'si çakışmaması için prefix
            type: catalog.type,
            name: item.title || item.name,
            poster: item.poster_path || item.image,
            description: item.label
        }));

        return { metas };
    } catch (err) {
        return { metas: [] };
    }
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ type, id }) => {
    // Önceki adımda yazdığımız Stream mantığı buraya gelecek
    // ID 'tt' ile başlıyorsa TMDB üzerinden arama yapacak
    // ID 'rec_' ile başlıyorsa direkt RECTV ID'si üzerinden kaynak çekecek
    console.log("Stream isteği:", id);
    return { streams: [] }; // Basitlik için boş bırakıldı, önceki koddaki mantık eklenebilir
});

// --- SERVER ---
const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: process.env.PORT || 7010 });
