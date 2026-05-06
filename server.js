const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allow all origins for easier deployment
app.use(express.json());
app.use(express.static(__dirname));

// Serve dashboard-postal.html at the root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard-postal.html'));
});

// JSON Database file
const DB_FILE = path.join(__dirname, 'data.json');

// Load data from JSON file
function loadData() {
  let data = { volumeData: [], slaData: [] };
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      data = JSON.parse(content);
      
      // Migration: Add weekKey to old records
      let changed = false;
      [data.volumeData, data.slaData].forEach(arr => {
        if (arr && Array.isArray(arr)) {
          arr.forEach(item => {
            if (item && !item.weekKey && item.tanggal) {
              try {
                const range = getWeekRange(item.tanggal);
                if (range) {
                    item.weekStart = range.startDate;
                    item.weekEnd = range.endDate;
                    item.weekKey = range.weekKey;
                    changed = true;
                }
              } catch (e) {
                console.warn('Skip weekKey migration for invalid date:', item.tanggal);
              }
            }
          });
        }
      });
      
      if (changed) {
        console.log('Data migration: Updated missing weekKeys');
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
      }
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
  return data;
}

// Save data to JSON file
function saveData(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving data:', error);
    return false;
  }
}

// Initialize data
let db = loadData();

// Add default SLA data with N22 targets if empty
if (db.slaData && db.slaData.length === 0) {
  const defaultSLAData = [
    {
      id: 1,
      tanggal: '2026-04-14',
      rute: 'Rute 1: JAT - Surabaya',
      titik: [
        { label: 'JAT (OUT)', realisasi: null, target: '08:00' },
        { label: 'Surabaya (IN)', realisasi: null, target: '22:00' }
      ],
      category: 'primer',
      uploadTime: new Date().toISOString()
    },
    {
      id: 2,
      tanggal: '2026-04-14',
      rute: 'Rute 2: JAT - Yogyakarta',
      titik: [
        { label: 'JAT (OUT)', realisasi: null, target: '07:00' },
        { label: 'Yogyakarta (IN)', realisasi: null, target: '14:00' }
      ],
      category: 'primer',
      uploadTime: new Date().toISOString()
    },
    {
      id: 3,
      tanggal: '2026-04-14',
      rute: 'Rute 3: JAT - Medan',
      titik: [
        { label: 'JAT (OUT)', realisasi: null, target: '06:00' },
        { label: 'Medan (IN)', realisasi: null, target: '18:00' }
      ],
      category: 'primer',
      uploadTime: new Date().toISOString()
    },
    {
      id: 4,
      tanggal: '2026-04-14',
      rute: 'Rute 4: JAT - Purwokerto',
      titik: [
        { label: 'JAT (OUT)', realisasi: null, target: '06:00' },
        { label: 'Purwokerto (IN)', realisasi: null, target: '12:00' }
      ],
      category: 'primer',
      uploadTime: new Date().toISOString()
    }
  ];
  
  db.slaData = defaultSLAData;
  saveData(db);
}

// Simple users (in-memory)
let users = [
  { id: 1, username: 'admin', password: 'admin123', role: 'admin' },
  { id: 2, username: 'postal', password: 'mirasenja', role: 'viewer' }
];

// Configure multer for file upload
const upload = multer({ dest: 'uploads/' });

// API Routes

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
  
  if (!user) {
    return res.status(401).json({ success: false, message: 'Username atau password salah' });
  }
  
  res.json({ success: true, message: 'Login berhasil', user: { id: user.id, username: user.username, role: user.role } });
});

