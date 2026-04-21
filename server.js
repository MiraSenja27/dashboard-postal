const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// JSON Database file
const DB_FILE = path.join(__dirname, 'data.json');

// Load data from JSON file
function loadData() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
  return { volumeData: [], slaData: [] };
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

// Simple users (in-memory)
let users = [
  { id: 1, username: 'admin', password: 'admin123' }
];

// Configure multer for file upload
const upload = multer({ dest: 'uploads/' });

// API Routes

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  const user = users.find(u => u.username === username && u.password === password);
  
  if (!user) {
    return res.status(401).json({ success: false, message: 'Username atau password salah' });
  }
  
  res.json({ success: true, message: 'Login berhasil', user: { id: user.id, username: user.username } });
});

// Helper function to parse date from various formats
function parseDate(dateValue) {
  if (!dateValue) return null;
  
  // If it's already a string in YYYY-MM-DD format
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return dateValue;
  }
  
  // If it's a number (Excel serial date)
  if (typeof dateValue === 'number') {
    const excelDate = new Date((dateValue - 25569) * 86400 * 1000);
    return excelDate.toISOString().split('T')[0];
  }
  
  // Try to parse as string
  if (typeof dateValue === 'string') {
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  
  return null;
}

// Helper function to get week range from date
function getWeekRange(dateStr) {
  const date = new Date(dateStr + 'T00:00:00Z');
  const dayOfWeek = date.getUTCDay();
  const diff = date.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust to Monday
  
  const monday = new Date(date.setUTCDate(diff));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  
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
    const data = xlsx.utils.sheet_to_json(worksheet);
    
    let successCount = 0;
    let errorCount = 0;
    let usedWeekRange = null;
    
    // Determine date range for this upload
    let uploadDateRange = null;
    if (weekStart && weekEnd) {
      uploadDateRange = { startDate: weekStart, endDate: weekEnd };
      usedWeekRange = `${weekStart}_${weekEnd}`;
    }
    
    // Insert data into database
    data.forEach(row => {
      try {
        // Parse route name
        const routeName = row['Nama Rute'] || row['Rute'] || row.rute || row.nama_rute || '';
        
        // Try to parse date from Excel
        let recordDate = null;
        const dateColumns = ['Tanggal', 'tanggal', 'Date', 'date', 'Tgl', 'tgl'];
        for (const col of dateColumns) {
          if (row[col]) {
            recordDate = parseDate(row[col]);
            if (recordDate) break;
          }
        }
        
        // If no date found in Excel, use the week range provided
        if (!recordDate && uploadDateRange) {
          recordDate = uploadDateRange.startDate;
        }
        
        // If still no date, use today
        if (!recordDate) {
          recordDate = new Date().toISOString().split('T')[0];
        }
        
        // Get week range for this record
        const weekRange = getWeekRange(recordDate);
        
        // Parse volumes
        let postalVolume = parseFloat(row.Postal || row.postal || 0);
        let nonPostalVolume = parseFloat(row['Non Postal'] || row['non postal'] || row.NonPostal || 0);
        let spaceAvailable = parseFloat(row.Sisa || row.sisa || row.Space || row.space || 0);
        
        // Handle negative values in parentheses
        if (typeof row.Sisa === 'string' && row.Sisa.includes('(')) {
          spaceAvailable = -parseFloat(row.Sisa.replace(/[(),]/g, ''));
        }
        
        const newRecord = {
          id: db.volumeData.length + 1,
          tanggal: recordDate,
          rute: routeName,
          postal: postalVolume,
          nonPostal: nonPostalVolume,
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
        console.error('Error inserting row:', err);
        errorCount++;
      }
    });
    
    // Save to JSON file
    saveData(db);
    
    // Delete uploaded file
    fs.unlinkSync(file.path);
    
    console.log(`Upload complete: ${successCount} routes uploaded for category ${category}`);
    
    res.json({
      success: true,
      message: `Data berhasil diupload: ${successCount} rute berhasil, ${errorCount} gagal`,
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
  try {
    const { category } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
    }
    
    // Read Excel file
    const workbook = xlsx.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);
    
    const uploadDate = new Date().toISOString().split('T')[0];
    let successCount = 0;
    let errorCount = 0;
    
    // Insert SLA data
    data.forEach(row => {
      try {
        const routeName = row['Nama Rute'] || row['Rute'] || '';
        
        // Parse titik-titik waktu (maksimal 15 titik)
        const titikData = [];
        for (let i = 1; i <= 15; i++) {
          const label = row[`Titik${i}_Label`];
          const realisasi = row[`Titik${i}_Realisasi`];
          const target = row[`Titik${i}_Target`];
          
          if (label && target) {
            titikData.push({
              label: label,
              realisasi: realisasi || null,
              target: target
            });
          }
        }
        
        if (titikData.length > 0) {
          const newRecord = {
            id: db.slaData.length + 1,
            tanggal: uploadDate,
            rute: routeName,
            titik: titikData,
            category: category || 'primer',
            uploadTime: new Date().toISOString()
          };
          
          db.slaData.push(newRecord);
          successCount++;
        }
      } catch (err) {
        console.error('Error inserting SLA row:', err);
        errorCount++;
      }
    });
    
    // Save to JSON file
    saveData(db);
    
    // Delete uploaded file
    fs.unlinkSync(file.path);
    
    console.log(`SLA Upload complete: ${successCount} routes uploaded`);
    
    res.json({
      success: true,
      message: `Data SLA berhasil diupload: ${successCount} rute berhasil, ${errorCount} gagal`,
      successCount,
      errorCount
    });
    
  } catch (error) {
    console.error('SLA Upload error:', error);
    res.status(500).json({ success: false, message: 'Error processing file: ' + error.message });
  }
});

