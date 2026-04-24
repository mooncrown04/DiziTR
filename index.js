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
];

// --- MANIFEST ---
const manifest = {
    id: 'org.rectv.pro',
    version: '1.3.0',
    name: 'RECTV Pro',
    description: 'RecTV Katalog, Meta ve İzleme Eklentisi',
    catalogs: RECTV_CATALOGS.map(c => ({
        id: c.id,
        type: c.type,
        name: c.name,
        extra: [{ name: 'skip' }]
    })),
    resources: ['catalog', 'meta', 'stream'], // Meta eklendi
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
    const page = Math.floor(skip / 20) + 1;
    const token = await getAuthToken();
    
    const finalUrl = BASE_URL + catalog.path.replace('PAGE', page);
    
    try {
        const res = await fetch(finalUrl, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        const items = data.posters || data.series || [];

        const metas = items.map(item => ({
            id: `rec_${item.id}`, 
            type: catalog.type,
            name: item.title || item.name,
            poster: item.poster_path || item.image,
            description: item.label || "İçerik detayı için tıklayın."
        }));

        return { metas };
    } catch (err) {
        return { metas: [] };
    }
});

// --- META HANDLER (Hata Çözümü Burası) ---
builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[Meta Request] ${id}`);
    
    // Eğer ID 'rec_' ile başlıyorsa (bizim kataloğumuz)
    if (id.startsWith('rec_')) {
        const realId = id.replace('rec_', '');
        const token = await getAuthToken();
        const endpoint = type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`;
        
        try {
            const res = await fetch(BASE_URL + endpoint, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
            const data = await res.json();

            return {
                meta: {
                    id: id,
                    type: type,
                    name: data.title || data.name,
                    poster: data.poster_path || data.image,
                    background: data.backdrop_path || data.image,
                    description: data.overview || data.label || "Açıklama bulunmuyor.",
                    // Dizi ise bölümleri oluştur (Stremio için kritik)
                    videos: type === 'series' && data.seasons ? data.seasons.flatMap(s => 
                        (s.episodes || []).map(e => ({
                            id: `${id}:${s.title.match(/\d+/)[0]}:${e.title.match(/\d+/)[0]}`,
                            title: e.title,
                            season: parseInt(s.title.match(/\d+/)[0]),
                            episode: parseInt(e.title.match(/\d+/)[0])
                        }))
                    ) : undefined
                }
            };
        } catch (e) {
            return { meta: { id, type, name: "Yüklenemedi" } };
        }
    }
    
    // Standart tt ID'leri için Cinemeta zaten çalışır
    return { meta: {} };
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[Stream Request] ${id}`);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': 'Bearer ' + token };

    let streams = [];

    // Case 1: Kendi kataloğumuzdan gelen ID (rec_...)
    if (id.startsWith('rec_')) {
        const parts = id.split(':');
        const realId = parts[0].replace('rec_', '');
        
        if (type === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            (data.sources || []).forEach((src, idx) => {
                streams.push({ name: 'RECTV', title: `Kaynak ${idx + 1}`, url: src.url });
            });
        } else if (type === 'series' && parts.length === 3) {
            // Dizi stream çekme mantığı (Sezon:Bölüm)
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${realId}/${SW_KEY}/`, { headers });
            const seasons = await res.json();
            const season = seasons.find(s => parseInt(s.title.match(/\d+/)) == parts[1]);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/)) == parts[2]);
            (episode?.sources || []).forEach((src, idx) => {
                streams.push({ name: 'RECTV', title: `Kaynak ${idx + 1}`, url: src.url });
            });
        }
    } 
    
    // Case 2: Standart IMDB ID (tt...) gelirse (Arama yapılması gerekir)
    // Bu kısım önceki detaylı arama mantığınla birleştirilebilir.

    return { streams };
});

// --- SERVER ---
const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: process.env.PORT || 7010 });
