const manifest = {
    id: "com.nuvio.rectv.pro.split.v380",
    version: "3.8.0",
    name: "RECTV Pro",
    description: "Film ve Dizi Katalogları Ayrıştırıldı",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["m_", "s_"], // Film için m_, Dizi için s_ öneki
    catalogs: [
        {
            id: "rectv_movie",
            type: "movie",
            name: "🎬 RECTV FİLMLER",
            extra: [{ name: "search", isRequired: false }]
        },
        {
            id: "rectv_series",
            type: "series",
            name: "🍿 RECTV DİZİLER",
            extra: [{ name: "search", isRequired: false }]
        }
    ]
};

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async (args) => {
    const { type, extra } = args;
    let rawItems = [];

    try {
        if (extra && extra.search) {
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            const response = await fetch(searchUrl, { headers: FULL_HEADERS });
            const data = await response.json();

            if (type === 'series') {
                rawItems = data.series || [];
            } else {
                rawItems = data.posters || [];
            }
        } else {
            const apiPath = type === 'series' ? 'serie' : 'movie';
            const targetUrl = `${BASE_URL}/api/${apiPath}/by/filtres/0/created/0/${SW_KEY}/`;
            const response = await fetch(targetUrl, { headers: FULL_HEADERS });
            const data = await response.json();
            rawItems = Array.isArray(data) ? data : (data.posters || []);
        }

        const metas = rawItems.slice(0, 20).map(item => {
            // ÖNEMLİ: ID'nin başına türe göre önek ekliyoruz
            // Film ise: m_123, Dizi ise: s_123
            const prefix = type === 'series' ? "s_" : "m_";
            return {
                id: `${prefix}${item.id}`, 
                type: type,
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

// --- STREAM HANDLER ---
builder.defineStreamHandler(async (args) => {
    const { id, type } = args;
    // Öneki temizleyip gerçek ID'yi alıyoruz (s_123 -> 123)
    const rectvId = id.replace("s_", "").replace("m_", "");

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