function formatExcelTime(value) {
  if (value == null || value === '') return '-';
  if (typeof value === 'number') {
    if (value < 1) {
      // Excel time is a fraction of a 24h day
      const totalSeconds = Math.round(value * 24 * 3600);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    // Might be HHMM format or something else
    const s = String(value);
    if (s.length === 3) return `0${s[0]}:${s.substring(1)}`;
    if (s.length === 4) return `${s.substring(0, 2)}:${s.substring(2)}`;
  }
  return String(value).trim();
}

function parseIndoNumber(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return val;
  // Remove spaces and handle comma as decimal separator
  let s = String(val).trim().replace(/\s/g, '');
  // If there's a comma and no dot, or comma is after dot, assume comma is decimal
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.');
  } else if (s.includes(',') && s.includes('.')) {
    // Likely thousands separator with dot and decimal with comma (Indonesian standard)
    s = s.replace(/\./g, '').replace(',', '.');
  }
  let n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Helper function to parse date from various formats
function parseDate(dateValue) {
  if (!dateValue) return null;
  
  // 1. Handle Excel Serial Dates (Numbers)
  if (typeof dateValue === 'number') {
    // 25569 is the number of days between 1900-01-01 and 1970-01-01
    const d = new Date(Math.round((dateValue - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) {
      // Use toISOString but fix for timezone (we want the UTC date part that matches the serial)
      return d.toISOString().split('T')[0];
    }
  }

  // 2. If it's already a JS Date object
  if (dateValue instanceof Date) {
    if (!isNaN(dateValue.getTime())) {
      const offset = dateValue.getTimezoneOffset() * 60000;
      return new Date(dateValue.getTime() - offset).toISOString().split('T')[0];
    }
  }
  
  // 3. Handle Strings
  if (typeof dateValue === 'string') {
    const s = dateValue.trim();
    if (!s) return null;

    // Format DD-MM-YYYY or DD/MM/YYYY
    const ddMmYyyyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (ddMmYyyyMatch) {
      let day = ddMmYyyyMatch[1].padStart(2, '0');
      let month = ddMmYyyyMatch[2].padStart(2, '0');
      let year = ddMmYyyyMatch[3];
      if (year.length === 2) year = '20' + year;
      return `${year}-${month}-${day}`;
    }

    // Format YYYY-MM-DD or YYYY/MM/DD
    const yyyyMmDdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (yyyyMmDdMatch) {
      return `${yyyyMmDdMatch[1]}-${yyyyMmDdMatch[2].padStart(2, '0')}-${yyyyMmDdMatch[3].padStart(2, '0')}`;
    }
    
    // Parse formats with Month Names (Indo/English)
    const months = {
      'januari': 1, 'january': 1, 'jan': 1, 'februari': 2, 'february': 2, 'feb': 2, 
      'maret': 3, 'march': 3, 'mar': 3, 'april': 4, 'apr': 4, 'mei': 5, 'may': 5, 
      'juni': 6, 'june': 6, 'jun': 6, 'juli': 7, 'july': 7, 'jul': 7, 
      'agustus': 8, 'august': 8, 'aug': 8, 'september': 9, 'sep': 9, 
      'oktober': 10, 'october': 10, 'okt': 10, 'november': 11, 'nov': 11, 
      'desember': 12, 'december': 12, 'des': 12
    };

    // Match "30 Maret 2026" or "30-Mar-2026"
    const namedDateMatch = s.match(/^(\d{1,2})[\s-/]+([A-Za-z]+)[\s-/]+(\d{2,4})$/);
    if (namedDateMatch) {
      const day = namedDateMatch[1].padStart(2, '0');
      const monthName = namedDateMatch[2].toLowerCase();
      let year = namedDateMatch[3];
      if (year.length === 2) year = '20' + year;
      const monthNum = months[monthName];
      if (monthNum) {
        return `${year}-${monthNum.toString().padStart(2, '0')}-${day}`;
      }
    }

    // Fallback: standard JS parse
    const parsedDate = new Date(s);
    if (!isNaN(parsedDate.getTime())) {
      const offset = parsedDate.getTimezoneOffset() * 60000;
      return new Date(parsedDate.getTime() - offset).toISOString().split('T')[0];
    }
  }

  return null;
}

// Helper function to get week range from date
function getWeekRange(dateStr) {
  // Use local-style date parsing then convert to UTC-like object for calculation
  const date = new Date(dateStr + 'T00:00:00Z');
  const day = date.getUTCDay(); // 0 = Sunday, 1 = Monday
  
  // Calculate difference to Monday (Monday should be day 1)
  // If today is Sunday (0), we go back 6 days.
  // If today is Monday (1), we go back 0 days.
  const diff = (day === 0 ? -6 : 1) - day;
  
  const monday = new Date(date.getTime() + diff * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  
  const mondayStr = monday.toISOString().split('T')[0];
  const sundayStr = sunday.toISOString().split('T')[0];
  
  return { startDate: mondayStr, endDate: sundayStr, weekKey: `${mondayStr}_${sundayStr}` };
}

// Upload Volume Excel
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    const { category, weekStart, weekEnd } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
    }
    
    // Read Excel file
    const workbook = xlsx.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Get all rows as arrays. DO NOT use cellDates: true to avoid month-day swaps for ambiguous dates
    const allRows = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: true });
    if (allRows.length === 0) {
      return res.status(400).json({ success: false, message: 'File kosong' });
    }

    // Find header row (the one that contains 'Rute' or 'Attribute' or 'Posta')
    let headerRowIdx = -1;
    let colMap = { rute: -1, tanggal: -1, postal: -1, poslog: -1, kapasitas: -1, space: -1 };
    
    for (let i = 0; i < Math.min(allRows.length, 20); i++) {
      const row = allRows[i];
      if (!row || !Array.isArray(row)) continue;
      
      const findCol = (terms) => row.findIndex(c => c && terms.some(t => String(c).toLowerCase().includes(t.toLowerCase())));
      
      const r = findCol(['nama rute', 'rute']);
      const t = findCol(['attribute', 'tanggal', 'date', 'tgl']);
      const p = findCol(['posta', 'postal']);
      
      if (r !== -1 && (t !== -1 || p !== -1)) {
        headerRowIdx = i;
        colMap.rute = r;
        colMap.tanggal = t;
        colMap.postal = p;
        colMap.poslog = findCol(['poslog', 'non postal', 'non_postal']);
        colMap.kapasitas = findCol(['kapasit', 'kapasitas', 'capacity']);
        colMap.space = findCol(['space', 'sisa']);
        break;
      }
    }

    if (headerRowIdx === -1) {
      return res.status(400).json({ success: false, message: 'Format kolom tidak dikenali. Pastikan ada kolom "Nama Rute" dan "Attribute" atau "Postal".' });
    }

    let successCount = 0;
    let errorCount = 0;
    let usedWeekRange = null;
    
    // Process data rows
    for (let i = headerRowIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row || row.length === 0) continue;

      try {
        // --- SMART COLUMN DETECTION (Fallback) ---
        // If colMap is missing something, try to guess from the first 100 data rows
        if (i <= headerRowIdx + 100) {
           row.forEach((cell, idx) => {
             if (cell == null) return;
             const str = String(cell).trim();
             
             // Detect Date column
             if (colMap.tanggal === -1) {
               if (typeof cell === 'number' && cell > 40000 && cell < 60000) colMap.tanggal = idx;
               else if (str.match(/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/)) colMap.tanggal = idx;
               else if (str.match(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/)) colMap.tanggal = idx;
             }
             
             // Detect Rute column (long string)
             if (colMap.rute === -1 && typeof cell === 'string' && str.length > 5) colMap.rute = idx;
             
             // Detect Postal/Volume column (numeric)
             if (colMap.postal === -1 && typeof cell === 'number' && cell > 0) colMap.postal = idx;
           });
        }

        const routeName = colMap.rute !== -1 ? String(row[colMap.rute] || '').trim() : '';
        if (!routeName) continue;
        
        // Parse Date
        let recordDate = null;
        if (colMap.tanggal !== -1 && row[colMap.tanggal]) {
          recordDate = parseDate(row[colMap.tanggal]);
        }
        
        // Fallback to provided week range if no date in row
        if (!recordDate && weekStart) {
          recordDate = weekStart;
        }
        
        // Final fallback to today
        if (!recordDate) {
          recordDate = new Date().toISOString().split('T')[0];
        }
        
        const weekRange = getWeekRange(recordDate);
        if (!usedWeekRange) usedWeekRange = weekRange.weekKey;

        // Parse Volumes
        const postalVolume = colMap.postal !== -1 ? parseIndoNumber(row[colMap.postal]) : 0;
        const nonPostalVolume = colMap.poslog !== -1 ? parseIndoNumber(row[colMap.poslog]) : 0;
        const kapasitas = colMap.kapasitas !== -1 ? parseIndoNumber(row[colMap.kapasitas]) : 0;
        
        // Space logic
        let spaceAvailable = 0;
        if (colMap.space !== -1 && row[colMap.space] != null) {
          const rawSpace = row[colMap.space];
          if (typeof rawSpace === 'number') {
            spaceAvailable = rawSpace <= 1 ? rawSpace : rawSpace / 100;
          } else {
            spaceAvailable = parseIndoNumber(String(rawSpace).replace('%', '').trim()) / 100;
          }
        } else if (kapasitas > 0) {
          spaceAvailable = 1 - ((postalVolume + nonPostalVolume) / kapasitas);
        }

        const newRecord = {
          id: db.volumeData.length + 1,
          tanggal: recordDate,
          rute: routeName,
          postal: postalVolume,
          nonPostal: nonPostalVolume,
          kapasitas: kapasitas,
          sisa: spaceAvailable,
          category: category || 'primer',
          weekStart: weekRange.startDate,
          weekEnd: weekRange.endDate,
          weekKey: weekRange.weekKey,
          uploadTime: new Date().toISOString()
        };
        
        db.volumeData.push(newRecord);
        successCount++;
      } catch (err) {
        console.error('Error processing row:', err);
        errorCount++;
      }
    }
    
    // Save to JSON file
    saveData(db);
    
    // Delete uploaded file
    try { fs.unlinkSync(file.path); } catch(e) {}
    
    res.json({
      success: true,
      message: `Data berhasil diupload: ${successCount} rute berhasil`,
      successCount,
      errorCount,
      weekRange: usedWeekRange
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Error processing file: ' + error.message });
  }
});

