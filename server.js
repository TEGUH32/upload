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
        uploadUrl: 'https://tmp.ninja/api.php?d=upload',
        maxSize: 500 * 1024 * 1024 // 500MB
    },
    ANONFILES: {
        enabled: true,
        uploadUrl: 'https://api.anonfiles.com/upload',
        maxSize: 100 * 1024 * 1024 // 100MB
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

// Fungsi untuk upload ke temp.sh (tmp.ninja)
async function uploadToTempSH(fileBuffer, fileName, mimeType) {
    try {
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

        return {
            success: true,
            url: fileUrl,
            fileId: fileId,
            service: 'tmp.ninja',
            directUrl: fileUrl
        };
    } catch (error) {
        console.error('Error uploading to tmp.ninja:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Fungsi untuk upload ke AnonFiles
async function uploadToAnonFiles(fileBuffer, fileName, mimeType) {
    try {
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: fileName,
            contentType: mimeType
        });

        const response = await axios.post('https://api.anonfiles.com/upload', formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        if (response.data.status) {
            // Generate ID lokal untuk file
            const fileId = generateUniqueId();
            
            return {
                success: true,
                url: response.data.data.file.url.full,
                fileId: fileId,
                service: 'anonfiles',
                directUrl: response.data.data.file.url.full
            };
        } else {
            throw new Error(response.data.error.message || 'Upload gagal');
        }
    } catch (error) {
        console.error('Error uploading to AnonFiles:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// API Routes - Harus di atas route static
// Endpoint untuk upload file
app.post('/api/upload', upload.single('file'), async (req, res) => {
    console.log('Upload endpoint dipanggil');
    
    try {
        if (!req.file) {
            console.log('Tidak ada file');
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

        console.log(`Menerima file: ${fileName}, size: ${fileSize} bytes`);

        // Validasi ukuran file
        if (fileSize > 100 * 1024 * 1024) {
            return res.status(400).json({
                success: false,
                error: 'Ukuran file terlalu besar. Maksimal 100MB'
            });
        }

        let uploadResult = null;
        let errors = [];

        // Coba upload ke file.io terlebih dahulu
        if (STORAGE_SERVICES.FILE_IO.enabled) {
            console.log('Mencoba upload ke file.io...');
            uploadResult = await uploadToFileIO(fileBuffer, fileName, mimeType);
            if (uploadResult.success) {
                console.log('Upload berhasil ke file.io');
            } else {
                errors.push(`file.io: ${uploadResult.error}`);
                console.log('file.io gagal:', uploadResult.error);
            }
        }

        // Jika file.io gagal, coba GoFile
        if (!uploadResult || !uploadResult.success) {
            if (STORAGE_SERVICES.GOFILE.enabled) {
                console.log('Mencoba upload ke GoFile...');
                uploadResult = await uploadToGoFile(fileBuffer, fileName, mimeType);
                if (uploadResult.success) {
                    console.log('Upload berhasil ke GoFile');
                } else {
                    errors.push(`GoFile: ${uploadResult.error}`);
                    console.log('GoFile gagal:', uploadResult.error);
                }
            }
        }

        // Jika GoFile gagal, coba tmp.ninja
        if (!uploadResult || !uploadResult.success) {
            if (STORAGE_SERVICES.TEMP_SH.enabled) {
                console.log('Mencoba upload ke tmp.ninja...');
                uploadResult = await uploadToTempSH(fileBuffer, fileName, mimeType);
                if (uploadResult.success) {
                    console.log('Upload berhasil ke tmp.ninja');
                } else {
                    errors.push(`tmp.ninja: ${uploadResult.error}`);
                    console.log('tmp.ninja gagal:', uploadResult.error);
                }
            }
        }

        // Jika tmp.ninja gagal, coba AnonFiles
        if (!uploadResult || !uploadResult.success) {
            if (STORAGE_SERVICES.ANONFILES.enabled) {
                console.log('Mencoba upload ke AnonFiles...');
                uploadResult = await uploadToAnonFiles(fileBuffer, fileName, mimeType);
                if (uploadResult.success) {
                    console.log('Upload berhasil ke AnonFiles');
                } else {
                    errors.push(`AnonFiles: ${uploadResult.error}`);
                    console.log('AnonFiles gagal:', uploadResult.error);
                }
            }
        }

        // Jika semua service gagal
        if (!uploadResult || !uploadResult.success) {
            console.log('Semua service gagal:', errors);
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
        console.log(`File tersimpan di database. Total: ${fileDatabase.length}`);

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
    console.log('Files endpoint dipanggil');
    
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
        downloads: file.downloads
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

// Endpoint untuk mendapatkan informasi file
app.get('/api/files/:id', (req, res) => {
    console.log('File info endpoint dipanggil untuk ID:', req.params.id);
    
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
    console.log('Stats endpoint dipanggil');
    
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

// Test endpoint untuk memastikan API bekerja
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'API berjalan dengan baik',
        timestamp: new Date().toISOString()
    });
});

// Route untuk halaman utama - HARUS DIBAWAH API ROUTES
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

// Handle 404 untuk routes lain (redirect ke index.html untuk SPA)
app.use((req, res) => {
    // Jika request ke API, return JSON
    if (req.path.startsWith('/api/')) {
        res.status(404).json({
            success: false,
            error: 'Endpoint tidak ditemukan'
        });
    } else {
        // Jika request ke halaman, return index.html
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    
    if (req.path.startsWith('/api/')) {
        res.status(500).json({
            success: false,
            error: 'Terjadi kesalahan pada server: ' + err.message
        });
    } else {
        res.status(500).send('Terjadi kesalahan pada server');
    }
});

// Start server jika tidak di Vercel
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server berjalan di http://localhost:${PORT}`);
        console.log(`Mode: ${process.env.VERCEL ? 'Vercel' : 'Local'}`);
        console.log(`API tersedia di http://localhost:${PORT}/api/test`);
    });
}

// Export untuk Vercel
module.exports = app;
