// server.js - File Upload Service Mirip Catbox
// Support untuk Vercel (menggunakan API eksternal untuk penyimpanan)
// Menggunakan tmpfiles.org sebagai service utama

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi multer untuk upload sementara
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // Limit 100MB
    }
});

// API Keys untuk berbagai service penyimpanan
const STORAGE_SERVICES = {
    TMPFILES: {
        enabled: true,
        uploadUrl: 'https://tmpfiles.org/api/v1/upload',
        maxSize: 100 * 1024 * 1024, // 100MB
        description: 'File otomatis dihapus setelah 60 menit'
    },
    GOFILE: {
        enabled: true,
        serverUrl: 'https://api.gofile.io/getServer',
        uploadUrl: 'https://{server}.gofile.io/uploadFile'
    },
    TEMP_NINJA: {
        enabled: true,
        uploadUrl: 'https://tmp.ninja/api.php?d=upload',
        maxSize: 500 * 1024 * 1024 // 500MB
    }
};

// Database sederhana untuk menyimpan metadata file
let fileDatabase = [];

// Fungsi untuk generate ID unik
function generateUniqueId() {
    return crypto.randomBytes(8).toString('hex');
}

// ==================== TMPFILES.ORG SERVICE ====================
async function uploadToTmpFiles(fileBuffer, fileName, mimeType) {
    try {
        console.log('📤 Mencoba upload ke tmpfiles.org...');
        
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: fileName,
            contentType: mimeType
        });

        const response = await axios.post('https://tmpfiles.org/api/v1/upload', formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        console.log('✅ Response tmpfiles.org:', response.data);

        // Response dari tmpfiles.org:
        // {
        //   "success": true,
        //   "data": {
        //     "url": "https://tmpfiles.org/123456/filename.jpg"
        //   }
        // }

        if (response.data && response.data.success) {
            // Generate ID lokal untuk file
            const fileId = generateUniqueId();
            
            // Ambil URL dari response
            let fileUrl = response.data.data.url;
            
            // tmpfiles.org juga menyediakan direct download URL
            // Format: https://tmpfiles.org/dl/123456/filename.jpg
            const directUrl = fileUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
            
            // Set expiry 60 menit dari sekarang
            const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            
            console.log('✅ Upload berhasil ke tmpfiles.org:', fileUrl);
            
            return {
                success: true,
                url: fileUrl,
                directUrl: directUrl,
                fileId: fileId,
                service: 'tmpfiles.org',
                expiry: expiry,
                message: 'File akan otomatis dihapus setelah 60 menit'
            };
        } else {
            throw new Error(response.data?.error || 'Upload gagal ke tmpfiles.org');
        }
    } catch (error) {
        console.error('❌ Error uploading to tmpfiles.org:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.error || error.message
        };
    }
}

// ==================== GOFILE SERVICE ====================
async function getGoFileServer() {
    try {
        const response = await axios.get('https://api.gofile.io/getServer');
        return response.data.data.server;
    } catch (error) {
        console.error('Error getting GoFile server:', error);
        return null;
    }
}

