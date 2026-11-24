export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Sadece POST istekleri kabul edilir." });
  }

  const { brand, model, year, km, gear, fuel } = req.body || {};

  if (!brand || !model || !year || !gear || !fuel) {
    return res.status(400).json({ error: "Marka, model, yıl, vites ve yakıt alanları zorunludur." });
  }

  const SERP_API_KEY = process.env.SERP_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "Sunucuda GEMINI_API_KEY tanımlanmamış." });
  }

  try {
    let searchSnippets = "Arama API anahtarı eklenmediği için web araması atlandı.";
    if (SERP_API_KEY) {
      const query = `${year} ${brand} ${model} ${gear} ${fuel} satılık fiyat TL`;
      const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&gl=tr&hl=tr&num=12&api_key=${SERP_API_KEY}`;
      const serpRes = await fetch(serpUrl);
      if (serpRes.ok) {
        const serpData = await serpRes.json();
        const organic = serpData.organic_results || [];
        searchSnippets = organic
          .map((item, idx) => `${idx + 1}. Başlık: ${item.title || ""} | Özet: ${item.snippet || ""}`)
          .join("\n");
      }
    }

    const prompt = `
Sen Türkiye ikinci el otomobil piyasası ve mekanik ekspertiz uzmanısın.
İncelenen araç:
- Marka: ${brand}
- Model: ${model}
- Model Yılı: ${year}
- Vites: ${gear}
- Yakıt: ${fuel}
- Kilometre: ${km ? km + " km" : "Belirtilmedi"}

Aşağıdaki Google arama sonuçlarını incele:
${searchSnippets}

GÖREVLERİN (SADECE GEÇERLİ BİR JSON DÖNDÜR, MARKDOWN VEYA EK AÇIKLAMA YAZMA):
1. "extractedPrices": Arama sonuçlarından SADECE ${year} model ve ${gear} vites olan ${brand} ${model} araçların TL cinsinden gerçekçi satış fiyatlarını tam sayı (number) dizisi olarak ayıkla (Örn: [1125000, 1180000]). Farklı model yılına, farklı vites tipine ait fiyatları, kiralama fiyatlarını veya parça fiyatlarını KESİNLİKLE alma. Hiç geçerli fiyat bulamazsan boş dizi [] döndür.
2. "averagePrice": Ayıkladığın geçerli fiyatların ortalamasını tam sayı olarak hesapla. Fiyat yoksa null döndür.
3. "chronics": Bu spesifik marka, model, kasa/motor nesli (${year}), ${gear} şanzıman ve ${fuel} yakıt tipinin bilinen kronik sorunlarını ve belirtilerini 4-6 madde halinde yaz. KESİNLİKLE para, tamir ücreti, bakım masrafı veya TL tutarı YAZMA; sadece arızayı ve belirtisini yaz.
4. "inspection": Bu araca özel, ekspertizde ilk bakılması gereken kritik noktaları önem sırasına göre 5-6 madde halinde yaz (şanzıman, motor, boya/değişen, şasi/podye, tramer, yol testi vb.).

Döndüreceğin JSON formatı birebir şu olmalı:
{
  "extractedPrices": [1150000],
  "averagePrice": 1150000,
  "chronics": ["Arıza adı: Belirtisi..."],
  "inspection": ["Kontrol noktası: Neye bakılmalı..."]
}
`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(502).json({ error: "Yapay zeka servisi yanıt vermedi: " + errText });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(502).json({ error: "Yapay zekadan boş yanıt döndü." });
    }

    const parsedResult = JSON.parse(rawText);
    return res.status(200).json(parsedResult);
  } catch (error) {
    return res.status(500).json({ error: "Analiz sırasında sunucu hatası: " + error.message });
  }
}
