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

const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };

export const manifest = {
    id: "com.nuvio.rectv.v481.scraper_mode",
    version: "4.8.1",
    name: "RECTV Ultimate Scraper",
    description: "TV Meta & Global Stream Scraper",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    // Burası kritik: Başka eklentilerin ID'lerini yakalamak için prefixes geniş tutuldu
    idPrefixes: ["rectv_", "ch_", "tv", ""], 
    catalogs: [
        { id: "rc_live", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "search" }, { name: "genre", options: Object.keys(TV_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- KATALOG HANDLER (TV) ---
builder.defineCatalogHandler(async (args) => {
    if (args.id === "rc_live") {
        try {
            const gid = (args.extra?.genre) ? (TV_MAP[args.extra.genre] || "3") : "3";
            const res = await fetch(args.extra?.search ? `${BASE_URL}/api/search/${encodeURIComponent(args.extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/channel/by/filtres/${gid}/0/0/${SW_KEY}//`, { headers: FULL_HEADERS });
            const data = await res.json();
            const channels = args.extra?.search ? (data.channels || []) : (data || []);
            return { metas: channels.map(ch => ({ 
                id: `ch_${ch.id}_${(ch.title || ch.name).replace(/\s+/g, '_')}`, 
                type: "tv", 
                name: ch.title || ch.name, 
                poster: ch.image, 
                posterShape: "landscape"
            })) };
        } catch (e) { return { metas: [] }; }
    }
    return { metas: [] };
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ id, type }) => {
    if (id.startsWith("ch_")) {
        const recId = id.split('_')[1];
        try {
            const res = await fetch(`${BASE_URL}/api/channel/${recId}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const ch = await res.json();
            if (ch) {
                return { meta: {
                    id, type: "tv", name: ch.title || ch.name, poster: ch.image, background: ch.image,
                    description: `📺 ${ch.label} | ⭐ Puan: ${ch.rating}\n\n${ch.description || ""}`,
                    posterShape: "landscape",
                    behaviorHints: { defaultVideoId: id },
                    videos: [{ id, title: "Canlı Yayını Başlat" }]
                }};
            }
        } catch (e) {}
    }
    return { meta: {} };
});

// --- STREAM HANDLER (KAZIYICI / SCRAPER MANTIGI) ---
builder.defineStreamHandler(async (args) => {
    const { id } = args;
    try {
        let finalRecId = null;

        // 1. Durum: ID zaten bizim katalogdan geliyorsa (Hızlı yol)
        if (id.startsWith("ch_")) {
            finalRecId = id.split('_')[1];
        } 
        // 2. Durum: ID başka eklentiden veya genel aramadan geliyorsa (Kazıma yolu)
        else {
            // ID içindeki karmaşık yazıları temizle (Örn: "tv:atv_hd" -> "atv")
            const cleanSearch = id.replace(/[_-]/g, ' ').replace('tv:', '').split(':')[0];
            
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(cleanSearch)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const sData = await sRes.json();
            
            // Arama sonucunda en yakın kanalı bul
            const found = (sData.channels || []).find(c => 
                (c.title || c.name).toLowerCase().includes(cleanSearch.toLowerCase()) ||
                cleanSearch.toLowerCase().includes((c.title || c.name).toLowerCase())
            );
            
            if (found) finalRecId = found.id;
        }

        // Eğer bir ID bulabildiysek yayını getir
        if (finalRecId) {
            const res = await fetch(`${BASE_URL}/api/channel/${finalRecId}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            if (data?.sources) {
                return { streams: data.sources.map(src => ({ 
                    name: "RECTV GLOBAL", 
                    title: `${src.title || "HD Yayın"} - [Scraper]`, 
                    url: src.url 
                })) };
            }
        }
    } catch (e) { console.error("Scraper Hatası:", e); }
    return { streams: [] };
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