async function uploadToGoFile(fileBuffer, fileName, mimeType) {
    try {
        console.log('📤 Mencoba upload ke GoFile...');
        
        // Dapatkan server yang tersedia
        const server = await getGoFileServer();
        if (!server) {
            throw new Error('Tidak dapat menemukan server GoFile');
        }

        const uploadUrl = `https://${server}.gofile.io/uploadFile`;
        
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: fileName,
            contentType: mimeType
        });

        const response = await axios.post(uploadUrl, formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        if (response.data.status === 'ok') {
            // Generate ID lokal untuk file
            const fileId = generateUniqueId();
            
            const fileUrl = `https://${server}.gofile.io/download/${response.data.data.fileId}/${fileName}`;
            
            console.log('✅ Upload berhasil ke GoFile:', fileUrl);
            
            return {
                success: true,
                url: fileUrl,
                fileId: fileId,
                service: 'gofile',
                directUrl: fileUrl
            };
        } else {
            throw new Error(response.data.message || 'Upload gagal');
        }
    } catch (error) {
        console.error('❌ Error uploading to GoFile:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// ==================== TEMP.NINJA SERVICE ====================
async function uploadToTempNinja(fileBuffer, fileName, mimeType) {
    try {
        console.log('📤 Mencoba upload ke tmp.ninja...');
        
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: fileName,
            contentType: mimeType
        });

        const response = await axios.post('https://tmp.ninja/api.php?d=upload', formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        // Parse response dari tmp.ninja
        let fileUrl = response.data.file?.url?.full || response.data.url || response.data;
        
        // Generate ID lokal untuk file
        const fileId = generateUniqueId();
        
        console.log('✅ Upload berhasil ke tmp.ninja:', fileUrl);

        return {
            success: true,
            url: fileUrl,
            fileId: fileId,
            service: 'tmp.ninja',
            directUrl: fileUrl
        };
    } catch (error) {
        console.error('❌ Error uploading to tmp.ninja:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// ==================== UPLOAD ENDPOINT ====================
app.post('/api/upload', upload.single('file'), async (req, res) => {
    console.log('📢 Upload endpoint dipanggil');
    
    try {
        if (!req.file) {
            console.log('❌ Tidak ada file');
            return res.status(400).json({
                success: false,
                error: 'Tidak ada file yang diupload'
            });
        }

        const file = req.file;
        const fileName = file.originalname;
        const fileBuffer = file.buffer;
        const fileSize = file.size;
        const mimeType = file.mimetype;

        console.log(`📁 Menerima file: ${fileName}, size: ${fileSize} bytes`);

        // Validasi ukuran file
        if (fileSize > 100 * 1024 * 1024) {
            return res.status(400).json({
                success: false,
                error: 'Ukuran file terlalu besar. Maksimal 100MB'
            });
        }

        let uploadResult = null;
        let errors = [];

        // PRIORITAS 1: Coba upload ke tmpfiles.org (paling stabil)
        if (STORAGE_SERVICES.TMPFILES.enabled) {
            uploadResult = await uploadToTmpFiles(fileBuffer, fileName, mimeType);
            if (uploadResult.success) {
                console.log('✅ Upload berhasil ke tmpfiles.org');
            } else {
                errors.push(`tmpfiles.org: ${uploadResult.error}`);
            }
        }

        // PRIORITAS 2: Jika tmpfiles.org gagal, coba GoFile
        if (!uploadResult || !uploadResult.success) {
            if (STORAGE_SERVICES.GOFILE.enabled) {
                uploadResult = await uploadToGoFile(fileBuffer, fileName, mimeType);
                if (uploadResult.success) {
                    console.log('✅ Upload berhasil ke GoFile');
                } else {
                    errors.push(`GoFile: ${uploadResult.error}`);
                }
            }
        }

        // PRIORITAS 3: Jika GoFile gagal, coba tmp.ninja
        if (!uploadResult || !uploadResult.success) {
            if (STORAGE_SERVICES.TEMP_NINJA.enabled) {
                uploadResult = await uploadToTempNinja(fileBuffer, fileName, mimeType);
                if (uploadResult.success) {
                    console.log('✅ Upload berhasil ke tmp.ninja');
                } else {
                    errors.push(`tmp.ninja: ${uploadResult.error}`);
                }
            }
        }

        // Jika semua service gagal
        if (!uploadResult || !uploadResult.success) {
            console.log('❌ Semua service gagal:', errors);
            return res.status(500).json({
                success: false,
                error: 'Semua service penyimpanan sedang sibuk. Silakan coba lagi nanti.',
                details: errors
            });
        }

        // Simpan metadata file ke database
        const fileData = {
            id: uploadResult.fileId,
            originalName: fileName,
            url: uploadResult.url,
            directUrl: uploadResult.directUrl || uploadResult.url,
            size: fileSize,
            mimeType: mimeType,
            service: uploadResult.service,
            uploadDate: new Date().toISOString(),
            downloads: 0,
            expiry: uploadResult.expiry || null
        };

        fileDatabase.push(fileData);
        console.log(`✅ File tersimpan di database. Total: ${fileDatabase.length}`);

        // Kirim response
        res.json({
            success: true,
            url: uploadResult.url,
            directUrl: uploadResult.directUrl || uploadResult.url,
            fileId: uploadResult.fileId,
            service: uploadResult.service,
            fileName: fileName,
            fileSize: fileSize,
            expiry: uploadResult.expiry,
            message: `File berhasil diupload menggunakan ${uploadResult.service}${uploadResult.expiry ? ' (berlaku 60 menit)' : ''}`
        });

    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Terjadi kesalahan saat upload file: ' + error.message
        });
    }
});

// ==================== GET FILES ====================
app.get('/api/files', (req, res) => {
    console.log('📢 Files endpoint dipanggil');
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    
    let filteredFiles = fileDatabase;
    
    // Filter berdasarkan pencarian
    if (search && search.length >= 3) {
        filteredFiles = fileDatabase.filter(file => 
            file.originalName.toLowerCase().includes(search.toLowerCase())
        );
    }
    
    // Sort by upload date descending
    filteredFiles.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

    const files = paginatedFiles.map(file => ({
        id: file.id,
        name: file.originalName,
        url: file.url,
        directUrl: file.directUrl,
        size: file.size,
        service: file.service,
        uploadDate: file.uploadDate,
        downloads: file.downloads,
        expiry: file.expiry
    }));

    res.json({
        success: true,
        files: files,
        total: filteredFiles.length,
        page: page,
        totalPages: Math.ceil(filteredFiles.length / limit) || 1,
        limit: limit
    });
});

// ==================== GET FILE INFO ====================
app.get('/api/files/:id', (req, res) => {
    console.log('📢 File info endpoint dipanggil untuk ID:', req.params.id);
    
    const file = fileDatabase.find(f => f.id === req.params.id);
    
    if (!file) {
        return res.status(404).json({
            success: false,
            error: 'File tidak ditemukan'
        });
    }

    res.json({
        success: true,
        file: {
            id: file.id,
            name: file.originalName,
            url: file.url,
            directUrl: file.directUrl,
            size: file.size,
            mimeType: file.mimeType,
            service: file.service,
            uploadDate: file.uploadDate,
            downloads: file.downloads,
            expiry: file.expiry
        }
    });
});

// ==================== GET STATS ====================
app.get('/api/stats', (req, res) => {
    console.log('📢 Stats endpoint dipanggil');
    
    const totalFiles = fileDatabase.length;
    const totalSize = fileDatabase.reduce((acc, file) => acc + file.size, 0);
    const totalDownloads = fileDatabase.reduce((acc, file) => acc + file.downloads, 0);

    // Hitung statistik per service
    const serviceStats = {};
    fileDatabase.forEach(file => {
        if (!serviceStats[file.service]) {
            serviceStats[file.service] = {
                count: 0,
                size: 0
            };
        }
        serviceStats[file.service].count++;
        serviceStats[file.service].size += file.size;
    });

    res.json({
        success: true,
        stats: {
            totalFiles,
            totalSize,
            totalDownloads,
            services: serviceStats
        }
    });
});

// ==================== TRACK DOWNLOAD ====================
app.post('/api/files/:id/download', (req, res) => {
    const file = fileDatabase.find(f => f.id === req.params.id);
    
    if (!file) {
        return res.status(404).json({
            success: false,
            error: 'File tidak ditemukan'
        });
    }

    file.downloads += 1;

    res.json({
        success: true,
        downloads: file.downloads
    });
});

// ==================== DELETE FILE ====================
app.delete('/api/files/:id', (req, res) => {
    const index = fileDatabase.findIndex(f => f.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({
            success: false,
            error: 'File tidak ditemukan'
        });
    }

    const deletedFile = fileDatabase[index];
    fileDatabase.splice(index, 1);

    res.json({
        success: true,
        message: 'File berhasil dihapus dari database',
        file: {
            id: deletedFile.id,
            name: deletedFile.originalName
        }
    });
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        files: fileDatabase.length,
        memory: process.memoryUsage(),
        services: Object.keys(STORAGE_SERVICES).filter(s => STORAGE_SERVICES[s].enabled)
    });
});

