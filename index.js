import stremio from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = stremio;
import fetch from 'node-fetch';

const { PORT = 7010 } = process.env;

// API BİLGİLERİ
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0',
    'Accept': 'application/json'
};

// MANIFEST (Sinewix ile aynı yapı)
const manifest = {
    id: "org.rectv.pro.v7",
    version: "5.2.0",
    name: "RECTV Pro",
    description: "RecTV Film, Dizi ve Canlı TV",
    resources: [
        { name: "catalog", types: ["movie", "series", "tv"], idPrefixes: ["rectv"] },
        { name: "meta", types: ["movie", "series", "tv"], idPrefixes: ["rectv"] },
        { name: "stream", types: ["movie", "series", "tv"], idPrefixes: ["rectv"] }
    ],
    types: ["movie", "series", "tv"],
    catalogs: [
        { id: "rectv-tv", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "skip" }] },
        { id: "rectv-movie", type: "movie", name: "🎬 RECTV Son Filmler", extra: [{ name: "skip" }] },
        { id: "rectv-series", type: "series", name: "🍿 RECTV Son Diziler", extra: [{ name: "skip" }] }
    ],
    idPrefixes: ["rectv"]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---

// API'den Token Al (RecTV için gerekli)
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const token = await res.text();
        return token.trim();
    } catch (e) { return null; }
}

// ID Parçalama (Sinewix'in parseAddonId mantığı)
function parseId(id) {
    const parts = id.split(':'); // rectv:type:id veya rectv:series:id:season:episode
    return {
        prefix: parts[0],
        type: parts[1],
        realId: parts[2],
        season: parts[3] ? parseInt(parts[3]) : null,
        episode: parts[4] ? parseInt(parts[4]) : null
    };
}

// --- HANDLERS ---

// KATALOG HANDLER
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = extra?.skip || 0;
    const page = Math.floor(skip / 20) + 1;
    const token = await getAuthToken();

    let apiPath = '';
    if (id === 'rectv-tv') apiPath = `/api/channel/by/filtres/0/0/${page}/${SW_KEY}/`;
    else if (id === 'rectv-movie') apiPath = `/api/movie/by/filtres/0/created/${page}/${SW_KEY}/`;
    else if (id === 'rectv-series') apiPath = `/api/serie/by/filtres/0/created/${page}/${SW_KEY}/`;

    if (!apiPath) return { metas: [] };

    try {
        const response = await fetch(BASE_URL + apiPath, { 
            headers: { ...HEADERS, 'Authorization': `Bearer ${token}` } 
        });
        const data = await response.json();
        const items = data.channels || data.posters || data.series || [];

        const metas = items.map(item => ({
            id: `rectv:${type}:${item.id}`, // Önemli: rectv:movie:123 formatı
            type: type,
            name: item.title || item.name,
            poster: item.poster_path || item.image || item.thumbnail,
            description: item.label || "RECTV"
        }));

        return { metas };
    } catch (e) {
        return { metas: [] };
    }
});

// META HANDLER
builder.defineMetaHandler(async ({ type, id }) => {
    const { realId } = parseId(id);
    const token = await getAuthToken();
    
    let endpoint = type === 'tv' ? `/api/channel/${realId}/${SW_KEY}/` :
                   type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` :
                   `/api/series/show/${realId}/${SW_KEY}/`;

    try {
        const response = await fetch(BASE_URL + endpoint, { 
            headers: { ...HEADERS, 'Authorization': `Bearer ${token}` } 
        });
        const data = await response.json();

        const meta = {
            id: id,
            type: type,
            name: data.title || data.name,
            poster: data.poster_path || data.image || data.thumbnail,
            background: data.backdrop_path || data.image,
            description: data.overview || data.description,
        };

        // Eğer diziyse bölümleri ekle (Sinewix'teki gibi)
        if (type === 'series' && data.seasons) {
            meta.videos = data.seasons.flatMap(s => {
                const sNum = s.title.match(/\d+/)?.[0] || "1";
                return (s.episodes || []).map(e => {
                    const eNum = e.title.match(/\d+/)?.[0] || "1";
                    return {
                        id: `${id}:${sNum}:${eNum}`, // rectv:series:id:season:ep
                        title: e.title,
                        season: parseInt(sNum),
                        episode: parseInt(eNum),
                        released: new Date().toISOString()
                    };
                });
            });
        }

        return { meta };
    } catch (e) {
        return { meta: {} };
    }
});

// STREAM HANDLER
builder.defineStreamHandler(async ({ type, id }) => {
    const { realId, season, episode } = parseId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
    const streams = [];

    try {
        if (type === 'tv') {
            const r = await fetch(`${BASE_URL}/api/channel/${realId}/${SW_KEY}/`, { headers });
            const d = await r.json();
            if (d.url) streams.push({ name: 'RECTV', title: 'Canlı Yayın', url: d.url });
        } 
        else if (type === 'movie') {
            const r = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, { headers });
            const d = await r.json();
            (d.sources || []).forEach(src => streams.push({ name: 'RECTV', title: src.type, url: src.url }));
        } 
        else if (type === 'series' && season && episode) {
            const r = await fetch(`${BASE_URL}/api/season/by/serie/${realId}/${SW_KEY}/`, { headers });
            const seasons = await r.json();
            // Sezon ve bölüm eşleştirme
            const targetSeason = seasons.find(s => s.title.includes(season.toString()));
            const targetEp = targetSeason?.episodes.find(e => e.title.includes(episode.toString()));
            
            (targetEp?.sources || []).forEach(src => {
                streams.push({ name: 'RECTV', title: src.type || 'Kaynak', url: src.url });
            });
        }
    } catch (e) {}

    return { streams };
});

// SERVER BAŞLATMA
const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT }).then(() => {
    console.log(`✅ RECTV Pro listening on http://localhost:${PORT}/manifest.json`);
});
