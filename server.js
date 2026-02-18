// server.js - File Upload Service Mirip Catbox
// Support untuk Vercel (menggunakan API eksternal untuk penyimpanan)

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Konfigurasi multer untuk upload sementara
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // Limit 100MB
    }
});

// API Keys untuk berbagai service penyimpanan
// Ganti dengan API key masing-masing service
const STORAGE_SERVICES = {
    // Gunakan service gratis seperti file.io, atau bisa pakai YourUpload, etc
    FILE_IO: {
        enabled: true,
        uploadUrl: 'https://file.io',
        maxSize: 100 * 1024 * 1024 // 100MB
    },
    // Alternatif: Gunakan GoFile (gratis, no API key)
    GOFILE: {
        enabled: true,
        serverUrl: 'https://api.gofile.io/getServer',
        uploadUrl: 'https://{server}.gofile.io/uploadFile'
    },
    // Alternatif: Use your own storage service
    CUSTOM_API: {
        enabled: false,
        uploadUrl: 'https://your-api.com/upload',
        apiKey: 'your-api-key'
    }
};

// Database sederhana untuk menyimpan metadata file (gunakan memory storage untuk Vercel)
// Untuk production, gunakan database seperti MongoDB, PostgreSQL, dll
let fileDatabase = [];

// Fungsi untuk generate ID unik
function generateUniqueId() {
    return crypto.randomBytes(8).toString('hex');
}

// Fungsi untuk mendapatkan server GoFile yang tersedia
async function getGoFileServer() {
    try {
        const response = await axios.get('https://api.gofile.io/getServer');
        return response.data.data.server;
    } catch (error) {
        console.error('Error getting GoFile server:', error);
        return null;
    }
}

// Fungsi untuk upload ke file.io
async function uploadToFileIO(fileBuffer, fileName, mimeType) {
    try {
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: fileName,
            contentType: mimeType
        });

        const response = await axios.post('https://file.io', formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        return {
            success: true,
            url: response.data.link,
            expiry: response.data.expires,
            service: 'file.io'
        };
    } catch (error) {
        console.error('Error uploading to file.io:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Fungsi untuk upload ke GoFile
async function uploadToGoFile(fileBuffer, fileName, mimeType) {
    try {
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
            return {
                success: true,
                url: `https://${server}.gofile.io/download/${response.data.data.fileId}/${fileName}`,
                fileId: response.data.data.fileId,
                service: 'gofile'
            };
        } else {
            throw new Error(response.data.message || 'Upload gagal');
        }
    } catch (error) {
        console.error('Error uploading to GoFile:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Endpoint untuk upload file
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
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

        // Validasi ukuran file
        if (fileSize > STORAGE_SERVICES.FILE_IO.maxSize) {
            return res.status(400).json({
                success: false,
                error: 'Ukuran file terlalu besar. Maksimal 100MB'
            });
        }

        let uploadResult;
        
        // Coba upload ke file.io terlebih dahulu
        if (STORAGE_SERVICES.FILE_IO.enabled) {
            uploadResult = await uploadToFileIO(fileBuffer, fileName, mimeType);
        }

        // Jika file.io gagal, coba GoFile
        if (!uploadResult || !uploadResult.success) {
            if (STORAGE_SERVICES.GOFILE.enabled) {
                uploadResult = await uploadToGoFile(fileBuffer, fileName, mimeType);
            }
        }

        // Jika semua service gagal
        if (!uploadResult || !uploadResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Semua service penyimpanan sedang sibuk. Silakan coba lagi nanti.'
            });
        }

        // Simpan metadata file ke database
        const fileId = generateUniqueId();
        const fileData = {
            id: fileId,
            originalName: fileName,
            url: uploadResult.url,
            size: fileSize,
            mimeType: mimeType,
            service: uploadResult.service,
            uploadDate: new Date().toISOString(),
            downloads: 0
        };

        fileDatabase.push(fileData);

        // Bersihkan database lama (opsional)
        if (fileDatabase.length > 1000) {
            fileDatabase = fileDatabase.slice(-1000);
        }

        res.json({
            success: true,
            url: uploadResult.url,
            fileId: fileId,
            service: uploadResult.service,
            message: 'File berhasil diupload'
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Terjadi kesalahan saat upload file'
        });
    }
});

// Endpoint untuk mendapatkan daftar file (dengan pagination)
app.get('/api/files', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const files = fileDatabase.slice(startIndex, endIndex).map(file => ({
        id: file.id,
        name: file.originalName,
        url: file.url,
        size: file.size,
        uploadDate: file.uploadDate,
        downloads: file.downloads
    }));

    res.json({
        success: true,
        files: files,
        total: fileDatabase.length,
        page: page,
        totalPages: Math.ceil(fileDatabase.length / limit)
    });
});

// Endpoint untuk mendapatkan informasi file
app.get('/api/files/:id', (req, res) => {
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
            size: file.size,
            mimeType: file.mimeType,
            service: file.service,
            uploadDate: file.uploadDate,
            downloads: file.downloads
        }
    });
});

// Endpoint untuk statistik
app.get('/api/stats', (req, res) => {
    const totalFiles = fileDatabase.length;
    const totalSize = fileDatabase.reduce((acc, file) => acc + file.size, 0);
    const totalDownloads = fileDatabase.reduce((acc, file) => acc + file.downloads, 0);

    res.json({
        success: true,
        stats: {
            totalFiles,
            totalSize,
            totalDownloads,
            services: {
                fileio: fileDatabase.filter(f => f.service === 'file.io').length,
                gofile: fileDatabase.filter(f => f.service === 'gofile').length
            }
        }
    });
});

// Endpoint untuk menghapus file dari database (hanya metadata)
app.delete('/api/files/:id', (req, res) => {
    const index = fileDatabase.findIndex(f => f.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({
            success: false,
            error: 'File tidak ditemukan'
        });
    }

    fileDatabase.splice(index, 1);

    res.json({
        success: true,
        message: 'File berhasil dihapus dari database'
    });
});

// Endpoint untuk update download count
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

// Route untuk halaman utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint tidak ditemukan'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: 'Terjadi kesalahan pada server'
    });
});

// Start server jika tidak di Vercel
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server berjalan di http://localhost:${PORT}`);
        console.log(`Mode: ${process.env.VERCEL ? 'Vercel' : 'Local'}`);
    });
}

// Export untuk Vercel
module.exports = app;