// ==================== TEST ENDPOINT ====================
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'API berjalan dengan baik',
        timestamp: new Date().toISOString(),
        services: Object.keys(STORAGE_SERVICES).filter(s => STORAGE_SERVICES[s].enabled)
    });
});

// ==================== CLEANUP EXPIRED FILES ====================
setInterval(() => {
    const now = new Date();
    const beforeCount = fileDatabase.length;
    
    fileDatabase = fileDatabase.filter(file => {
        if (file.expiry) {
            return new Date(file.expiry) > now;
        }
        return true; // File tanpa expiry tetap disimpan
    });
    
    const afterCount = fileDatabase.length;
    if (beforeCount !== afterCount) {
        console.log(`🧹 Cleanup: ${beforeCount - afterCount} file expired dihapus dari database`);
    }
}, 60000); // Cek setiap 1 menit

// ==================== ROUTES ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404 untuk API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint API tidak ditemukan'
    });
});

// Handle 404 untuk routes lain
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({
            success: false,
            error: 'Endpoint tidak ditemukan'
        });
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.stack);
    
    if (req.path.startsWith('/api/')) {
        res.status(500).json({
            success: false,
            error: 'Terjadi kesalahan pada server: ' + err.message
        });
    } else {
        res.status(500).send('Terjadi kesalahan pada server');
    }
});

// ==================== START SERVER ====================
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Server berjalan di http://localhost:${PORT}`);
        console.log(`📡 Mode: ${process.env.VERCEL ? 'Vercel' : 'Local'}`);
        console.log(`🔧 Service aktif: ${Object.keys(STORAGE_SERVICES).filter(s => STORAGE_SERVICES[s].enabled).join(', ')}`);
        console.log(`📝 Test API: http://localhost:${PORT}/api/test\n`);
    });
}

// Export untuk Vercel
module.exports = app;
