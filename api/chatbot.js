import { db } from "../firebase.js";

export const config = {
  api: {
    bodyParser: true,
  },
};

const systemPrompt = `
Kamu adalah chatbot untuk aplikasi keuangan ternak.
Jika user memberikan data transaksi, balas dengan JSON format:

{
  "type": "stok" atau "kas",
  "item": "nama barang",
  "qty": angka,
  "price": angka (jika ada),
  "description": "catatan",
  "timestamp": "ISO format"
}

Jika hanya tanya-tanya biasa, jawab normal.
`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { prompt } = req.body;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${process.env.API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: systemPrompt + "\nUser: " + prompt }],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    // 🔥 DEBUG: print all
    console.log("=== RAW GEMINI DATA ===");
    console.log(JSON.stringify(data, null, 2));

    let text = "";

    if (data?.candidates?.length > 0) {
      const parts = data.candidates[0]?.content?.parts || [];

      text = parts
        .map(
          (p) =>
            p.text ||
            p.raw_text ||
            p.markdown ||
            p.output ||
            ""
        )
        .join("\n")
        .trim();
    }

    if (!text) text = "Tidak ada jawaban dari model.";

    let saved = false;
    let parsed = null;

    // cek JSON
    if (text.startsWith("{")) {
      try {
        parsed = JSON.parse(text);

        if (parsed.type && parsed.item) {
          await db.ref(`transactions/${Date.now()}`).set(parsed);
          saved = true;
        }
      } catch (e) {
        console.log("JSON parse error:", e);
      }
    }

    return res.status(200).json({
      result: text,
      savedToFirebase: saved,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
