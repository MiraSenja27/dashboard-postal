// Script ini untuk dijalankan di browser console (F12 -> Console)
// Pastikan Anda sudah login ke dashboard

async function updateRoute15SLA() {
    try {
        // Ganti dengan URL API Anda
        const API_URL = window.location.origin;
        
        // Ambil data SLA untuk Rute 15
        const response = await fetch(`${API_URL}/api/sla?routeFilter=Rute 15 JAT-SB`);
        const result = await response.json();
        
        if (!result.success || !result.data || result.data.length === 0) {
            console.log('⚠️ Tidak ada data SLA untuk Rute 15 JAT-SB');
            return;
        }
        
        console.log(`📊 Ditemukan ${result.data.length} record SLA untuk Rute 15`);
        
        let updatedCount = 0;
        
        for (const record of result.data) {
            console.log(`\n🔄 Processing: ${record.rute} (${record.tanggal})`);
            console.log(`   Titik sebelum:`, record.titik.map(t => t.label));
            
            // Filter titik untuk menghapus yang mengandung SLO
            const filteredTitik = record.titik.filter(t => 
                !t.label.toUpperCase().includes('SLO')
            );
            
            if (filteredTitik.length !== record.titik.length) {
                // Update record via API
                const updateResponse = await fetch(`${API_URL}/api/sla`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        rute: record.rute, 
                        titik: filteredTitik, 
                        tanggal: record.tanggal 
                    })
                });
                
                const updateResult = await updateResponse.json();
                
                if (updateResult.success) {
                    console.log(`   Titik sesudah:`, filteredTitik.map(t => t.label));
                    console.log(`   ✅ Berhasil diupdate`);
                    updatedCount++;
                } else {
                    console.log(`   ❌ Gagal: ${updateResult.message}`);
                }
            } else {
                console.log(`   ℹ️ Tidak ada perubahan (tidak ada titik SLO)`);
            }
        }
        
        console.log(`\n✅ Selesai! ${updatedCount} record berhasil diupdate`);
        console.log('🔄 Refresh halaman untuk melihat perubahan');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

// Jalankan fungsi
updateRoute15SLA();
