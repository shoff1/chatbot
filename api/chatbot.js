import { db } from "../firebase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", // Model paling pintar dan stabil di Groq
        messages: [
          { 
            role: "system", 
            content: "Kamu adalah asisten keuangan peternakan. Tugasmu mencatat transaksi barang masuk/keluar dan laporan kas ke database menggunakan tool yang tersedia." 
          },
          { role: "user", content: prompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "catat_barang_masuk",
              description: "Catat pembelian barang & otomatis mencatat kas keluar.",
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
            }
          },
          {
            type: "function",
            function: {
              name: "catat_barang_keluar",
              description: "Catat penjualan hasil ternak & otomatis mencatat kas masuk.",
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
            }
          },
          {
            type: "function",
            function: {
              name: "cek_laporan",
              description: "Melihat total kas masuk atau kas keluar.",
              parameters: {
                type: "object",
                properties: {
                  tipe: { type: "string", enum: ["masuk", "keluar"] }
                },
                required: ["tipe"]
              }
            }
          }
        ],
        tool_choice: "auto",
        temperature: 0.1,
        max_tokens: 500
      })
    });

    const data = await response.json();

    // Log ringkas untuk monitoring
    console.log("DEBUG: Groq Key Last 4:", process.env.API_KEY.slice(-4));

    if (data.error) {
      console.error("Groq Error:", data.error.message);
      return res.status(500).json({ error: data.error.message });
    }

    const message = data.choices[0].message;

    // --- EKSEKUSI LOGIKA TOOL CALLS ---
    if (message.tool_calls) {
      const toolCall = message.tool_calls[0];
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
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
        return res.status(200).json({ reply: `✅ Pembelian ${args.nama} senilai Rp${args.total.toLocaleString()} berhasil dicatat ke Firebase.` });
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
        return res.status(200).json({ reply: `🚀 Penjualan ${args.nama} senilai Rp${args.total.toLocaleString()} berhasil dicatat ke Firebase.` });
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

    // Jawab Chat Biasa
    return res.status(200).json({ reply: message.content || "Ada lagi yang bisa saya bantu catat?" });

  } catch (err) {
    console.error("Internal Error:", err.message);
    return res.status(500).json({ error: "Terjadi kesalahan pada koneksi Groq." });
  }
}