// Get available weeks
app.get('/api/weeks', (req, res) => {
  const { category } = req.query;
  
  let filtered = db.volumeData;
  
  if (category) {
    filtered = filtered.filter(item => item.category === category);
  }
  
  // Get unique weeks
  const weeks = {};
  filtered.forEach(item => {
    if (item.weekKey) {
      if (!weeks[item.weekKey]) {
        weeks[item.weekKey] = {
          weekKey: item.weekKey,
          startDate: item.weekStart,
          endDate: item.weekEnd,
          recordCount: 0
        };
      }
      weeks[item.weekKey].recordCount++;
    }
  });
  
  // Convert to array and sort by date
  const weeksList = Object.values(weeks).sort((a, b) => 
    new Date(b.startDate) - new Date(a.startDate)
  );
  
  res.json({ success: true, data: weeksList });
});

// Get volume data
app.get('/api/volume', (req, res) => {
  const { category, startDate, endDate, weekKey } = req.query;
  
  let filtered = db.volumeData;
  
  if (category) {
    filtered = filtered.filter(item => item.category === category);
  }
  
  // Filter by week key if provided
  if (weekKey) {
    filtered = filtered.filter(item => item.weekKey === weekKey);
  } else if (startDate && endDate) {
    // Filter by date range
    filtered = filtered.filter(item => item.tanggal >= startDate && item.tanggal <= endDate);
  }
  
  res.json({ success: true, data: filtered });
});

// Get SLA data
app.get('/api/sla', (req, res) => {
  const { category, startDate, endDate } = req.query;
  
  let filtered = db.slaData;
  
  if (category) {
    filtered = filtered.filter(item => item.category === category);
  }
  
  if (startDate && endDate) {
    filtered = filtered.filter(item => item.tanggal >= startDate && item.tanggal <= endDate);
  }
  
  res.json({ success: true, data: filtered });
});

// Get routes for dashboard (with aggregation for weekly)
app.get('/api/routes', (req, res) => {
  const { category, startDate, endDate } = req.query;
  
  let filtered = db.volumeData;
  
  if (category) {
    filtered = filtered.filter(item => item.category === category);
  }
  
  if (startDate && endDate) {
    filtered = filtered.filter(item => item.tanggal >= startDate && item.tanggal <= endDate);
  }
  
  // Group by route and aggregate
  const routeMap = {};
  filtered.forEach(item => {
    if (!routeMap[item.rute]) {
      routeMap[item.rute] = {
        route_name: item.rute,
        postal_volume: 0,
        non_postal_volume: 0,
        space_available: 0,
        count: 0
      };
    }
    routeMap[item.rute].postal_volume += item.postal;
    routeMap[item.rute].non_postal_volume += item.nonPostal;
    routeMap[item.rute].space_available += item.sisa;
    routeMap[item.rute].count++;
  });
  
  // Convert to array and calculate averages
  const routes = Object.values(routeMap).map(route => ({
    route_name: route.route_name,
    postal_volume: route.postal_volume / route.count,
    non_postal_volume: route.non_postal_volume / route.count,
    space_available: route.space_available / route.count
  }));
  
  res.json({ success: true, data: routes });
});

// Get statistics
app.get('/api/stats', (req, res) => {
  const { category, startDate, endDate } = req.query;
  
  let filtered = db.volumeData;
  
  if (category) {
    filtered = filtered.filter(item => item.category === category);
  }
  
  if (startDate && endDate) {
    filtered = filtered.filter(item => item.tanggal >= startDate && item.tanggal <= endDate);
  }
  
  const uniqueRoutes = [...new Set(filtered.map(r => r.rute))];
  const totalVolume = filtered.reduce((sum, r) => sum + r.postal + r.nonPostal, 0);
  const avgSpace = filtered.length > 0 
    ? filtered.reduce((sum, r) => sum + (r.sisa > 0 ? r.sisa : 0), 0) / filtered.length 
    : 0;
  
  const stats = {
    total_routes: uniqueRoutes.length,
    total_volume: totalVolume,
    avg_space: avgSpace
  };
  
  res.json({ success: true, data: stats });
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Default login: admin / admin123');
  console.log(`Database: ${DB_FILE}`);
});
