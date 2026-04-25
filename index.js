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

const manifest = {
    id: "com.nuvio.rectv.final.split.v370",
    version: "3.7.0",
    name: "RECTV Pro Dual",
    description: "Film ve Dizi Arama Ayrıştırıldı",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
        {
            id: "rectv_movie",
            type: "movie",
            name: "🎬 RECTV Filmler",
            extra: [{ name: "search", isRequired: false }]
        },
        {
            id: "rectv_series",
            type: "series",
            name: "🍿 RECTV Diziler",
            extra: [{ name: "search", isRequired: false }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- KATALOG HANDLER (Burada tür ayrımı kritik) ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    let rawItems = [];

    try {
        if (extra && extra.search) {
            // ARAMA URL: RecTV'den her şeyi çekiyoruz
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            const response = await fetch(searchUrl, { headers: FULL_HEADERS });
            const data = await response.json();

            // ÖNEMLİ: Gelen veriyi türüne göre kesin olarak ayır
            if (type === 'series') {
                rawItems = data.series || [];
            } else {
                rawItems = data.posters || [];
            }
        } else {
            // ANA SAYFA FİLTRELERİ
            const apiPath = type === 'series' ? 'serie' : 'movie';
            const targetUrl = `${BASE_URL}/api/${apiPath}/by/filtres/0/created/0/${SW_KEY}/`;
            const response = await fetch(targetUrl, { headers: FULL_HEADERS });
            const data = await response.json();
            rawItems = Array.isArray(data) ? data : (data.posters || []);
        }

        // Stremio'nun dizileri görmesi için Meta objesini doğru türle besliyoruz
        const metas = rawItems.slice(0, 20).map(item => {
            // Her item için geçici bir ID (rectv_ID) veriyoruz. 
            // IMDb eşleşmesini MetaHandler'a bırakıyoruz ki katalog hızlı yüklensin.
            return {
                id: `rectv_${item.id}_${type}`, 
                type: type, // Burada 'series' veya 'movie' olması hayati
                name: item.title || item.name,
                poster: item.image || item.thumbnail,
                description: `RecTV | ${item.year || item.sublabel || ''}`
            };
        });

        return { metas };
    } catch (e) {
        return { metas: [] };
    }
});

// --- META HANDLER ---
builder.defineMetaHandler(async (args) => {
    // Burada tetiklenen ID'yi IMDb'ye çevirip meta verisini dönüyoruz
    return { meta: { id: args.id, type: args.type, name: "Yükleniyor..." } };
});

// --- STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const { id, type } = args;
    // Geçici ID'den gerçek RecTV ID'sini çıkarıyoruz (rectv_123_series -> 123)
    const rectvId = id.split('_')[1];

    try {
        const apiPath = type === 'series' ? 'serie' : 'movie';
        const res = await fetch(`${BASE_URL}/api/${apiPath}/${rectvId}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const data = await res.json();
        
        const streams = (data.sources || []).map(src => ({
            name: "RECTV",
            title: `${src.quality || "HD"} - ${src.title || "Kaynak"}`,
            url: src.url
        }));

        return { streams };
    } catch (e) {
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
