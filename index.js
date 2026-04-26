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

const manifest = {
    id: "com.nuvio.rectv.v483",
    version: "4.8.3",
    name: "RECTV Pro Fix",
    description: "Hybrid ID Support (tt/ch/raw)",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "ch_"],
    catalogs: [
        { id: "rectv_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }] },
        { id: "rectv_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }] },
        { id: "rectv_live", type: "tv", name: "📺 RECTV Canlı TV" }
    ]
};

const builder = new addonBuilder(manifest);

// --- KATALOG VE META (Önceki mantıkla aynı) ---
builder.defineCatalogHandler(async (args) => {
    // Katalog kodun burada (aynen kalabilir)
    return { metas: [] }; // Örnek olarak boş dönüyorum, sen kendi katalog mantığını buraya koyabilirsin
});

builder.defineMetaHandler(async ({ id, type }) => ({ meta: { id, type, name: "Yükleniyor..." } }));

// --- KRİTİK DÜZELTME: STREAM HANDLER ---
export async function getStreams(args) {
    let { id, type } = args;
    
    // Nuvio bazen string beklerken sayı gönderirse toString ile sağlama alıyoruz
    id = id ? id.toString() : "";

    try {
        // 1. CANLI TV (ch_ yapısı)
        if (id.startsWith("ch_")) {
            const cName = id.replace("ch_", "");
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(cName)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const sData = await sRes.json();
            const found = (sData.channels || []).find(c => (c.title || c.name).toLowerCase() === cName.toLowerCase());
            if (found) {
                const res = await fetch(`${BASE_URL}/api/channel/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const data = await res.json();
                return (data.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url }));
            }
            return [];
        }

        // 2. ID AYRIŞTIRMA (tt123:1:1 veya sadece 262848 gelme durumuna göre)
        let imdbId = id;
        let sNum = null;
        let eNum = null;

        if (id.includes(":")) {
            [imdbId, sNum, eNum] = id.split(":");
        }

        // TMDB üzerinden içeriği bul (İster ttID gelsin ister saf TMDB ID)
        let tmdbUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        
        // Eğer ID "tt" ile başlamıyorsa ve sadece rakamsa, doğrudan TMDB ID olarak sorgula
        if (!imdbId.startsWith("tt")) {
            const sType = type === 'series' ? 'tv' : 'movie';
            tmdbUrl = `https://api.themoviedb.org/3/${sType}/${imdbId}?api_key=${TMDB_KEY}&language=tr-TR`;
        }

        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        
        // Saf TMDB ID sorgusunda sonuç doğrudan tmdbData'dır, ttID sorgusunda movie_results içindedir
        const obj = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0] || tmdbData;
        if (!obj || (!obj.title && !obj.name)) return [];

        const title = obj.title || obj.name;
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        
        const pool = (type === 'series') ? (sData.series || []) : (sData.posters || []);
        const found = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase()));

        if (found) {
            const res = await fetch(`${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();

            // Dizi ve bölüm bilgisi kontrolü
            if (type === "series" && sNum && eNum) {
                const season = (data.seasons || []).find(sn => sn.season_number == sNum);
                const episode = (season?.episodes || []).find(en => en.episode_number == eNum);
                if (episode) {
                    return (episode.sources || []).map(src => ({ name: "RECTV", title: `S${sNum}E${eNum} - ${src.title}`, url: src.url }));
                }
            }

            // Film veya dizi genel kaynakları
            return (data.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url }));
        }
    } catch (e) { 
        console.error("Stream Error:", e.message);
        return []; 
    }
    return [];
}

builder.defineStreamHandler(async (args) => ({ streams: await getStreams(args) }));
serveHTTP(builder.getInterface(), { port: PORT });
