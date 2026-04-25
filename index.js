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
    id: "com.nuvio.rectv.v105", // Nuvio için daha standart bir ID formatı
    version: "105.0.0",
    name: "RECTV Pro Nuvio",
    description: "Nuvio Özel: TV, Film ve Dizi",
    resources: ["catalog", "meta", "stream"],
    types: ["tv", "movie", "series"], // TV'yi başa aldık
    idPrefixes: ["rectv"],
    catalogs: [
        // Nuvio'da ID'lerin çok kısa ve net olması daha iyi sonuç verir
        { id: "nuv-tv", type: "tv", name: "📺 Canlı Kanallar" },
        { id: "nuv-mov", type: "movie", name: "🎬 Vizyon Filmleri" },
        { id: "nuv-ser", type: "series", name: "🍿 Popüler Diziler" }
    ]
};

const builder = new addonBuilder(manifest);

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        return (await res.text()).trim();
    } catch (e) { return null; }
}

builder.defineCatalogHandler(async ({ type, id }) => {
    const token = await getAuthToken();
    
    // Nuvio'nun ana ekranını dolduracak anahtar kelimeler
    let q = "2026";
    if (id === "nuv-tv") q = "ulusal";
    else if (id === "nuv-mov") q = "recep";
    else if (id === "nuv-ser") q = "dizi";

    const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(q)}/${SW_KEY}/`;

    try {
        const response = await fetch(searchUrl, {
            headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        // Senin JSON yapındaki doğru diziyi bulalım
        let raw = [];
        if (id === "nuv-tv") raw = data.channels || [];
        else raw = data.posters || data.series || [];

        const metas = raw.map(item => ({
            id: `rectv:${type}:${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.image || item.thumbnail || "https://via.placeholder.com/300x450?text=TV",
            description: item.label || "RECTV"
        }));

        return { metas };
    } catch (e) { return { metas: [] }; }
});

// Meta ve Stream kısımları (Önceki stabil yapı)
builder.defineMetaHandler(async ({ id, type }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();
    const ep = type === 'tv' ? `/api/channel/${realId}/${SW_KEY}/` : (type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`);
    try {
        const res = await fetch(BASE_URL + ep, { headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` } });
        const d = await res.json();
        return { meta: { id, type, name: d.title || d.name, poster: d.image || d.thumbnail, background: d.cover || d.image, description: d.description } };
    } catch (e) { return { meta: {} }; }
});

builder.defineStreamHandler(async ({ id, type }) => {
    const realId = id.split(':')[2];
    const token = await getAuthToken();
    const ep = type === 'tv' ? `/api/channel/${realId}/${SW_KEY}/` : (type === 'movie' ? `/api/movie/${realId}/${SW_KEY}/` : `/api/series/show/${realId}/${SW_KEY}/`);
    try {
        const res = await fetch(BASE_URL + ep, { headers: { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` } });
        const d = await res.json();
        let streams = [];
        if (type === 'tv' && d.url) streams.push({ name: "TV", title: "Canlı", url: d.url });
        else (d.sources || []).forEach(src => streams.push({ name: "RECTV", title: src.quality || "HD", url: src.url }));
        return { streams };
    } catch (e) { return { streams: [] }; }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
