import { db } from "../firebase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
  {
    role: "user",
    parts: [
      { 
        text: `Kamu adalah asisten keuangan peternakan yang sangat teliti. 
               Tugasmu adalah menggunakan fungsi 'catat_barang_masuk' atau 'catat_barang_keluar' 
               setiap kali pengguna menyebutkan transaksi beli atau jual barang. 
               JANGAN menjawab dengan teks biasa jika ada data transaksi. 
               
               Prompt pengguna: ${prompt}` 
      }
    ],
  },
],
          tools: [{
            function_declarations: [
              {
                name: "catat_barang_masuk",
                description: "Input barang masuk/pembelian. Otomatis mencatat kas keluar.",
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
                description: "Input penjualan hasil ternak. Otomatis mencatat kas masuk.",
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
                description: "Melihat total uang masuk atau keluar dari database.",
                parameters: {
                  type: "object",
                  properties: {
                    tipe: { type: "string", enum: ["masuk", "keluar"] }
                  },
                  required: ["tipe"]
                }
              }
            ]
          }]
        }),
      }
    );

    const data = await response.json();
// Cek di Logs Vercel: Apa yang sebenarnya dipikirkan AI?
console.log("Gemini Response:", JSON.stringify(data, null, 2));
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
        return res.status(200).json({ reply: `✅ Oke! Pembelian ${args.nama} dicatat. Kas berkurang Rp${args.total.toLocaleString()}.` });
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
        return res.status(200).json({ reply: `🚀 Mantap! Penjualan ${args.nama} dicatat. Kas bertambah Rp${args.total.toLocaleString()}.` });
      }

      // 3. CEK LAPORAN
      if (name === "cek_laporan") {
        const path = args.tipe === "masuk" ? "kasMasuk" : "kasKeluar";
        const snapshot = await db.ref(path).once("value");
        let total = 0;
        if (snapshot.exists()) {
          Object.values(snapshot.val()).forEach(val => total += val.jumlah);
        }
        return res.status(200).json({ reply: `Total ${args.tipe === 'masuk' ? 'pemasukan' : 'pengeluaran'} sejauh ini adalah Rp${total.toLocaleString()}.` });
      }
    }

    // Jawab Chat Biasa
    return res.status(200).json({ reply: part?.text || "Ada lagi yang bisa saya bantu catat?" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}