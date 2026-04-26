import re
import json
import os
import shutil
import requests

def slugify(text):
    """ID ve Dosya adları için metni temizler."""
    if not text: return "diger"
    text = text.lower()
    tr_map = str.maketrans("çığöşü ", "cigosu-")
    text = text.translate(tr_map).replace(" ", "-")
    text = re.sub(r'[^\w\-]', '', text)
    return text.strip("-")

def process_stremio_addon():
    # --- 1. LİSTEYİ İNDİR ---
    m3u_url = "https://raw.githubusercontent.com/mooncrown04/m3ubirlestir/refs/heads/main/birlesik_tv.m3u"
    print(f"Liste indiriliyor: {m3u_url}")
    try:
        res = requests.get(m3u_url, timeout=15)
        res.raise_for_status()
        m3u_content = res.text
    except Exception as e:
        print(f"İndirme hatası: {e}")
        return

    # --- 2. TEMİZLİK VE KLASÖR HAZIRLIĞI ---
    folders = ["stream/tv", "meta/tv", "catalog/tv"]
    for folder_path in ["stream", "meta", "catalog"]:
        if os.path.exists(folder_path):
            shutil.rmtree(folder_path)
    
    for folder in folders:
        os.makedirs(folder, exist_ok=True)

    # --- 3. KATEGORİ VE KANAL AYARLARI ---
    channels = {}
    categories = {}
    channel_count = 0 

    category_map = {
        "ulusal": "📺 Ulusal Kanallar",
        "spor": "⚽ Spor Dünyası",
        "haberler": "📰 Haber",
        "sinema": "🎬 Sinema & Dizi",
        "dizi": "🎬 Sinema & Dizi",
        "film": "🎞️ FİLM",
        "belgesel": "🦒 Belgesel & Yaşam",
        "muzik": "🎵 Müzik",
        "animasyon": "🎨 Animasyon",
        "cocuk": "🧸 Çocuk",
        "yetiskin": "🔞 Yetişkin",
        "diger": "📡 Diğer Kanallar"
    }

    lines = m3u_content.splitlines()
    current_info = None

    for line in lines:
        # Sınır kontrolü
        if channel_count >= 100:
            break

        line = line.strip()
        
        if line.startswith("#EXTINF:"):
            group_match = re.search(r'group-title="([^"]+)"', line)
            logo_match = re.search(r'tvg-logo="([^"]+)"', line)
            name_parts = line.split(",")
            name = name_parts[-1].strip() if len(name_parts) > 1 else "Bilinmeyen Kanal"
            
            current_info = {
                "group": group_match.group(1) if group_match else "DİĞER",
                "logo": logo_match.group(1) if logo_match else "https://via.placeholder.com/300",
                "name": name
            }
        
        elif line.startswith("http") and current_info:
            chan_id = f"ch_{slugify(current_info['name'])}"
            cat_id = f"cat_{slugify(current_info['group'])}"
            
            # Daha önce eklenmemişse işleme al
            if chan_id not in channels:
                channels[chan_id] = {
                    "name": current_info['name'],
                    "group": current_info['group'],
                    "logo": current_info['logo'],
                    "streams": [{
                        "name": current_info['name'],
                        "title": f"{current_info['name']} | {current_info['group']}",
                        "url": line,
                        "behaviorHints": {"notClickable": False, "bingeGroup": chan_id}
                    }]
                }
                channel_count += 1 

                if cat_id not in categories:
                    raw_group = slugify(current_info['group'])
                    display_name = category_map.get(raw_group, f"📺 {current_info['group']}")
                    categories[cat_id] = {"display_name": display_name, "metas": []}
                
                categories[cat_id]["metas"].append({
                    "id": chan_id,
                    "type": "tv",
                    "name": current_info['name'],
                    "poster": current_info['logo'],
                    "description": f"{current_info['group']} kategorisinde yayın."
                })
            current_info = None

    # --- 4. DOSYA ÜRETİMİ ---
    for cid, info in channels.items():
        with open(f"stream/tv/{cid}.json", 'w', encoding='utf-8') as f:
            json.dump({"streams": info["streams"]}, f, ensure_ascii=False)
        
        meta_data = {
            "meta": {
                "id": cid, "type": "tv", "name": info["name"], 
                "poster": info["logo"], "background": info["logo"]
            }
        }
        with open(f"meta/tv/{cid}.json", 'w', encoding='utf-8') as f:
            json.dump(meta_data, f, ensure_ascii=False)

    for cat_id, data in categories.items():
        with open(f"catalog/tv/{cat_id}.json", 'w', encoding='utf-8') as f:
            json.dump({"metas": data["metas"]}, f, ensure_ascii=False)

    manifest = {
        "id": "MoOnCrOwN-KATALOG",
        "version": "1.0.0",
        "name": "MoOnCrOwN-TV",
        "description": "MoOnCrOwN Canlı Yayınlar (İlk 100 Kanal)",
        "resources": ["catalog", "meta", "stream"],
        "types": ["tv"],
        "idPrefixes": ["ch"],
        "catalogs": [{"id": k, "type": "tv", "name": v['display_name']} for k, v in categories.items()]
    }
    
    with open("manifest.json", 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"İşlem Tamamlandı! {channel_count} kanal eklendi.")

if __name__ == "__main__":
    process_stremio_addon()
