const express = require("express");
const cors = require("cors");
const multer = require("multer");
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

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

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(__dirname));

// ─── Mongoose Schemas ────────────────────────────────────────────────────────

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
  uploadTime: { type: String },
});

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

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: { type: String },
  role: { type: String, default: "viewer" },
});

const VolumeData = mongoose.models.VolumeData || mongoose.model("VolumeData", volumeSchema);
const SlaData = mongoose.models.SlaData || mongoose.model("SlaData", slaSchema);
const User = mongoose.models.User || mongoose.model("User", userSchema);

// Master settings per rute (unit & kapasitas)
const routeSettingsSchema = new mongoose.Schema({
  rute:       { type: String, unique: true },
  unit:       [{ type: String }],
  kapasitas:  { type: Number, default: 0 },
  totalUnits: [{
    jumlah: { type: Number, default: 0 },
    jenis:  { type: String, default: '' }
  }],
  category:   { type: String, default: "primer" },
  weekKey:    { type: String },
  updatedAt:  { type: Date, default: Date.now }
});
const RouteSettings = mongoose.models.RouteSettings || mongoose.model("RouteSettings", routeSettingsSchema);
// ─── Connect to MongoDB ───────────────────────────────────────────────────────

// Migration: convert existing unit strings to arrays (run once on startup)
async function migrateUnitField() {
  const docs = await VolumeData.find({ unit: { $type: 'string' } });
  for (const doc of docs) {
    if (typeof doc.unit === 'string' && doc.unit.trim() !== '') {
      const arr = doc.unit.split(',').map(u => u.trim()).filter(u => u);
      await VolumeData.updateOne({ _id: doc._id }, { $set: { unit: arr } });
    }
  }
  console.log('✅ Unit field migration completed');
}

let isConnected = false;

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) return;

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI tidak ditemukan di Environment Variables atau file .env!");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000 // 5 seconds timeout
  });

  isConnected = true;
  console.log("✅ Database terhubung ke MongoDB");
  await migrateUnitField();
  await seedDefaults();
}

