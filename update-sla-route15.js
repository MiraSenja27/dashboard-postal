const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Load environment variables manually if .env file exists
if (fs.existsSync(path.join(__dirname, ".env"))) {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key) {
          process.env[key.trim()] = valueParts.join("=").trim();
        }
      }
    });
    console.log("✅ Loaded environment variables from .env");
  } catch (err) {
    console.error("⚠️ Failed to load .env file:", err.message);
  }
}

// Define SLA Schema
const titikSchema = new mongoose.Schema(
  {
    label: String,
    target: String,
    realisasi: String,
    status: String,
  },
  { _id: false },
);

const slaSchema = new mongoose.Schema({
  nopol: { type: String },
  rute: { type: String },
  tanggal: { type: String },
  titik: [titikSchema],
  category: { type: String, default: "primer" },
  weekStart: { type: String },
  weekEnd: { type: String },
  weekKey: { type: String },
  uploadTime: { type: String },
});

const SlaData = mongoose.models.SlaData || mongoose.model("SlaData", slaSchema);

async function updateRoute15SLA() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI tidak ditemukan di Environment Variables atau file .env!");
    }

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log("✅ Database terhubung ke MongoDB");

    // Cari semua data SLA untuk Rute 15
    const slaRecords = await SlaData.find({
      rute: { $regex: /Rute 15/i }
    });

    console.log(`📊 Ditemukan ${slaRecords.length} record SLA untuk Rute 15`);

    if (slaRecords.length === 0) {
      console.log("⚠️ Tidak ada data SLA untuk Rute 15");
      return;
    }

    let updatedCount = 0;

    for (const record of slaRecords) {
      console.log(`\n🔄 Processing: ${record.rute} (${record.tanggal})`);
      console.log(`   Titik sebelum: ${record.titik.map(t => t.label).join(', ')}`);

      // Filter titik untuk menghapus yang mengandung SLO
      const filteredTitik = record.titik.filter(t => 
        !t.label.toUpperCase().includes('SLO')
      );

      if (filteredTitik.length !== record.titik.length) {
        // Update record
        await SlaData.updateOne(
          { _id: record._id },
          { $set: { titik: filteredTitik } }
        );
        console.log(`   Titik sesudah: ${filteredTitik.map(t => t.label).join(', ')}`);
        console.log(`   ✅ Berhasil diupdate`);
        updatedCount++;
      } else {
        console.log(`   ℹ️ Tidak ada perubahan (tidak ada titik SLO)`);
      }
    }

    console.log(`\n✅ Selesai! ${updatedCount} record berhasil diupdate`);

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 Database connection closed");
  }
}

updateRoute15SLA();
