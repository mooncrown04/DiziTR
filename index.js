import express from 'express';
import fetch from 'node-fetch';
import NodeCache from 'node-cache';

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

// --- AYARLAR ---
const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

// --- SINEWIX MANTIĞI MANIFEST (DÜZELTİLMİŞ) ---
const MANIFEST = {
    id: "org.rectv.pro.v7", // ID her güncellemede değiştirilmeli (Cache için)
    version: "5.1.0",
    name: "RECTV Pro",
    description: "RecTV Canlı TV, Film ve Dizi Eklentisi",
    // Sinewix'teki gibi kaynak bazlı idPrefixes tanımları
    resources: [
        { name: "catalog", types: ["movie", "series", "tv"], idPrefixes: ["rectv"] },
        { name: "meta", types: ["movie", "series", "tv"], idPrefixes: ["rectv"] },
        { name: "stream", types: ["movie", "series", "tv"], idPrefixes: ["rectv", "tt"] }
    ],
    types: ["movie", "series", "tv"],
    catalogs: [
        { id: "rectv-canli-tv", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "skip" }] },
        { id: "rectv-son-filmler", type: "movie", name: "🎬 RECTV Son Filmler", extra: [{ name: "skip" }] },
        { id: "rectv-son-diziler", type: "series", name: "🍿 RECTV Son Diziler", extra: [{ name: "skip" }] },
        { id: "rectv-aksiyon", type: "movie", name: "💥 Aksiyon", extra: [{ name: "skip" }] },
        { id: "rectv-korku", type: "movie", name: "👻 Korku", extra: [{ name: "skip" }] }
    ],
    idPrefixes: ["rectv", "tt"] // Sinewix'in 'sinewix' prefix'i yerine 'rectv'
};

// --- API KATALOG EŞLEŞTİRMELERİ ---
const CATALOG_MAP = {
    'rectv-canli-tv': '/api/channel/by/filtres/0/0/PAGE/' + SW_KEY + '/',
    'rectv-son-filmler': '/api/movie/by/filtres/0/created/PAGE/' + SW_KEY + '/',
    'rectv-son-diziler': '/api/serie/by/filtres/0/created/PAGE/' + SW_KEY + '/',
    'rectv-aksiyon': '/api/movie/by/filtres/1/created/PAGE/' + SW_KEY + '/',
    'rectv-korku': '/api/movie/by/filtres/8/created/PAGE/' + SW_KEY + '/'
};

// --- YARDIMCI FONKSİYONLAR ---
async function getAuthToken() {
    const cached = cache.get("token");
    if (cached) return cached;
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const token = await res.text();
        cache.set("token", token.trim(), 1800);
        return token.trim();
    } catch (e) { return null; }
}

// --- CORS AYARLARI ---
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// --- ANA YOLLAR ---
app.get('/', (req, res) => res.redirect('/manifest.json'));
app.get('/manifest.json', (req, res) => res.json(MANIFEST));

// --- KATALOG (CATALOG) HANDLER ---
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    let skip = 0;
    if (req.params.extra) {
        const match = req.params.extra.match(/skip=(\d+)/);
        if (match) skip = parseInt(match[1]);
    }

    const page = Math.floor(skip / 20) + 1;
    const path = CATALOG_MAP[id];
    if (!path) return res.json({ metas: [] });

    try {
        const token = await getAuthToken();
        const url = BASE_URL + path.replace('PAGE', page);
        const response = await fetch(url, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
        const data = await response.json();
        
        const rawItems = data.channels || data.posters || data.series || [];
        const metas = rawItems.map(item => ({
            id: `rectv:${item.id}`, // Sinewix gibi 'rectv:ID' formatı
            type: type,
            name: item.title || item.name,
            poster: item.poster_path || item.image || item.thumbnail,
            description: item.label || "RECTV"
        }));

        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

// --- DETAY (META) HANDLER ---
app.get('/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    if (!id.startsWith('rectv:')) return res.json({ meta: null });

    const realId = id.split(':')[1];
    const token = await getAuthToken();
    
    let endpoint = type === 'tv' ? `/api/channel/${realId}/${SW_KEY}/` :
                   type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` :
                   `/api/series/show/${realId}/${SW_KEY}/`;

    try {
        const response = await fetch(BASE_URL + endpoint, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
        const data = await response.json();

        const meta = {
            id: id,
            type: type,
            name: data.title || data.name,
            poster: data.poster_path || data.image || data.thumbnail,
            background: data.backdrop_path || data.image,
            description: data.overview || data.description || "RECTV Yayını",
        };

        if (type === 'series' && data.seasons) {
            meta.videos = data.seasons.flatMap(s => 
                (s.episodes || []).map(e => ({
                    id: `${id}:${s.title.match(/\d+/)[0]}:${e.title.match(/\d+/)[0]}`,
                    title: e.title,
                    season: parseInt(s.title.match(/\d+/)[0]),
                    episode: parseInt(e.title.match(/\d+/)[0])
                }))
            );
        }
        res.json({ meta });
    } catch (e) {
        res.json({ meta: null });
    }
});

// --- YAYIN (STREAM) HANDLER ---
app.get('/stream/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': 'Bearer ' + token };
    let streams = [];

    // Kendi kataloğumuzdan gelenler (rectv:...)
    if (id.startsWith('rectv:')) {
        const parts = id.split(':');
        const realId = parts[1];

        try {
            if (type === 'tv') {
                const r = await fetch(`${BASE_URL}/api/channel/${realId}/${SW_KEY}/`, { headers });
                const d = await r.json();
                if (d.url) streams.push({ name: 'RECTV TV', title: 'Canlı Yayın', url: d.url });
            } else if (type === 'movie') {
                const r = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, { headers });
                const d = await r.json();
                (d.sources || []).forEach((src, idx) => {
                    streams.push({ name: 'RECTV FILM', title: `Kaynak ${idx + 1}`, url: src.url });
                });
            } else if (type === 'series' && parts.length === 4) {
                // parts[0]=rectv, parts[1]=diziId, parts[2]=sezon, parts[3]=bolum
                const r = await fetch(`${BASE_URL}/api/season/by/serie/${realId}/${SW_KEY}/`, { headers });
                const seasons = await r.json();
                const season = seasons.find(s => s.title.includes(parts[2]));
                const episode = season?.episodes.find(e => e.title.includes(parts[3]));
                (episode?.sources || []).forEach((src, idx) => {
                    streams.push({ name: 'RECTV DIZI', title: `Kaynak ${idx + 1}`, url: src.url });
                });
            }
        } catch (e) {}
    }
    res.json({ streams });
});

app.listen(PORT, () => console.log(`RECTV v7 Sinewix Style — Port ${PORT}`));
