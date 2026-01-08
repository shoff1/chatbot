import { db } from "../firebase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: `Asisten Keuangan: Catat transaksi atau cek laporan. Prompt: ${prompt}` }]
          }],
          tools: [{
            function_declarations: [
              {
                name: "catat_barang_masuk",
                description: "Catat pembelian barang & kas keluar.",
                parameters: {
                  type: "object",
                  properties: {
                    nama: { type: "string" },
                    jumlah: { type: "number" },
                    satuan: { type: "string" },
                    total: { type: "number" }
                  },
                  required: ["nama", "jumlah", "satuan", "total"]
                }
              },
              {
                name: "catat_barang_keluar",
                description: "Catat penjualan & kas masuk.",
                parameters: {
                  type: "object",
                  properties: {
                    nama: { type: "string" },
                    jumlah: { type: "number" },
                    satuan: { type: "string" },
                    total: { type: "number" }
                  },
                  required: ["nama", "jumlah", "satuan", "total"]
                }
              },
              {
                name: "cek_laporan",
                description: "Lihat total kas masuk/keluar.",
                parameters: {
                  type: "object",
                  properties: {
                    tipe: { type: "string", enum: ["masuk", "keluar"] }
                  },
                  required: ["tipe"]
                }
              }
            ]
          }],
          tool_config: {
            function_calling_config: { mode: "AUTO" }
          },
          generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.1
          }
        }),
      }
    );

    const data = await response.json();

    // Log ringkas untuk monitoring
    console.log("DEBUG: Key Last 4:", process.env.API_KEY.slice(-4));
    
    if (data.error) {
      console.error("Gemini Error:", data.error.message);
      return res.status(data.error.code || 500).json({ error: data.error.message });
    }

    const part = data?.candidates?.[0]?.content?.parts?.[0];

    // --- EKSEKUSI LOGIKA ---
    if (part?.functionCall) {
      const { name, args } = part.functionCall;
      const tgl = new Date().toISOString();

      // 1. BARANG MASUK -> KAS KELUAR
      if (name === "catat_barang_masuk") {
        const bRef = db.ref("barangMasuk").push();
        await bRef.set({ ...args, harga: args.total / args.jumlah, tanggal: tgl });
        await db.ref("kasKeluar").push().set({
          jumlah: args.total,
          keterangan: `Beli ${args.nama} (${args.jumlah} ${args.satuan})`,
          tanggal: tgl,
          refId: bRef.key
        });
        return res.status(200).json({ reply: `✅ Pembelian ${args.nama} senilai Rp${args.total.toLocaleString()} dicatat.` });
      }

      // 2. BARANG KELUAR -> KAS MASUK
      if (name === "catat_barang_keluar") {
        const bRef = db.ref("barangKeluar").push();
        await bRef.set({ ...args, harga: args.total / args.jumlah, tanggal: tgl });
        await db.ref("kasMasuk").push().set({
          jumlah: args.total,
          keterangan: `Jual ${args.nama} (${args.jumlah} ${args.satuan})`,
          tanggal: tgl,
          refId: bRef.key
        });
        return res.status(200).json({ reply: `🚀 Penjualan ${args.nama} senilai Rp${args.total.toLocaleString()} dicatat.` });
      }

      // 3. CEK LAPORAN
      if (name === "cek_laporan") {
        const path = args.tipe === "masuk" ? "kasMasuk" : "kasKeluar";
        const snapshot = await db.ref(path).once("value");
        let total = 0;
        if (snapshot.exists()) {
          Object.values(snapshot.val()).forEach(val => {
            if (val.jumlah) total += val.jumlah;
          });
        }
        return res.status(200).json({ reply: `Total ${args.tipe === 'masuk' ? 'pemasukan' : 'pengeluaran'} sejauh ini adalah Rp${total.toLocaleString()}.` });
      }
    }

    // Jawab Chat Biasa jika tidak ada fungsi yang dipanggil
    return res.status(200).json({ reply: part?.text || "Ada lagi yang bisa saya bantu?" });

  } catch (err) {
    console.error("Internal Error:", err.message);
    return res.status(500).json({ error: "Terjadi kesalahan pada sistem." });
  }
}