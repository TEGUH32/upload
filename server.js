// server.js - File Upload Service Mirip Catbox
// Support untuk Vercel (menggunakan API eksternal untuk penyimpanan)

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
const STORAGE_SERVICES = {
    FILE_IO: {
        enabled: true,
        uploadUrl: 'https://file.io',
        maxSize: 100 * 1024 * 1024 // 100MB
    },
    GOFILE: {
        enabled: true,
        serverUrl: 'https://api.gofile.io/getServer',
        uploadUrl: 'https://{server}.gofile.io/uploadFile'
    },
    TEMP_SH: {
        enabled: true,
        uploadUrl: 'https://temp.sh/upload',
        maxSize: 500 * 1024 * 1024 // 500MB
    }
};

// Database sederhana untuk menyimpan metadata file
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

        // Generate ID lokal untuk file
        const fileId = generateUniqueId();

        return {
            success: true,
            url: response.data.link,
            fileId: fileId,
            expiry: response.data.expires,
            service: 'file.io',
            directUrl: response.data.link
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
            // Generate ID lokal untuk file
            const fileId = generateUniqueId();
            
            return {
                success: true,
                url: `https://${server}.gofile.io/download/${response.data.data.fileId}/${fileName}`,
                fileId: fileId,
                service: 'gofile',
                directUrl: `https://${server}.gofile.io/download/${response.data.data.fileId}/${fileName}`
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

// Fungsi untuk upload ke temp.sh
async function uploadToTempSH(fileBuffer, fileName, mimeType) {
    try {
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: fileName,
            contentType: mimeType
        });

        const response = await axios.post('https://temp.sh/upload', formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        // Parse response dari temp.sh
        // Biasanya mereka mengembalikan URL dalam format text
        let fileUrl = response.data.trim();
        
        // Generate ID lokal untuk file
        const fileId = generateUniqueId();

        return {
            success: true,
            url: fileUrl,
            fileId: fileId,
            service: 'temp.sh',
            directUrl: fileUrl
        };
    } catch (error) {
        console.error('Error uploading to temp.sh:', error);
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

        let uploadResult = null;
        let errors = [];

        // Coba upload ke file.io terlebih dahulu
        if (STORAGE_SERVICES.FILE_IO.enabled) {
            uploadResult = await uploadToFileIO(fileBuffer, fileName, mimeType);
            if (uploadResult.success) {
                console.log('Upload berhasil ke file.io');
            } else {
                errors.push(`file.io: ${uploadResult.error}`);
            }
        }

        // Jika file.io gagal, coba GoFile
        if (!uploadResult || !uploadResult.success) {
            if (STORAGE_SERVICES.GOFILE.enabled) {
                uploadResult = await uploadToGoFile(fileBuffer, fileName, mimeType);
                if (uploadResult.success) {
                    console.log('Upload berhasil ke GoFile');
                } else {
                    errors.push(`GoFile: ${uploadResult.error}`);
                }
            }
        }

        // Jika GoFile gagal, coba temp.sh
        if (!uploadResult || !uploadResult.success) {
            if (STORAGE_SERVICES.TEMP_SH.enabled) {
                uploadResult = await uploadToTempSH(fileBuffer, fileName, mimeType);
                if (uploadResult.success) {
                    console.log('Upload berhasil ke temp.sh');
                } else {
                    errors.push(`temp.sh: ${uploadResult.error}`);
                }
            }
        }

        // Jika semua service gagal
        if (!uploadResult || !uploadResult.success) {
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

        // Bersihkan database lama (opsional)
        if (fileDatabase.length > 1000) {
            fileDatabase = fileDatabase.slice(-1000);
        }

        // Kirim response dengan format yang konsisten
        res.json({
            success: true,
            url: uploadResult.url,
            directUrl: uploadResult.directUrl || uploadResult.url,
            fileId: uploadResult.fileId,
            service: uploadResult.service,
            fileName: fileName,
            fileSize: fileSize,
            message: `File berhasil diupload menggunakan ${uploadResult.service}`
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Terjadi kesalahan saat upload file: ' + error.message
        });
    }
});

// Endpoint untuk mendapatkan daftar file (dengan pagination)
app.get('/api/files', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    
    let filteredFiles = fileDatabase;
    
    // Filter berdasarkan pencarian
    if (search) {
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
        downloads: file.downloads
    }));

    res.json({
        success: true,
        files: files,
        total: filteredFiles.length,
        page: page,
        totalPages: Math.ceil(filteredFiles.length / limit),
        limit: limit
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

// Endpoint untuk statistik
app.get('/api/stats', (req, res) => {
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

// Endpoint untuk menghapus file dari database (hanya metadata)
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

// Endpoint untuk health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        files: fileDatabase.length,
        memory: process.memoryUsage()
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
