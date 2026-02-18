// server.js - File Upload Service dengan Cloudinary
// VERSI UNTUK VERCELL - Tidak menggunakan dotenv

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CLOUDINARY CONFIGURATION ====================
// Di Vercel, environment variables harus di-set di dashboard Vercel
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

console.log('\n☁️  Cloudinary Configuration:');
console.log(`   Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME ? '✓ Set' : '✗ Missing'}`);
console.log(`   API Key: ${process.env.CLOUDINARY_API_KEY ? '✓ Set' : '✗ Missing'}`);
console.log(`   API Secret: ${process.env.CLOUDINARY_API_SECRET ? '✓ Set' : '✗ Missing'}`);

// ==================== CEK ENVIRONMENT VARIABLES ====================
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('\n❌ ERROR: Cloudinary environment variables missing!');
  console.error('   Set these in Vercel Dashboard:');
  console.error('   - CLOUDINARY_CLOUD_NAME');
  console.error('   - CLOUDINARY_API_KEY');
  console.error('   - CLOUDINARY_API_SECRET\n');
}

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== MULTER STORAGE UNTUK CLOUDINARY ====================
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const originalName = file.originalname.split('.')[0];
    const safeName = originalName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const publicId = `${safeName}-${uniqueSuffix}`;
    const extension = file.originalname.split('.').pop().toLowerCase();
    
    return {
      folder: 'mycatbox',
      public_id: publicId,
      format: extension,
      resource_type: 'auto',
      transformation: [{ quality: 'auto' }]
    };
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// ==================== DATABASE SEDERHANA (IN-MEMORY) ====================
// PERHATIAN: Di Vercel, ini akan reset setiap kali function restart!
// Untuk production, gunakan database permanen seperti MongoDB
let fileDatabase = [];

function generateLocalId() {
  return crypto.randomBytes(8).toString('hex');
}

// ==================== API ENDPOINTS ====================

// [1] TEST ENDPOINT
app.get('/api/test', async (req, res) => {
  try {
    // Cek environment variables dulu
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({
        success: false,
        message: '❌ Cloudinary configuration missing',
        required: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
        note: 'Set these in Vercel Dashboard'
      });
    }

    const ping = await cloudinary.api.ping();
    res.json({
      success: true,
      message: '✅ Cloudinary connected successfully',
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '❌ Cloudinary connection failed',
      error: error.message,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME
    });
  }
});

// [2] UPLOAD ENDPOINT
app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('\n📢 UPLOAD ENDPOINT DIPANGGIL');
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Tidak ada file yang diupload'
      });
    }

    const localId = generateLocalId();

    const fileData = {
      id: localId,
      originalName: req.file.originalname,
      url: req.file.path,
      publicId: req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype,
      format: req.file.originalname.split('.').pop().toLowerCase(),
      service: 'cloudinary',
      uploadDate: new Date().toISOString(),
      downloads: 0
    };

    fileDatabase.push(fileData);
    console.log(`📊 Total files in database: ${fileDatabase.length}`);

    res.json({
      success: true,
      url: req.file.path,
      directUrl: req.file.path,
      fileId: localId,
      publicId: req.file.filename,
      service: 'cloudinary',
      fileName: req.file.originalname,
      fileSize: req.file.size,
      format: fileData.format,
      message: '✅ File berhasil diupload ke Cloudinary'
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan saat upload: ' + error.message
    });
  }
});

// [3] GET ALL FILES
app.get('/api/files', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    
    let filteredFiles = fileDatabase;
    
    if (search && search.length >= 3) {
      filteredFiles = fileDatabase.filter(file => 
        file.originalName.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    filteredFiles.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

    const files = paginatedFiles.map(file => ({
      id: file.id,
      name: file.originalName,
      url: file.url,
      publicId: file.publicId,
      size: file.size,
      format: file.format || 'unknown',
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

  } catch (error) {
    console.error('Error getting files:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal mengambil daftar file'
    });
  }
});

// [4] GET FILE INFO
app.get('/api/files/:id', async (req, res) => {
  try {
    const file = fileDatabase.find(f => f.id === req.params.id);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File tidak ditemukan'
      });
    }

    res.json({
      success: true,
      file: file
    });

  } catch (error) {
    console.error('Error getting file info:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal mendapatkan info file'
    });
  }
});

// [5] GET STATS
app.get('/api/stats', (req, res) => {
  try {
    const totalFiles = fileDatabase.length;
    const totalSize = fileDatabase.reduce((acc, file) => acc + file.size, 0);
    const totalDownloads = fileDatabase.reduce((acc, file) => acc + file.downloads, 0);

    res.json({
      success: true,
      stats: {
        totalFiles,
        totalSize,
        totalDownloads,
        cloudinary: {
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          files_in_db: totalFiles
        }
      }
    });

  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal mendapatkan statistik'
    });
  }
});

// [6] TRACK DOWNLOAD
app.post('/api/files/:id/download', (req, res) => {
  try {
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

  } catch (error) {
    console.error('Error tracking download:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal mencatat download'
    });
  }
});

// [7] DELETE FILE
app.delete('/api/files/:id', async (req, res) => {
  try {
    const fileIndex = fileDatabase.findIndex(f => f.id === req.params.id);
    
    if (fileIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'File tidak ditemukan'
      });
    }

    const file = fileDatabase[fileIndex];

    // Hapus dari Cloudinary
    try {
      await cloudinary.uploader.destroy(file.publicId);
    } catch (cloudinaryError) {
      console.error('Error deleting from Cloudinary:', cloudinaryError);
    }

    fileDatabase.splice(fileIndex, 1);

    res.json({
      success: true,
      message: 'File berhasil dihapus'
    });

  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal menghapus file'
    });
  }
});

// [8] HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    files_in_db: fileDatabase.length,
    cloudinary: {
      configured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'not set'
    },
    environment: process.env.NODE_ENV || 'production'
  });
});

// ==================== ROOT ENDPOINT ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== 404 HANDLER ====================
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({
      success: false,
      error: 'Endpoint API tidak ditemukan'
    });
  } else {
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  console.error('❌ Global error:', err.stack);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File terlalu besar. Maksimal 100MB'
      });
    }
    return res.status(400).json({
      success: false,
      error: 'Upload error: ' + err.message
    });
  }
  
  res.status(500).json({
    success: false,
    error: 'Terjadi kesalahan pada server: ' + err.message
  });
});

// ==================== EXPORT UNTUK VERCELL ====================
module.exports = app;
