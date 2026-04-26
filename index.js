import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const MOVIE_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4", "Drama": "8", "Korku": "10", "Dublaj": "26", "Altyazı": "27" };
const SERIES_MAP = { "Aksiyon": "1", "Macera": "2", "Animasyon": "3", "Komedi": "4", "Netflix": "33", "Exxen": "35" };
const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };

export const manifest = {
    id: "com.nuvio.rectv.v481.direct_id",
    version: "4.8.1",
    name: "RECTV Pro Direct",
    description: "ID-Based TV Stream & Meta",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv_", "ch_"],
    catalogs: [
        { id: "rc_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(SERIES_MAP) }] },
        { id: "rc_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] },
        { id: "rc_live", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "search" }, { name: "genre", options: Object.keys(TV_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- KATALOG HANDLER (ID'ye REC ID'sini Gömüyoruz) ---
builder.defineCatalogHandler(async (args) => {
    const { id, extra } = args;
    try {
        if (id === "rc_live") {
            const gid = (extra?.genre) ? (TV_MAP[extra.genre] || "3") : "3";
            const res = await fetch(extra?.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/channel/by/filtres/${gid}/0/0/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            const channels = extra?.search ? (data.channels || []) : (data || []);
            
            return { metas: channels.map(ch => ({ 
                // ID Yapısı: ch_ID_NAME (Stream için ID'yi burada saklıyoruz)
                id: `ch_${ch.id}_${(ch.title || ch.name).replace(/\s+/g, '_')}`, 
                type: "tv", 
                name: ch.title || ch.name, 
                poster: ch.image, 
                posterShape: "landscape"
            })) };
        }
        // Film ve Dizi katalog mantığı aynı kalıyor...
        return { metas: [] }; // Önceki kodlardaki dizi/film mantığını buraya ekleyebilirsin
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => {
    if (id.startsWith("ch_")) {
        const parts = id.split('_');
        const recId = parts[1]; // Gömülü ID'yi al
        const channelName = parts.slice(2).join(' ').replace(/_/g, ' ');

        try {
            // Direkt ID ile kanal detayını çek
            const res = await fetch(`${BASE_URL}/api/channel/${recId}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const ch = await res.json();

            if (ch) {
                return { meta: {
                    id: id,
                    type: "tv",
                    name: ch.title || ch.name,
                    poster: ch.image,
                    background: ch.image,
                    description: `📺 Kategori: ${ch.label}\n⭐ Puan: ${ch.rating}\n👁️ İzlenme: ${ch.views}\n📌 Kalite: ${ch.sublabel}`,
                    posterShape: "landscape",
                    released: new Date().toISOString()
                
                }};
            }
        } catch (e) {}
        return { meta: { id, type: "tv", name: channelName, posterShape: "landscape" } };
    }
    // Film/Dizi Meta mantığı buraya...
    return { meta: {} };
});

// --- STREAM HANDLER (SIFIR ARAMA, DİREKT ID) ---
builder.defineStreamHandler(async (args) => {
    const { id } = args;
    try {
        if (id.startsWith("ch_")) {
            const parts = id.split('_');
            const recId = parts[1]; // Katalogdan gelen gerçek ID

            // Arama yapmadan direkt kanalın sources kısmına git
            const res = await fetch(`${BASE_URL}/api/channel/${recId}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();

            if (data && data.sources) {
                return { streams: data.sources.map(src => ({ 
                    name: "RECTV", 
                    title: `${src.title || src.size} - Direkt Bağlantı`, 
                    url: src.url 
                })) };
            }
        }
    } catch (e) { console.error("Stream Hatası:", e); }
    return { streams: [] };
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