// Upload SLA Excel
app.post('/api/upload-sla', upload.single('file'), (req, res) => {
  console.log('\n=== SLA UPLOAD PROCESS START ===');
  try {
    const { category, weekStart } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
    
    const workbook = xlsx.readFile(file.path);
    const uploadDate = weekStart ? weekStart : new Date().toISOString().split('T')[0];
    let successCount = 0;
    
    let sheet = null;
    let rows = [];
    for (const name of workbook.SheetNames) {
      const currentRows = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1 });
      if (currentRows.length > 5) {
        sheet = workbook.Sheets[name];
        rows = currentRows;
        console.log(`Using sheet: ${name}`);
        break;
      }
    }
    if (!sheet) {
      sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    }

    let headerRowIdx = -1;
    let colMap = { nopol: -1, rute: -1, kota: -1, tgl: -1, target: -1, realisasi: -1, status: -1 };
    for (let i = 0; i < Math.min(rows.length, 50); i++) {
      const row = rows[i];
      if (!row || !Array.isArray(row)) continue;
      const f = (t) => row.findIndex(c => c && t.some(x => String(c).toLowerCase().includes(x.toLowerCase())));
      const n = f(['nopol', 'no pol']);
      const r = f(['rute', 'route']);
      if (n !== -1 && r !== -1) {
        headerRowIdx = i;
        colMap = { nopol: n, rute: r, kota: f(['kota', 'lokasi']), tgl: f(['tgl', 'tanggal']), target: f(['standar', 'target']), realisasi: f(['aktual', 'realisasi']), status: f(['status']) };
        break;
      }
    }

    if (headerRowIdx === -1) {
      const preview = rows.slice(0, 5).map(r => JSON.stringify(r)).join('\n');
      return res.status(400).json({ success: false, message: 'Format tidak dikenali.\n' + preview });
    }

    const trips = {};
    rows.slice(headerRowIdx + 1).forEach((row) => {
      if (!row || row.length === 0) return;
      const nopol = colMap.nopol !== -1 ? String(row[colMap.nopol] || '').trim() : '';
      const rute = colMap.rute !== -1 ? String(row[colMap.rute] || '').trim() : '';
      if (!nopol || !rute || nopol.includes('|') || nopol.toLowerCase() === 'nopol') return;
      
      const tgl = colMap.tgl !== -1 ? parseDate(row[colMap.tgl]) : uploadDate;
      const key = `${nopol}_${rute}_${tgl}`;
      if (!trips[key]) trips[key] = { nopol, rute, titik: [], tanggal: tgl };
      
      trips[key].titik.push({
        label: colMap.kota !== -1 ? String(row[colMap.kota] || 'Point').trim() : 'Point',
        target: colMap.target !== -1 ? formatExcelTime(row[colMap.target]) : '-',
        realisasi: colMap.realisasi !== -1 ? formatExcelTime(row[colMap.realisasi]) : '-',
        status: colMap.status !== -1 ? String(row[colMap.status] || '').trim() : ''
      });
    });

    if (Object.keys(trips).length === 0) return res.status(400).json({ success: false, message: 'Data tidak ditemukan.' });

    let minDate = null, maxDate = null;
    Object.values(trips).forEach(trip => {
      const week = getWeekRange(trip.tanggal);
      if (!minDate || trip.tanggal < minDate) minDate = trip.tanggal;
      if (!maxDate || trip.tanggal > maxDate) maxDate = trip.tanggal;
      db.slaData.push({ id: db.slaData.length + 1, ...trip, category: category || 'postal', weekStart: week.startDate, weekEnd: week.endDate, weekKey: week.weekKey, uploadTime: new Date().toISOString() });
      successCount++;
    });

    saveData(db);
    try { fs.unlinkSync(file.path); } catch(e) {}
    console.log(`=== SUCCESS: ${successCount} routes ===`);
    return res.json({ success: true, message: `Upload berhasil: ${successCount} rute`, minDate, maxDate });
  } catch (error) {
    console.error('SLA Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});



// Get volume data
app.get('/api/volume', (req, res) => {
  const { category, startDate, endDate, weekKey, aggregate } = req.query;
  
  let filtered = db.volumeData;
  
  if (category) {
    filtered = filtered.filter(item => item.category === category);
  }
  
  // Filter by week key if provided (ignore if "ALL")
  if (weekKey && weekKey !== 'ALL' && weekKey !== 'undefined') {
    filtered = filtered.filter(item => item.weekKey === weekKey);
  } else if (weekKey === 'ALL') {
    // If ALL, don't filter by date at all, show everything for this category
  } else if (startDate && endDate) {
    // Filter by date range
    filtered = filtered.filter(item => item.tanggal >= startDate && item.tanggal <= endDate);
  }

  const rf = req.query.routeFilter;
  if (rf && rf !== '' && rf !== 'undefined' && rf !== 'null' && rf !== 'Semua Rute') {
    const rfLower = rf.toLowerCase().trim();
    filtered = filtered.filter(item => {
      if (!item) return false;
      const dbRute = (item.rute || item.route_name || '').toLowerCase().trim();
      return dbRute === rfLower;
    });
    console.log(`[Volume] Results after filter: ${filtered.length}`);
  }

  // If aggregate requested (for weekly recap)
  if (aggregate === 'true') {
    const routeMap = {};
    filtered.forEach(item => {
      if (!routeMap[item.rute]) {
        routeMap[item.rute] = {
          rute: item.rute,
          postal: 0,
          nonPostal: 0,
          kapasitas: 0,
          sisa: 0,
          count: 0,
          tanggal: weekKey === 'ALL' ? 'SEMUA MINGGU' : (weekKey || 'Rekap')
        };
      }
      const dailyCapacity = (item.kapasitas || 0) / 7; // Formula: Kapasitas Mingguan / 7 Hari
      routeMap[item.rute].postal += (item.postal || 0);
      routeMap[item.rute].nonPostal += (item.nonPostal || 0);
      routeMap[item.rute].kapasitas += dailyCapacity;
      routeMap[item.rute].sisa += (dailyCapacity - (item.postal || 0) - (item.nonPostal || 0));
      routeMap[item.rute].count++;
    });

    const aggregated = Object.values(routeMap).map(r => {
      const totalCap = r.kapasitas || 1;
      return {
        ...r,
        // Sisa ratio for the whole period (Sum of Sisa kg / Sum of Capacity kg)
        sisa: r.sisa / totalCap 
      };
    });
    
    // Find date range in filtered data
    let minDate = null, maxDate = null;
    filtered.forEach(item => {
      if (item.tanggal) {
        if (!minDate || item.tanggal < minDate) minDate = item.tanggal;
        if (!maxDate || item.tanggal > maxDate) maxDate = item.tanggal;
      }
    });
    
    res.json({ success: true, data: aggregated, minDate, maxDate });
  } else {
    // Standard non-aggregated list
    res.json({ success: true, data: filtered });
  }
});

// Get SLA data
app.get('/api/sla', (req, res) => {
  const { category, startDate, endDate, weekKey, aggregate } = req.query;
  
  try {
    let filtered = db.slaData || [];
    
    if (category) {
      filtered = filtered.filter(item => item && item.category === category);
    }
    
    if (weekKey && weekKey !== 'ALL' && weekKey !== 'undefined') {
      filtered = filtered.filter(item => item && item.weekKey === weekKey);
    } else if (weekKey === 'ALL') {
      // Show all data
    } else if (startDate && endDate) {
      filtered = filtered.filter(item => item && item.tanggal && item.tanggal >= startDate && item.tanggal <= endDate);
    }

    // Robust Route Filter
    const rf = req.query.routeFilter;
    if (rf && rf !== '' && rf !== 'undefined' && rf !== 'null' && rf !== 'Semua Rute') {
      const rfLower = rf.toLowerCase().trim();
      filtered = filtered.filter(item => {
        if (!item) return false;
        const dbRute = (item.rute || item.route_name || '').toLowerCase().trim();
        return dbRute === rfLower;
      });
    }

    if (aggregate === 'true') {
      const routeMap = {};
      filtered.forEach(item => {
        if (!item || !item.rute) return;
        const key = item.rute; // Aggregate by route
        if (!routeMap[key]) {
          routeMap[key] = {
            rute: item.rute,
            nopol: item.nopol || 'Multi',
            tanggal: 'Rekap',
            titik: []
          };
        }
        
        if (item.titik) {
          item.titik.forEach((t, idx) => {
            if (!routeMap[key].titik[idx]) {
              routeMap[key].titik[idx] = {
                label: t.label,
                target: t.target,
                totalMinutes: 0,
                count: 0,
                status: 'On-Time'
              };
            }
            
            if (t.realisasi && t.realisasi !== '-') {
              const parts = t.realisasi.split(':');
              if (parts.length === 2) {
                const mins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                routeMap[key].titik[idx].totalMinutes += mins;
                routeMap[key].titik[idx].count++;
                
                // If any trip in the period was delayed, mark the rekap as delay
                if (t.status && (t.status.toLowerCase().includes('terlambat') || t.status.toLowerCase().includes('delay'))) {
                  routeMap[key].titik[idx].status = 'Delay';
                }
              }
            }
          });
        }
      });

      const aggregated = Object.values(routeMap);
      
      // Find date range
      let minDate = null, maxDate = null;
      filtered.forEach(item => {
        if (item && item.tanggal) {
          if (!minDate || item.tanggal < minDate) minDate = item.tanggal;
          if (!maxDate || item.tanggal > maxDate) maxDate = item.tanggal;
        }
      });

      return res.json({ success: true, data: aggregated, minDate, maxDate });
    }
    
    res.json({ success: true, data: filtered });
  } catch (err) {
    console.error("SLA API Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get routes for dashboard (with aggregation for weekly)
app.get('/api/routes', (req, res) => {
  const { category, startDate, endDate, weekKey, aggregate } = req.query;
  
  try {
    let filtered = db.volumeData || [];
    
    if (category) {
      filtered = filtered.filter(item => item && item.category === category);
    }
    
    if (weekKey && weekKey !== 'ALL' && weekKey !== 'undefined' && weekKey !== 'null') {
      filtered = filtered.filter(item => item && item.weekKey === weekKey);
    } else if (weekKey === 'ALL') {
      // Ignore date filters for ALL weeks
    } else if (startDate && endDate && startDate !== '' && endDate !== '' && startDate !== 'undefined' && endDate !== 'undefined') {
      filtered = filtered.filter(item => item && item.tanggal && item.tanggal >= startDate && item.tanggal <= endDate);
    }
    
    const rf = req.query.routeFilter;
    if (rf && rf !== '' && rf !== 'undefined' && rf !== 'null' && rf !== 'Semua Rute') {
      const rfLower = rf.toLowerCase().trim();
      filtered = filtered.filter(item => {
        if (!item || !item.rute) return false;
        return item.rute.toLowerCase().trim() === rfLower;
      });
    }
    
    // Group by route and aggregate (sum totals per week)
    const routeMap = {};
    filtered.forEach(item => {
      if (!item || !item.rute) return;
      if (!routeMap[item.rute]) {
        routeMap[item.rute] = {
          route_name: item.rute,
          postal_volume: 0,
          non_postal_volume: 0,
          kapasitas_total: 0,
          space_sum: 0,
          count: 0
        };
      }
      const dailyCapacity = (item.kapasitas || 0) / 7; // Formula: Kapasitas Mingguan / 7 Hari
      routeMap[item.rute].postal_volume += (item.postal || 0);
      routeMap[item.rute].non_postal_volume += (item.nonPostal || 0);
      routeMap[item.rute].kapasitas_total += dailyCapacity;
      routeMap[item.rute].space_sum += (dailyCapacity - (item.postal || 0) - (item.nonPostal || 0));
      routeMap[item.rute].count++;
    });
    
    // Convert to array: akumulasi dari data harian yang dijumlahkan
    const routes = Object.values(routeMap).map(route => {
      return {
        route_name: route.route_name,
        postal_volume: route.postal_volume,
        non_postal_volume: route.non_postal_volume,
        kapasitas: route.kapasitas_total,
        // space_available here is the TOTAL kg sisa across all records in the group
        space_available: route.space_sum 
      };
    });
    
    // Find date range in filtered data
    let minDate = null, maxDate = null;
    filtered.forEach(item => {
      if (item.tanggal) {
        if (!minDate || item.tanggal < minDate) minDate = item.tanggal;
        if (!maxDate || item.tanggal > maxDate) maxDate = item.tanggal;
      }
    });

    res.json({ success: true, data: routes, minDate, maxDate });
  } catch (err) {
    console.error("Routes API Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get statistics
app.get('/api/stats', (req, res) => {
  const { category, startDate, endDate, weekKey, routeFilter, aggregate } = req.query;
  
  try {
    let filtered = db.volumeData || [];
    
    if (category) {
      filtered = filtered.filter(item => item && item.category === category);
    }
    
    if (weekKey && weekKey !== 'ALL' && weekKey !== 'undefined') {
      filtered = filtered.filter(item => item && item.weekKey === weekKey);
    } else if (weekKey === 'ALL') {
      // Ignore date filters for ALL weeks
    } else if (startDate && endDate) {
      filtered = filtered.filter(item => item && item.tanggal && item.tanggal >= startDate && item.tanggal <= endDate);
    }
    
    const rf = req.query.routeFilter || routeFilter;
    if (rf && rf !== '' && rf !== 'undefined' && rf !== 'null' && rf !== 'Semua Rute') {
      const rfLower = rf.toLowerCase().trim();
      filtered = filtered.filter(item => {
        if (!item || !item.rute) return false;
        return item.rute.toLowerCase().trim() === rfLower;
      });
    }
    
    const uniqueRoutes = [...new Set(filtered.filter(r => r && r.rute).map(r => r.rute))];
    const count = filtered.length > 0 ? filtered.length : 1;
    
    // Akumulasi dari data harian yang dijumlahkan (Kapasitas dibagi 7 sesuai rumus user)
    const postalVolume = filtered.reduce((sum, r) => sum + (r.postal || 0), 0);
    const poslogVolume = filtered.reduce((sum, r) => sum + (r.nonPostal || 0), 0);
    const totalCapacity = filtered.reduce((sum, r) => sum + ((r.kapasitas || 0) / 7), 0);
    const totalSisaKg = totalCapacity - postalVolume - poslogVolume;
    const avgSpacePct = totalCapacity > 0 ? (totalSisaKg / totalCapacity * 100) : 0;
      
    // Find date range
    let minDate = null, maxDate = null;
    filtered.forEach(item => {
      if (item && item.tanggal) {
        if (!minDate || item.tanggal < minDate) minDate = item.tanggal;
        if (!maxDate || item.tanggal > maxDate) maxDate = item.tanggal;
      }
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
        avg_space: avgSpacePct 
      }
    });
  } catch (err) {
    console.error("Stats API Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get available weeks for weekly filter
app.get('/api/weeks', (req, res) => {
  const { category } = req.query;
  
  let filtered = db.volumeData;
  
  if (category) {
    filtered = filtered.filter(item => item.category === category);
  }
  
  // Group by week
  const weekMap = {};
  filtered.forEach(item => {
    const weekRange = getWeekRange(item.tanggal);
    const weekKey = weekRange.weekKey;
    
    if (!weekMap[weekKey]) {
      weekMap[weekKey] = {
        weekKey: weekKey,
        startDate: weekRange.startDate,
        endDate: weekRange.endDate,
        recordCount: 0
      };
    }
    weekMap[weekKey].recordCount++;
  });
  
  // Convert to array and sort by date
  const weeks = Object.values(weekMap).sort((a, b) => b.startDate.localeCompare(a.startDate));
  
  res.json({ success: true, data: weeks });
});

// Delete SLA data by route name
app.delete('/api/sla', (req, res) => {
  try {
    const { routeName, routeNames } = req.body;
    
    if (!routeName && (!routeNames || !Array.isArray(routeNames))) {
      return res.status(400).json({ success: false, message: 'Route name(s) is required' });
    }
    
    const targetRoutes = routeNames || [routeName];
    
    // Find and remove SLA data for the specified route(s)
    const originalLength = db.slaData.length;
    db.slaData = db.slaData.filter(item => !targetRoutes.includes(item.rute));
    const deletedCount = originalLength - db.slaData.length;
    
    if (deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'No SLA data found for this route' });
    }
    
    // Save to database
    saveData(db);
    
    console.log(`Deleted ${deletedCount} SLA records for route: ${routeName}`);
    res.json({ 
      success: true, 
      message: `Successfully deleted ${deletedCount} SLA records for ${routeName}` 
    });
    
  } catch (error) {
    console.error('Error deleting SLA data:', error);
    res.status(500).json({ success: false, message: 'Error deleting SLA data: ' + error.message });
  }
});

// Delete Volume data by route name
app.delete('/api/volume', (req, res) => {
  try {
    const { routeName, routeNames } = req.body;
    
    if (!routeName && (!routeNames || !Array.isArray(routeNames))) {
      return res.status(400).json({ success: false, message: 'Route name(s) is required' });
    }
    
    const targetRoutes = routeNames || [routeName];
    
    // Find and remove Volume data for the specified route(s)
    const originalLength = db.volumeData.length;
    db.volumeData = db.volumeData.filter(item => !targetRoutes.includes(item.rute));
    const deletedCount = originalLength - db.volumeData.length;
    
    if (deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'No Volume data found for this route' });
    }
    
    // Save to database
    saveData(db);
    
    console.log(`Deleted ${deletedCount} Volume records for route: ${routeName}`);
    res.json({ 
      success: true, 
      message: `Successfully deleted ${deletedCount} Volume records for ${routeName}` 
    });
    
  } catch (error) {
    console.error('Error deleting Volume data:', error);
    res.status(500).json({ success: false, message: 'Error deleting Volume data: ' + error.message });
  }
});

// Update Volume data
app.put('/api/volume', (req, res) => {
  try {
    const { rute, postal, nonPostal, tanggal, id } = req.body;
    
    if (!rute && !id) {
      return res.status(400).json({ success: false, message: 'Rute or ID is required' });
    }
    
    let updated = false;
    db.volumeData = db.volumeData.map(item => {
      // Use == for flexible matching of string/number IDs from request
      const match = id ? (item.id == id) : (item.rute === rute && (!tanggal || item.tanggal === tanggal));
      if (match) {
        updated = true;
        return {
          ...item,
          postal: postal !== undefined ? parseFloat(postal) : item.postal,
          nonPostal: nonPostal !== undefined ? parseFloat(nonPostal) : item.nonPostal,
          kapasitas: req.body.kapasitas !== undefined ? parseFloat(req.body.kapasitas) : item.kapasitas,
          // Recalculate space if needed
          sisa: (req.body.kapasitas || item.kapasitas) > 0 ? (1 - (((postal !== undefined ? parseFloat(postal) : item.postal) + (nonPostal !== undefined ? parseFloat(nonPostal) : item.nonPostal)) / (req.body.kapasitas || item.kapasitas))) : item.sisa
        };
      }
      return item;
    });
    
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Data volume tidak ditemukan' });
    }
    
    saveData(db);
    res.json({ success: true, message: 'Data volume berhasil diperbarui' });
  } catch (error) {
    console.error('Error updating volume:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update SLA data
app.put('/api/sla', (req, res) => {
  try {
    const { rute, titik, tanggal, id } = req.body;
    
    if (!rute && !id) {
      return res.status(400).json({ success: false, message: 'Rute or ID is required' });
    }
    
    let updated = false;
    db.slaData = db.slaData.map(item => {
      const match = id ? (item.id === id) : (item.rute === rute && (!tanggal || item.tanggal === tanggal));
      if (match) {
        updated = true;
        return {
          ...item,
          titik: titik || item.titik
        };
      }
      return item;
    });
    
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Data SLA tidak ditemukan' });
    }
    
    saveData(db);
    res.json({ success: true, message: 'Data SLA berhasil diperbarui' });
  } catch (error) {
    console.error('Error updating SLA:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete all data (for testing)
app.delete('/api/data/clear', (req, res) => {
  db = { volumeData: [], slaData: [] };
  saveData(db);
  res.json({ success: true, message: 'All data cleared' });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard-postal.html'));
});

app.get('/dashboard-postal.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard-postal.html'));
});

app.get('/dashboard-chartbar.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard-chartbar.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Default login: admin / admin123');
  console.log(`Database: ${DB_FILE}`);
});