async function seedDefaults() {
  // Seed default users
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    await User.insertMany([
      { username: "admin", password: "admin123", role: "admin" },
      { username: "postal", password: "mirasenja", role: "viewer" },
    ]);
    console.log("✅ Default users seeded");
  }

  // Seed default SLA data
  const slaCount = await SlaData.countDocuments();
  if (slaCount === 0) {
    const now = new Date().toISOString();
    const week = getWeekRange("2026-04-14");
    await SlaData.insertMany([
      {
        tanggal: "2026-04-14",
        rute: "Rute 1: JAT - Surabaya",
        titik: [
          { label: "JAT (OUT)", realisasi: null, target: "08:00" },
          { label: "Surabaya (IN)", realisasi: null, target: "22:00" },
        ],
        category: "primer",
        ...week,
        uploadTime: now,
      },
      {
        tanggal: "2026-04-14",
        rute: "Rute 2: JAT - Yogyakarta",
        titik: [
          { label: "JAT (OUT)", realisasi: null, target: "07:00" },
          { label: "Yogyakarta (IN)", realisasi: null, target: "14:00" },
        ],
        category: "primer",
        ...week,
        uploadTime: now,
      },
      {
        tanggal: "2026-04-14",
        rute: "Rute 3: JAT - Medan",
        titik: [
          { label: "JAT (OUT)", realisasi: null, target: "06:00" },
          { label: "Medan (IN)", realisasi: null, target: "18:00" },
        ],
        category: "primer",
        ...week,
        uploadTime: now,
      },
      {
        tanggal: "2026-04-14",
        rute: "Rute 4: JAT - Purwokerto",
        titik: [
          { label: "JAT (OUT)", realisasi: null, target: "06:00" },
          { label: "Purwokerto (IN)", realisasi: null, target: "12:00" },
        ],
        category: "primer",
        ...week,
        uploadTime: now,
      },
    ]);
    console.log("✅ Default SLA data seeded");
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function formatExcelTime(value) {
  if (value == null || value === "") return "-";
  if (typeof value === "number") {
    if (value < 1) {
      const totalSeconds = Math.round(value * 24 * 3600);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    const s = String(value);
    if (s.length === 3) return `0${s[0]}:${s.substring(1)}`;
    if (s.length === 4) return `${s.substring(0, 2)}:${s.substring(2)}`;
  }
  return String(value).trim();
}

function parseIndoNumber(val) {
  if (val == null || val === "") return 0;
  if (typeof val === "number") return val;
  let s = String(val).trim().replace(/\s/g, "");
  if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  } else if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDate(dateValue) {
  if (!dateValue) return null;
  if (typeof dateValue === "number") {
    const d = new Date(Math.round((dateValue - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  if (dateValue instanceof Date) {
    if (!isNaN(dateValue.getTime())) {
      const offset = dateValue.getTimezoneOffset() * 60000;
      return new Date(dateValue.getTime() - offset).toISOString().split("T")[0];
    }
  }
  if (typeof dateValue === "string") {
    const s = dateValue.trim();
    if (!s) return null;
    const ddMmYyyyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (ddMmYyyyMatch) {
      let day = ddMmYyyyMatch[1].padStart(2, "0");
      let month = ddMmYyyyMatch[2].padStart(2, "0");
      let year = ddMmYyyyMatch[3];
      if (year.length === 2) year = "20" + year;
      return `${year}-${month}-${day}`;
    }
    const yyyyMmDdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (yyyyMmDdMatch) {
      return `${yyyyMmDdMatch[1]}-${yyyyMmDdMatch[2].padStart(2, "0")}-${yyyyMmDdMatch[3].padStart(2, "0")}`;
    }
    const months = {
      januari: 1,
      january: 1,
      jan: 1,
      februari: 2,
      february: 2,
      feb: 2,
      maret: 3,
      march: 3,
      mar: 3,
      april: 4,
      apr: 4,
      mei: 5,
      may: 5,
      juni: 6,
      june: 6,
      jun: 6,
      juli: 7,
      july: 7,
      jul: 7,
      agustus: 8,
      august: 8,
      aug: 8,
      september: 9,
      sep: 9,
      oktober: 10,
      october: 10,
      okt: 10,
      november: 11,
      nov: 11,
      desember: 12,
      december: 12,
      des: 12,
    };
    const namedDateMatch = s.match(
      /^(\d{1,2})[\s-/]+([A-Za-z]+)[\s-/]+(\d{2,4})$/,
    );
    if (namedDateMatch) {
      const day = namedDateMatch[1].padStart(2, "0");
      const monthName = namedDateMatch[2].toLowerCase();
      let year = namedDateMatch[3];
      if (year.length === 2) year = "20" + year;
      const monthNum = months[monthName];
      if (monthNum)
        return `${year}-${monthNum.toString().padStart(2, "0")}-${day}`;
    }
    const parsedDate = new Date(s);
    if (!isNaN(parsedDate.getTime())) {
      const offset = parsedDate.getTimezoneOffset() * 60000;
      return new Date(parsedDate.getTime() - offset)
        .toISOString()
        .split("T")[0];
    }
  }
  return null;
}

function getWeekRange(dateStr) {
  const date = new Date(dateStr + "T00:00:00Z");
  const day = date.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(date.getTime() + diff * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const mondayStr = monday.toISOString().split("T")[0];
  const sundayStr = sunday.toISOString().split("T")[0];
  return {
    startDate: mondayStr,
    endDate: sundayStr,
    weekKey: `${mondayStr}_${sundayStr}`,
  };
}

// ─── Configure multer ─────────────────────────────────────────────────────────

const upload = multer({ dest: "/tmp" });

// ─── API Routes ───────────────────────────────────────────────────────────────

// Middleware to ensure DB is connected for all API requests
app.use("/api", async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("❌ API DB connection error:", err.message);
    res.status(500).json({
      success: false,
      message: "Gagal menghubungkan ke database MongoDB Atlas.",
      error: err.message,
    });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({
      username: { $regex: new RegExp(`^${username}$`, "i") },
      password,
    });
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "Username atau password salah" });
    res.json({
      success: true,
      message: "Login berhasil",
      user: { id: user._id, username: user.username, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// Upload Volume Excel
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const { category, weekStart } = req.body;
    const file = req.file;
    if (!file)
      return res
        .status(400)
        .json({ success: false, message: "File tidak ditemukan" });

    const workbook = xlsx.readFile(file.path);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const allRows = xlsx.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
    });
    if (allRows.length === 0)
      return res.status(400).json({ success: false, message: "File kosong" });

    let headerRowIdx = -1;
    let colMap = {
      rute: -1,
      tanggal: -1,
      postal: -1,
      poslog: -1,
      kapasitas: -1,
      unit: -1,
    };

    for (let i = 0; i < Math.min(allRows.length, 20); i++) {
      const row = allRows[i];
      if (!row || !Array.isArray(row)) continue;
      const findCol = (terms) =>
        row.findIndex(
          (c) =>
            c &&
            terms.some((t) =>
              String(c).toLowerCase().includes(t.toLowerCase()),
            ),
        );
      const r = findCol(["nama rute", "rute"]);
      const t = findCol(["attribute", "tanggal", "date", "tgl"]);
      const p = findCol(["posta", "postal"]);
      if (r !== -1 && (t !== -1 || p !== -1)) {
        headerRowIdx = i;
        colMap.rute = r;
        colMap.tanggal = t;
        colMap.postal = p;
        colMap.poslog = findCol(["poslog", "non postal", "non_postal"]);
        colMap.kapasitas = findCol(["kapasit", "kapasitas", "capacity"]);
        // Detect column indices including more variations for Unit
        colMap.unit = findCol(["unit", "satuan", "unit (kg)", "unit (kg.)", "unit (kg)", "unit (Kg)", "unit-kg", "unit_kg", "unitkg", "unitkg."]);
        // Fallback: if still not found, look for any header containing the word "unit" ignoring case and extra characters
        if (colMap.unit === -1 && headerRowIdx !== -1) {
          const headerRow = allRows[headerRowIdx];
          for (let idx = 0; idx < headerRow.length; idx++) {
            const cell = headerRow[idx];
            if (cell && String(cell).toLowerCase().includes('unit')) {
              colMap.unit = idx;
              break;
            }
          }
        }
        colMap.space = findCol(["space", "sisa"]);
        break;
      }
    }

    if (headerRowIdx === -1) {
      return res.status(400).json({
        success: false,
        message:
          'Format kolom tidak dikenali. Pastikan ada kolom "Nama Rute" dan "Attribute" atau "Postal".',
      });
    }

    let successCount = 0,
      errorCount = 0,
      usedWeekRange = null;
    const records = [];

    for (let i = headerRowIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row || row.length === 0) continue;
      try {
        if (i <= headerRowIdx + 100) {
          row.forEach((cell, idx) => {
            if (cell == null) return;
            const str = String(cell).trim();
            if (colMap.tanggal === -1) {
              if (typeof cell === "number" && cell > 40000 && cell < 60000)
                colMap.tanggal = idx;
              else if (str.match(/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/))
                colMap.tanggal = idx;
              else if (str.match(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/))
                colMap.tanggal = idx;
            }
            if (
              colMap.rute === -1 &&
              typeof cell === "string" &&
              str.length > 5
            )
              colMap.rute = idx;
            if (colMap.postal === -1 && typeof cell === "number" && cell > 0)
              colMap.postal = idx;
          });
        }

        const routeName =
          colMap.rute !== -1 ? String(row[colMap.rute] || "").trim() : "";
        if (!routeName) continue;

        let recordDate =
          colMap.tanggal !== -1 && row[colMap.tanggal]
            ? parseDate(row[colMap.tanggal])
            : null;
        if (!recordDate && weekStart) recordDate = weekStart;
        if (!recordDate) recordDate = new Date().toISOString().split("T")[0];

        const weekRange = getWeekRange(recordDate);

        const postalVolume =
          colMap.postal !== -1 ? parseIndoNumber(row[colMap.postal]) : 0;
        const nonPostalVolume =
          colMap.poslog !== -1 ? parseIndoNumber(row[colMap.poslog]) : 0;
        const kapasitas =
          colMap.kapasitas !== -1 ? parseIndoNumber(row[colMap.kapasitas]) : 0;
        const unitValue = colMap.unit !== -1 ? String(row[colMap.unit] || "").trim() : "";

        let spaceAvailable = 0;
        if (colMap.space !== -1 && row[colMap.space] != null) {
          const rawSpace = row[colMap.space];
          spaceAvailable =
            typeof rawSpace === "number"
              ? rawSpace <= 1
                ? rawSpace
                : rawSpace / 100
              : parseIndoNumber(String(rawSpace).replace("%", "").trim()) / 100;
        } else if (kapasitas > 0) {
          spaceAvailable = 1 - (postalVolume + nonPostalVolume) / kapasitas;
        }

        // Skip rows with no meaningful volume data
        if (postalVolume === 0 && nonPostalVolume === 0 && kapasitas === 0) {
          // Do not record this row
        } else {
          records.push({
            tanggal: recordDate,
            rute: routeName,
            postal: postalVolume,
            nonPostal: nonPostalVolume,
            kapasitas,
            sisa: spaceAvailable,
            category: category || "primer",
            weekStart: weekRange.startDate,
            weekEnd: weekRange.endDate,
            weekKey: weekRange.weekKey,
            unit: unitValue ? [unitValue] : [],
          });
          successCount++;
          usedWeekRange = weekRange.weekKey;
        }

      } catch (err) {
        console.error("Error processing row:", err);
        errorCount++;
      }
    }

    if (records.length > 0) await VolumeData.insertMany(records);
    try {
      fs.unlinkSync(file.path);
    } catch (e) {}

    res.json({
      success: true,
      message: `Data berhasil diupload: ${successCount} rute berhasil`,
      successCount,
      errorCount,
      weekRange: usedWeekRange || null,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      success: false,
      message: "Error processing file: " + error.message,
    });
  }
});

// Upload SLA Excel
app.post("/api/upload-sla", upload.single("file"), async (req, res) => {
  console.log("\n=== SLA UPLOAD PROCESS START ===");
  try {
    const { category, weekStart } = req.body;
    const file = req.file;
    if (!file)
      return res
        .status(400)
        .json({ success: false, message: "File tidak ditemukan" });

    const workbook = xlsx.readFile(file.path);
    const uploadDate = weekStart || new Date().toISOString().split("T")[0];
    let successCount = 0;

    let rows = [];
    for (const name of workbook.SheetNames) {
      const currentRows = xlsx.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
      });
      if (currentRows.length > 5) {
        rows = currentRows;
        break;
      }
    }
    if (rows.length === 0)
      rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
        header: 1,
      });

    let headerRowIdx = -1;
    let colMap = {
      nopol: -1,
      rute: -1,
      kota: -1,
      tgl: -1,
      target: -1,
      realisasi: -1,
      status: -1,
    };
    for (let i = 0; i < Math.min(rows.length, 50); i++) {
      const row = rows[i];
      if (!row || !Array.isArray(row)) continue;
      const f = (t) =>
        row.findIndex(
          (c) =>
            c &&
            t.some((x) => String(c).toLowerCase().includes(x.toLowerCase())),
        );
      const n = f(["nopol", "no pol"]);
      const r = f(["rute", "route"]);
      if (n !== -1 && r !== -1) {
        headerRowIdx = i;
        colMap = {
          nopol: n,
          rute: r,
          kota: f(["kota", "lokasi"]),
          tgl: f(["tgl", "tanggal"]),
          target: f(["standar", "target"]),
          realisasi: f(["aktual", "realisasi"]),
          status: f(["status"]),
        };
        break;
      }
    }

    if (headerRowIdx === -1) {
      const preview = rows
        .slice(0, 5)
        .map((r) => JSON.stringify(r))
        .join("\n");
      return res.status(400).json({
        success: false,
        message: "Format tidak dikenali.\n" + preview,
      });
    }

    const trips = {};
    rows.slice(headerRowIdx + 1).forEach((row) => {
      if (!row || row.length === 0) return;
      const nopol =
        colMap.nopol !== -1 ? String(row[colMap.nopol] || "").trim() : "";
      const rute =
        colMap.rute !== -1 ? String(row[colMap.rute] || "").trim() : "";
      if (
        !nopol ||
        !rute ||
        nopol.includes("|") ||
        nopol.toLowerCase() === "nopol"
      )
        return;
      const tgl = colMap.tgl !== -1 ? parseDate(row[colMap.tgl]) : uploadDate;
      const key = `${nopol}_${rute}_${tgl}`;
      if (!trips[key]) trips[key] = { nopol, rute, titik: [], tanggal: tgl };
      trips[key].titik.push({
        label:
          colMap.kota !== -1
            ? String(row[colMap.kota] || "Point").trim()
            : "Point",
        target:
          colMap.target !== -1 ? formatExcelTime(row[colMap.target]) : "-",
        realisasi:
          colMap.realisasi !== -1
            ? formatExcelTime(row[colMap.realisasi])
            : "-",
        status:
          colMap.status !== -1 ? String(row[colMap.status] || "").trim() : "",
      });
    });

    if (Object.keys(trips).length === 0)
      return res
        .status(400)
        .json({ success: false, message: "Data tidak ditemukan." });

    let minDate = null,
      maxDate = null;
    const slaRecords = [];
    Object.values(trips).forEach((trip) => {
      const week = getWeekRange(trip.tanggal);
      if (!minDate || trip.tanggal < minDate) minDate = trip.tanggal;
      if (!maxDate || trip.tanggal > maxDate) maxDate = trip.tanggal;
      slaRecords.push({
        ...trip,
        category: category || "postal",
        weekStart: week.startDate,
        weekEnd: week.endDate,
        weekKey: week.weekKey,
        uploadTime: new Date().toISOString(),
      });
      successCount++;
    });

    await SlaData.insertMany(slaRecords);
    try {
      fs.unlinkSync(file.path);
    } catch (e) {}
    console.log(`=== SUCCESS: ${successCount} routes ===`);
    res.json({
      success: true,
      message: `Upload berhasil: ${successCount} rute`,
      minDate,
      maxDate,
    });
  } catch (error) {
    console.error("SLA Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get available weeks
app.get("/api/weeks", async (req, res) => {
  try {
    const { category } = req.query;
    const query = category ? { category } : {};
    
    // Filter untuk mengabaikan record (termasuk template masa depan) yang tidak ada volume muatannya
    query.$or = [
      { postal: { $gt: 0 } },
      { nonPostal: { $gt: 0 } }
    ];

    const data = await VolumeData.find(
      query,
      "weekKey weekStart weekEnd",
    ).lean();
    const weekMap = {};
    data.forEach((item) => {
      if (!item.weekKey) return;
      if (!weekMap[item.weekKey]) {
        weekMap[item.weekKey] = {
          weekKey: item.weekKey,
          startDate: item.weekStart,
          endDate: item.weekEnd,
          recordCount: 0,
        };
      }
      weekMap[item.weekKey].recordCount++;
    });
    const weeks = Object.values(weekMap).sort((a, b) =>
      b.startDate.localeCompare(a.startDate),
    );
    res.json({ success: true, data: weeks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get volume data
app.get("/api/volume", async (req, res) => {
  try {
    const { category, startDate, endDate, weekKey, aggregate, routeFilter } =
      req.query;
    const query = {};
    if (category) query.category = category;
    if (weekKey && weekKey !== "ALL" && weekKey !== "undefined")
      query.weekKey = weekKey;
    else if (!weekKey || weekKey !== "ALL") {
      if (startDate && endDate)
        query.tanggal = { $gte: startDate, $lte: endDate };
    }
    if (
      routeFilter &&
      routeFilter !== "" &&
      routeFilter !== "undefined" &&
      routeFilter !== "null" &&
      routeFilter !== "Semua Rute"
    ) {
      query.rute = { $regex: new RegExp(`^${routeFilter}$`, "i") };
    }

    const filtered = await VolumeData.find(query).lean();

    if (aggregate === "true") {
      const routeMap = {};
      filtered.forEach((item) => {
        if (!routeMap[item.rute]) {
          routeMap[item.rute] = {
            rute: item.rute,
            postal: 0,
            nonPostal: 0,
            kapasitas: 0,
            sisa: 0,
            count: 0,
            tanggal: weekKey === "ALL" ? "SEMUA MINGGU" : weekKey || "Rekap",
          };
        }
        const dailyCapacity = (item.kapasitas || 0) / 7;
        routeMap[item.rute].postal += item.postal || 0;
        routeMap[item.rute].nonPostal += item.nonPostal || 0;
        routeMap[item.rute].kapasitas += dailyCapacity;
        routeMap[item.rute].sisa +=
          dailyCapacity - (item.postal || 0) - (item.nonPostal || 0);
        routeMap[item.rute].count++;
      });
      const aggregated = Object.values(routeMap).map((r) => ({
        ...r,
        sisa: r.kapasitas > 0 ? r.sisa / r.kapasitas : 0,
      }));
      let minDate = null,
        maxDate = null;
      filtered.forEach((item) => {
        if (!minDate || item.tanggal < minDate) minDate = item.tanggal;
        if (!maxDate || item.tanggal > maxDate) maxDate = item.tanggal;
      });
      return res.json({ success: true, data: aggregated, minDate, maxDate });
    }

    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get SLA data
app.get("/api/sla", async (req, res) => {
  try {
    const { category, startDate, endDate, weekKey, aggregate, routeFilter } =
      req.query;
    const query = {};
    if (category) query.category = category;
    if (weekKey && weekKey !== "ALL" && weekKey !== "undefined")
      query.weekKey = weekKey;
    else if (!weekKey || weekKey !== "ALL") {
      if (startDate && endDate)
        query.tanggal = { $gte: startDate, $lte: endDate };
    }
    if (
      routeFilter &&
      routeFilter !== "" &&
      routeFilter !== "undefined" &&
      routeFilter !== "null" &&
      routeFilter !== "Semua Rute"
    ) {
      query.rute = { $regex: new RegExp(`^${routeFilter}$`, "i") };
    }

    const filtered = await SlaData.find(query).lean();

    if (aggregate === "true") {
      const routeMap = {};
      filtered.forEach((item) => {
        if (!item || !item.rute) return;
        if (!routeMap[item.rute]) {
          routeMap[item.rute] = {
            rute: item.rute,
            nopol: item.nopol || "Multi",
            tanggal: "Rekap",
            titik: [],
          };
        }
        if (item.titik) {
          item.titik.forEach((t, idx) => {
            if (!routeMap[item.rute].titik[idx]) {
              routeMap[item.rute].titik[idx] = {
                label: t.label,
                target: t.target,
                totalMinutes: 0,
                count: 0,
                status: "On-Time",
              };
            }
            if (t.realisasi && t.realisasi !== "-") {
              const parts = t.realisasi.split(":");
              if (parts.length === 2) {
                const mins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                routeMap[item.rute].titik[idx].totalMinutes += mins;
                routeMap[item.rute].titik[idx].count++;
                if (
                  t.status &&
                  (t.status.toLowerCase().includes("terlambat") ||
                    t.status.toLowerCase().includes("delay"))
                ) {
                  routeMap[item.rute].titik[idx].status = "Delay";
                }
              }
            }
          });
        }
      });
      let minDate = null,
        maxDate = null;
      filtered.forEach((item) => {
        if (item && item.tanggal) {
          if (!minDate || item.tanggal < minDate) minDate = item.tanggal;
          if (!maxDate || item.tanggal > maxDate) maxDate = item.tanggal;
        }
      });
      return res.json({
        success: true,
        data: Object.values(routeMap),
        minDate,
        maxDate,
      });
    }

    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get routes (aggregated)
app.get("/api/routes", async (req, res) => {
  try {
    const { category, startDate, endDate, weekKey, routeFilter } = req.query;
    const query = {};
    if (category) query.category = category;
    if (
      weekKey &&
      weekKey !== "ALL" &&
      weekKey !== "undefined" &&
      weekKey !== "null"
    )
      query.weekKey = weekKey;
    else if (!weekKey || weekKey !== "ALL") {
      if (
        startDate &&
        endDate &&
        startDate !== "undefined" &&
        endDate !== "undefined"
      ) {
        query.tanggal = { $gte: startDate, $lte: endDate };
      }
    }
    if (
      routeFilter &&
      routeFilter !== "" &&
      routeFilter !== "undefined" &&
      routeFilter !== "null" &&
      routeFilter !== "Semua Rute"
    ) {
      query.rute = { $regex: new RegExp(`^${routeFilter}$`, "i") };
    }

    const filtered = await VolumeData.find(query).sort({ tanggal: -1 }).lean();
    const routeMap = {};
    filtered.forEach((item) => {
      if (!item || !item.rute) return;
      if (!routeMap[item.rute]) {
        routeMap[item.rute] = {
          route_name: item.rute,
          postal_volume: 0,
          non_postal_volume: 0,
          kapasitas_total: 0,
          space_sum: 0,
          count: 0,
          base_kapasitas: 0,
          units: new Set(),
          totalUnits: null
        };
      }

      // Ambil totalUnits dari record terbaru yang punya isi (data di-sort tanggal desc),
      // sehingga nilai yang tampil di popup sesuai scope filter dari VolumeData.
      if (
        !routeMap[item.rute].totalUnits &&
        Array.isArray(item.totalUnits) &&
        item.totalUnits.some(tu => tu && ((tu.jumlah || 0) > 0 || (tu.jenis || '').trim() !== ''))
      ) {
        routeMap[item.rute].totalUnits = item.totalUnits;
      }

      // Ambil kapasitas terbesar yang tidak nol dari semua record rute ini
      if (item.kapasitas && item.kapasitas > routeMap[item.rute].base_kapasitas) {
        routeMap[item.rute].base_kapasitas = item.kapasitas;
      }

      // Kumpulkan semua unit tidak kosong dari SEMUA record (bukan hanya record pertama)
      if (Array.isArray(item.unit)) {
        item.unit.forEach(u => {
          if (u && u.trim()) routeMap[item.rute].units.add(u.trim());
        });
      } else if (item.unit && typeof item.unit === 'string' && item.unit.trim()) {
        routeMap[item.rute].units.add(item.unit.trim());
      }
        
      const dailyCapacity = (item.kapasitas || 0) / 7;

      routeMap[item.rute].postal_volume += item.postal || 0;
      routeMap[item.rute].non_postal_volume += item.nonPostal || 0;
      routeMap[item.rute].kapasitas_total += dailyCapacity;
      routeMap[item.rute].space_sum +=
        dailyCapacity - (item.postal || 0) - (item.nonPostal || 0);
      routeMap[item.rute].count++;
    });
    const routes = Object.values(routeMap).map((r) => ({
      route_name: r.route_name,
      postal_volume: r.postal_volume,
      non_postal_volume: r.non_postal_volume,
      kapasitas: r.kapasitas_total,
      space_available: r.space_sum,
      base_kapasitas: r.base_kapasitas,
      units: Array.from(r.units).join(', '),
      _totalUnitsFromVolume: r.totalUnits
    }));

    // totalUnits: utamakan hasil dari VolumeData (sesuai filter); jika kosong,
    // baru fallback ke master RouteSettings (untuk rute yang belum punya volume).
    const routeSettingsMap = {};
    const allSettings = await RouteSettings.find({}).lean();
    allSettings.forEach(rs => {
      routeSettingsMap[rs.rute] = rs.totalUnits || [];
    });

    routes.forEach(route => {
      route.totalUnits =
        (route._totalUnitsFromVolume && route._totalUnitsFromVolume.length > 0)
          ? route._totalUnitsFromVolume
          : (routeSettingsMap[route.route_name] || []);
      delete route._totalUnitsFromVolume;
    });
    
    let minDate = null,
      maxDate = null;
    filtered.forEach((item) => {
      if (!minDate || item.tanggal < minDate) minDate = item.tanggal;
      if (!maxDate || item.tanggal > maxDate) maxDate = item.tanggal;
    });
    res.json({ success: true, data: routes, minDate, maxDate });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get statistics
app.get("/api/stats", async (req, res) => {
  try {
    const { category, startDate, endDate, weekKey, routeFilter } = req.query;
    const query = {};
    if (category) query.category = category;
    if (weekKey && weekKey !== "ALL" && weekKey !== "undefined")
      query.weekKey = weekKey;
    else if (!weekKey || weekKey !== "ALL") {
      if (startDate && endDate)
        query.tanggal = { $gte: startDate, $lte: endDate };
    }
    if (
      routeFilter &&
      routeFilter !== "" &&
      routeFilter !== "undefined" &&
      routeFilter !== "null" &&
      routeFilter !== "Semua Rute"
    ) {
      query.rute = { $regex: new RegExp(`^${routeFilter}$`, "i") };
    }

    const filtered = await VolumeData.find(query).lean();
    
    // Hanya hitung rute yang memiliki data muatan (postal > 0 atau poslog > 0)
    const activeRecords = filtered.filter((r) => r && r.rute && (r.postal > 0 || r.nonPostal > 0));
    const uniqueRoutes = [
      ...new Set(activeRecords.map((r) => r.rute)),
    ];
    const postalVolume = filtered.reduce((sum, r) => sum + (r.postal || 0), 0);
    const poslogVolume = filtered.reduce(
      (sum, r) => sum + (r.nonPostal || 0),
      0,
    );
    const totalCapacity = filtered.reduce(
      (sum, r) => sum + (r.kapasitas || 0) / 7,
      0,
    );
    const totalSisaKg = totalCapacity - postalVolume - poslogVolume;
    const avgSpacePct =
      totalCapacity > 0 ? (totalSisaKg / totalCapacity) * 100 : 0;
    let minDate = null,
      maxDate = null;
    filtered.forEach((item) => {
      if (!minDate || item.tanggal < minDate) minDate = item.tanggal;
      if (!maxDate || item.tanggal > maxDate) maxDate = item.tanggal;
    });
    res.json({
      success: true,
      minDate,
      maxDate,
      data: {
        total_routes: uniqueRoutes.length,
        postal_volume: postalVolume,
        poslog_volume: poslogVolume,
        total_capacity: totalCapacity,
        avg_space: avgSpacePct,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete SLA data by route name
app.delete("/api/sla", async (req, res) => {
  try {
    const { routeName, routeNames } = req.body;
    if (!routeName && (!routeNames || !Array.isArray(routeNames))) {
      return res
        .status(400)
        .json({ success: false, message: "Route name(s) is required" });
    }
    const targets = routeNames || [routeName];
    const result = await SlaData.deleteMany({ rute: { $in: targets } });
    if (result.deletedCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "No SLA data found for this route" });
    res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} SLA records`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Volume data by route name (dengan filter weekKey/tanggal opsional)
app.delete("/api/volume", async (req, res) => {
  try {
    const { ids, routeName, routeNames, weekKey, startDate, endDate, category } = req.body;

    // ── Mode 1: hapus berdasarkan daftar _id (per-baris, sesuai centang) ──
    if (Array.isArray(ids) && ids.length > 0) {
      const validIds = ids.filter(Boolean);
      const idFilter = { _id: { $in: validIds } };
      if (category) idFilter.category = category;
      const r = await VolumeData.deleteMany(idFilter);
      if (r.deletedCount === 0)
        return res.status(404).json({
          success: false,
          message: "Data tidak ditemukan untuk ID yang dipilih",
        });
      return res.json({
        success: true,
        message: `Berhasil menghapus ${r.deletedCount} data Volume`,
      });
    }

    // ── Mode 2: hapus berdasarkan rute + scope waktu (perilaku lama) ──
    if (!routeName && (!routeNames || !Array.isArray(routeNames))) {
      return res.status(400).json({ success: false, message: "Route name(s) or ids is required" });
    }
    const targets = routeNames || [routeName];

    // Build filter dengan scope waktu
    const filter = { rute: { $in: targets } };
    if (category) filter.category = category;

    if (weekKey && weekKey !== 'ALL' && weekKey !== '' && weekKey !== 'undefined') {
      filter.weekKey = weekKey;
    } else if (startDate && endDate) {
      filter.tanggal = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      filter.tanggal = { $gte: startDate };
    } else if (endDate) {
      filter.tanggal = { $lte: endDate };
    }

    const result = await VolumeData.deleteMany(filter);
    if (result.deletedCount === 0)
      return res.status(404).json({
        success: false,
        message: "Data tidak ditemukan untuk filter yang dipilih",
      });
    res.json({
      success: true,
      message: `Berhasil menghapus ${result.deletedCount} data Volume`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Volume data
app.put("/api/volume", async (req, res) => {
  try {
    const { rute, postal, nonPostal, kapasitas, tanggal, id, unit } = req.body;
    if (!rute && !id)
      return res
        .status(400)
        .json({ success: false, message: "Rute or ID is required" });

    // Jika id tersedia, update HANYA record itu saja (updateOne).
    // Jika tidak ada id, fallback ke updateMany berdasarkan rute+tanggal.
    const filter = id ? { _id: id } : { rute, ...(tanggal ? { tanggal } : {}) };
    const doc = await VolumeData.findOne(filter);
    if (!doc)
      return res
        .status(404)
        .json({ success: false, message: "Data volume tidak ditemukan" });

    const newPostal = postal !== undefined ? parseFloat(postal) : doc.postal;
    const newNonPostal =
      nonPostal !== undefined ? parseFloat(nonPostal) : doc.nonPostal;
    const newKapasitas =
      kapasitas !== undefined ? parseFloat(kapasitas) : doc.kapasitas;
    const newSisa =
      newKapasitas > 0
        ? 1 - (newPostal + newNonPostal) / newKapasitas
        : doc.sisa;

    const updatePayload = {
      $set: {
        postal: newPostal,
        nonPostal: newNonPostal,
        kapasitas: newKapasitas,
        sisa: newSisa,
        // Update unit jika dikirim dalam request body
        ...(unit !== undefined
          ? { unit: Array.isArray(unit) ? unit : (unit === '' ? [] : [unit]) }
          : {}),
      },
    };

    // Gunakan updateOne jika ada id agar tidak menimpa semua baris rute yang sama
    if (id) {
      await VolumeData.updateOne(filter, updatePayload);
    } else {
      await VolumeData.updateMany(filter, updatePayload);
    }

    res.json({ success: true, message: "Data volume berhasil diperbarui" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Bulk update Kapasitas & Unit untuk rute (dengan filter minggu/tanggal opsional)
app.put("/api/routes/settings", async (req, res) => {
  try {
    const { settings, weekKey, startDate, endDate } = req.body;
    console.log("📝 /api/routes/settings received:", JSON.stringify({ settings, weekKey, startDate, endDate }, null, 2));
    
    if (!settings || !Array.isArray(settings)) {
      return res.status(400).json({ success: false, message: "Invalid payload" });
    }

    const updatePromises = settings.map(async (setting) => {
      const { rute, unit, totalUnits, kapasitas } = setting;
      console.log(`  Processing route: ${rute}`, { unit, totalUnits, kapasitas });
      
      if (!rute) return;

      const updatePayload = { $set: {} };
      if (kapasitas !== undefined) updatePayload.$set.kapasitas = parseFloat(kapasitas);
      if (unit !== undefined) updatePayload.$set.unit = Array.isArray(unit) ? unit : (unit === '' ? [] : [unit]);
      if (totalUnits !== undefined) updatePayload.$set.totalUnits = Array.isArray(totalUnits) ? totalUnits : [];

      if (Object.keys(updatePayload.$set).length === 0) {
        console.log(`  ⚠️ No fields to update for ${rute}`);
        return;
      }

      // 1. Simpan ke master RouteSettings (upsert)
      const routeSettingsUpdate = { 
        unit: updatePayload.$set.unit ?? [], 
        kapasitas: updatePayload.$set.kapasitas ?? 0,
        totalUnits: updatePayload.$set.totalUnits ?? [],
        updatedAt: new Date()
      };
      
      // Jika ada weekKey atau date filter, simpan juga weekKey
      if (weekKey && weekKey !== 'ALL') {
        routeSettingsUpdate.weekKey = weekKey;
      }
      
      console.log(`  💾 Saving to RouteSettings:`, routeSettingsUpdate);
      const rsResult = await RouteSettings.findOneAndUpdate(
        { rute },
        { $set: routeSettingsUpdate },
        { upsert: true, new: true }
      );
      console.log(`  ✅ RouteSettings saved:`, rsResult);

      // 2. Apply ke VolumeData sesuai filter waktu
      const filter = { rute };
      if (weekKey && weekKey !== 'ALL') {
        filter.weekKey = weekKey;
      } else if (startDate && endDate) {
        filter.tanggal = { $gte: startDate, $lte: endDate };
      } else if (startDate) {
        filter.tanggal = { $gte: startDate };
      } else if (endDate) {
        filter.tanggal = { $lte: endDate };
      }

      console.log(`  📊 Applying to VolumeData with filter:`, filter);
      const volResult = await VolumeData.updateMany(filter, updatePayload);
      console.log(`  ✅ VolumeData updated:`, volResult);
      
      return volResult;
    });

    await Promise.all(updatePromises);
    console.log("✅ All settings applied successfully");
    res.json({ success: true, message: "Pengaturan rute berhasil diterapkan." });
  } catch (err) {
    console.error("❌ Error in /api/routes/settings:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update SLA data
app.put("/api/sla", async (req, res) => {
  try {
    const { rute, titik, tanggal, id } = req.body;
    if (!rute && !id)
      return res
        .status(400)
        .json({ success: false, message: "Rute or ID is required" });
    const filter = id ? { _id: id } : { rute, ...(tanggal ? { tanggal } : {}) };
    const result = await SlaData.updateMany(filter, { $set: { titik } });
    if (result.matchedCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Data SLA tidak ditemukan" });
    res.json({ success: true, message: "Data SLA berhasil diperbarui" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Clear all data
app.delete("/api/data/clear", async (req, res) => {
  try {
    await Promise.all([VolumeData.deleteMany({}), SlaData.deleteMany({})]);
    res.json({ success: true, message: "All data cleared" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Serve frontend
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "dashboard-postal.html")),
);
app.get("/dashboard-postal.html", (req, res) =>
  res.sendFile(path.join(__dirname, "dashboard-postal.html")),
);
app.get("/dashboard-chartbar.html", (req, res) =>
  res.sendFile(path.join(__dirname, "dashboard-chartbar.html")),
);

// ─── Start ────────────────────────────────────────────────────────────────────

// Jalankan koneksi database saat startup (abaikan crash agar server tetap jalan)
connectDB().catch(err => {
  console.error("❌ Gagal konek ke MongoDB saat startup:", err.message);
});
// Baris ini SANGAT PENTING untuk Vercel
module.exports = app;