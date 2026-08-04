const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

// Load environment variables
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

// Schema definitions
const volumeSchema = new mongoose.Schema({
  tanggal: { type: String },
  rute: { type: String },
  postal: { type: Number, default: 0 },
  nonPostal: { type: Number, default: 0 },
  kapasitas: { type: Number, default: 0 },
  unit: [{ type: String }],
  totalUnits: [{
    jumlah: { type: Number, default: 0 },
    jenis:  { type: String, default: '' }
  }],
  category: { type: String, default: "primer" },
  weekStart: { type: String },
  weekEnd: { type: String },
  weekKey: { type: String },
  sisa: { type: Number, default: 0 },
  uploadTime: { type: String }
});

const slaSchema = new mongoose.Schema({
  tanggal: { type: String },
  rute: { type: String },
  titik: [{
    titik: { type: String },
    jam: { type: String },
    realisasi: { type: String }
  }],
  category: { type: String, default: "primer" },
  weekStart: { type: String },
  weekEnd: { type: String },
  weekKey: { type: String },
  uploadTime: { type: String }
});

const VolumeData = mongoose.models.VolumeData || mongoose.model("VolumeData", volumeSchema);
const SlaData = mongoose.models.SlaData || mongoose.model("SlaData", slaSchema);

async function connectDB() {
  const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/dashboard-postal";
  if (!MONGO_URI) {
    throw new Error("MONGO_URI not found in environment variables");
  }
  
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");
}

async function updateRouteNames() {
  try {
    await connectDB();

    const updates = [
      { oldName: "Rute 11 BD-SB", newName: "Rute 11A BD-SB" },
      { oldName: "Rute 11 SB-BD", newName: "Rute 11A SB-BD" },
      { oldName: "Rute 11 SB-MTR", newName: "Rute 11B SB-MTR" },
      { oldName: "Rute 11 MTR-SB", newName: "Rute 11B MTR-SB" }
    ];

    for (const update of updates) {
      // Update in VolumeData
      const volumeResult = await VolumeData.updateMany(
        { rute: { $regex: new RegExp(`^${update.oldName}$`, "i") } },
        { $set: { rute: update.newName } }
      );

      // Update in SlaData
      const slaResult = await SlaData.updateMany(
        { rute: { $regex: new RegExp(`^${update.oldName}$`, "i") } },
        { $set: { rute: update.newName } }
      );

      console.log(`✅ "${update.oldName}" → "${update.newName}": ${volumeResult.modifiedCount} volume records, ${slaResult.modifiedCount} SLA records`);
    }

    console.log("\n✅ All route names updated successfully!");
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

updateRouteNames();
