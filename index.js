import express from 'express';
import fetch from 'node-fetch';
import NodeCache from 'node-cache';

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

// --- SINEWIX FORMATINDA MANIFEST ---
const MANIFEST = {
    id: "org.rectv.pro.v5",
    version: "5.0.0",
    name: "RECTV Pro v5",
    description: "RecTV Canlı TV, Film ve Dizi Kaynakları",
    catalogs: [
        { id: "rec-canli-tv", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "skip" }] },
        { id: "rec-son-filmler", type: "movie", name: "🎬 RECTV Son Filmler", extra: [{ name: "skip" }] },
        { id: "rec-son-diziler", type: "series", name: "🍿 RECTV Son Diziler", extra: [{ name: "skip" }] },
        { id: "rec-aksiyon", type: "movie", name: "💥 Aksiyon Filmleri", extra: [{ name: "skip" }] },
        { id: "rec-korku", type: "movie", name: "👻 Korku Filmleri", extra: [{ name: "skip" }] }
    ],
    resources: [
        { name: "catalog", types: ["movie", "series", "tv"], idPrefixes: ["rec_"] },
        { name: "meta", types: ["movie", "series", "tv"], idPrefixes: ["rec_"] },
        { name: "stream", types: ["movie", "series", "tv"], idPrefixes: ["rec_", "tt"] }
    ],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rec_", "tt"]
};

// --- KATALOG URL YOLLARI ---
const CATALOG_PATHS = {
    'rec-canli-tv': '/api/channel/by/filtres/0/0/PAGE/' + SW_KEY + '/',
    'rec-son-filmler': '/api/movie/by/filtres/0/created/PAGE/' + SW_KEY + '/',
    'rec-son-diziler': '/api/serie/by/filtres/0/created/PAGE/' + SW_KEY + '/',
    'rec-aksiyon': '/api/movie/by/filtres/1/created/PAGE/' + SW_KEY + '/',
    'rec-korku': '/api/movie/by/filtres/8/created/PAGE/' + SW_KEY + '/'
};

// --- YARDIMCILAR ---
async function getAuthToken() {
    const cached = cache.get("auth_token");
    if (cached) return cached;
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const token = await res.text();
        cache.set("auth_token", token.trim(), 1800);
        return token.trim();
    } catch (e) { return null; }
}

// --- CORS ---
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// --- ROUTES ---
app.get('/', (req, res) => res.redirect('/manifest.json'));
app.get('/manifest.json', (req, res) => res.json(MANIFEST));

// --- CATALOG HANDLER ---
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    let skip = 0;
    if (req.params.extra) {
        const m = req.params.extra.match(/skip=(\d+)/);
        if (m) skip = parseInt(m[1]);
    }

    const page = Math.floor(skip / 20) + 1;
    const pathTemplate = CATALOG_PATHS[id];
    if (!pathTemplate) return res.json({ metas: [] });

    try {
        const token = await getAuthToken();
        const finalUrl = BASE_URL + pathTemplate.replace('PAGE', page);
        const response = await fetch(finalUrl, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
        const data = await response.json();
        
        const items = data.channels || data.posters || data.series || [];
        const metas = items.map(item => ({
            id: `rec_${item.id}`,
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

// --- META HANDLER ---
app.get('/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    if (!id.startsWith('rec_')) return res.json({ meta: null });

    const realId = id.replace('rec_', '');
    const token = await getAuthToken();
    
    let endpoint;
    if (type === 'tv') endpoint = `/api/channel/${realId}/${SW_KEY}/`;
    else if (type === 'movie') endpoint = `/api/movie/${realId}/${SW_KEY}/`;
    else endpoint = `/api/series/show/${realId}/${SW_KEY}/`;

    try {
        const response = await fetch(BASE_URL + endpoint, { headers: { ...HEADERS, 'Authorization': 'Bearer ' + token } });
        const data = await response.json();

        const meta = {
            id: id,
            type: type,
            name: data.title || data.name,
            poster: data.poster_path || data.image || data.thumbnail,
            background: data.backdrop_path || data.image,
            description: data.overview || data.description || "RECTV",
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

// --- STREAM HANDLER ---
app.get('/stream/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': 'Bearer ' + token };
    let streams = [];

    if (id.startsWith('rec_')) {
        const parts = id.split(':');
        const realId = parts[0].replace('rec_', '');

        try {
            if (type === 'tv') {
                const r = await fetch(`${BASE_URL}/api/channel/${realId}/${SW_KEY}/`, { headers });
                const d = await r.json();
                if (d.url) streams.push({ name: 'RECTV', title: 'Canlı Yayın', url: d.url });
            } else if (type === 'movie') {
                const r = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, { headers });
                const d = await r.json();
                (d.sources || []).forEach((src, idx) => {
                    streams.push({ name: 'RECTV', title: `Kaynak ${idx + 1}`, url: src.url });
                });
            } else if (type === 'series' && parts.length === 3) {
                const r = await fetch(`${BASE_URL}/api/season/by/serie/${realId}/${SW_KEY}/`, { headers });
                const seasons = await r.json();
                const season = seasons.find(s => s.title.includes(parts[1]));
                const episode = season?.episodes.find(e => e.title.includes(parts[2]));
                (episode?.sources || []).forEach((src, idx) => {
                    streams.push({ name: 'RECTV', title: `Kaynak ${idx + 1}`, url: src.url });
                });
            }
        } catch (e) {}
    }
    res.json({ streams });
});

app.listen(PORT, () => console.log(`RECTV v5 Sinewix Style — Port ${PORT}`));
