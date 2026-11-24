export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Sadece POST istekleri kabul edilir." });
  }

  const { brand, model, year, km, gear, fuel } = req.body || {};
  if (!brand || !model || !year || !gear || !fuel) {
    return res.status(400).json({ error: "Marka, model, yıl, vites ve yakıt zorunludur." });
  }

  const SERP_API_KEY = process.env.SERP_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "Sunucuda GEMINI_API_KEY tanımlanmamış." });
  }

  // Zaman aşımını önlemek için istekleri 7 saniye ile sınırla
  const fetchWithTimeout = async (url, options = {}, ms = 7000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  };

  try {
    let searchSnippets = "Web araması zaman aşımına uğradı veya anahtar yok.";
    if (SERP_API_KEY) {
      try {
        const query = `${year} ${brand} ${model} ${gear} ${fuel} satılık fiyat TL`;
        const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&gl=tr&hl=tr&num=8&api_key=${SERP_API_KEY}`;
        const serpRes = await fetchWithTimeout(serpUrl, {}, 4500);
        if (serpRes.ok) {
          const serpData = await serpRes.json();
          const organic = serpData.organic_results || [];
          searchSnippets = organic
            .slice(0, 8)
            .map((item, idx) => `${idx + 1}. ${item.title || ""} - ${item.snippet || ""}`)
            .join("\n");
        }
      } catch (e) {
        searchSnippets = "Google arama servisi yavaş yanıt verdiği için atlandı.";
      }
    }

    const prompt = `Türkiye ikinci el otomobil uzmanısın. Araç: ${year} ${brand} ${model}, ${gear} vites, ${fuel}, ${km ? km + " km" : "km belirtilmedi"}.
Arama sonuçları:
${searchSnippets}

SADECE şu JSON formatında yanıt ver:
{
  "extractedPrices": [1150000],
  "averagePrice": 1150000,
  "chronics": ["Arıza adı ve belirtisi (para/ücret yazma)"],
  "inspection": ["Ekspertizde kontrol edilecek kritik nokta"]
}
Kurallar:
1. extractedPrices: Sadece ${year} model ve ${gear} vites ${brand} ${model} TL satış fiyatlarını tam sayı dizisi yap. Yoksa [] döndür.
2. averagePrice: Geçerli fiyatların ortalaması (tam sayı) veya null.
3. chronics: 4 madde, kesinlikle TL/masraf/ücret yazma.
4. inspection: 5 madde, önem sırasıyla.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetchWithTimeout(
      geminiUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      },
      7500
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(502).json({ error: "Yapay zeka hatası: " + errText });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(502).json({ error: "Yapay zekadan boş yanıt döndü." });
    }

    return res.status(200).json(JSON.parse(rawText));
  } catch (error) {
    return res.status(500).json({ error: "İstek zaman aşımına uğradı, lütfen tekrar deneyin." });
  }
}
