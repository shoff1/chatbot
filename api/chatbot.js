export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { prompt } = req.body;

  if (!prompt || prompt.trim() === "") {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${process.env.API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    const data = await response.json();
    console.log("RAW:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      return res.status(500).json({
        error: data?.error?.message || "Gemini API error",
      });
    }

    // ambil teks paling atas
    let reply =
  data?.candidates?.[0]?.content?.parts?.[0]?.text ||
  data?.candidates?.[0]?.output_text ||
  data?.candidates?.[0]?.output ||
  data?.generations?.[0]?.text ||
  data?.text ||
  "Tidak ada jawaban dari model.";


    return res.status(200).json({ reply });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
