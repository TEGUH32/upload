// server.js - File Upload Service dengan Cloudinary
// AMAN: Semua credentials dari environment variables
// JANGAN commit file ini tanpa .env!

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== VALIDASI ENVIRONMENT VARIABLES ====================
const requiredEnvVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('\n❌ ERROR: Environment variables missing!');
  console.error('   Missing:', missingEnvVars.join(', '));
  console.error('   Please create .env file with:');
  console.error(`
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
PORT=3000
  `);
  console.error('\n   🔐 Jangan commit .env ke git!\n');
  
  if (process.env.NODE_ENV === 'production') {
    // Di production, exit dengan error
    process.exit(1);
  }
}

// ==================== CLOUDINARY CONFIGURATION ====================
// SEMUA CREDENTIALS DARI ENVIRONMENT VARIABLES
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Log konfigurasi (tanpa menampilkan secret)
console.log('\n☁️  Cloudinary Configuration:');
console.log(`   Cloud Name: ${cloudinary.config().cloud_name ? '✓ Set' : '✗ Missing'}`);
console.log(`   API Key: ${process.env.CLOUDINARY_API_KEY ? '✓ Set' : '✗ Missing'}`);
console.log(`   API Secret: ${process.env.CLOUDINARY_API_SECRET ? '✓ Set' : '✗ Missing'}`);

// ==================== TEST CLOUDINARY CONNECTION ====================
async function testCloudinaryConnection() {
  try {
    // Test sederhana dengan ping
    const result = await cloudinary.api.ping();
    console.log('✅ Cloudinary connection successful!');
    return true;
  } catch (error) {
    console.error('❌ Cloudinary connection failed:', error.message);
    return false;
  }
}

// Panggil test connection
testCloudinaryConnection();

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
// Buat folder di Cloudinary untuk menyimpan file
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Generate unique filename
    const originalName = file.originalname.split('.')[0];
    // Hapus karakter khusus dan spasi
    const safeName = originalName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const publicId = `${safeName}-${uniqueSuffix}`;
    
    // Dapatkan ekstensi file
    const extension = file.originalname.split('.').pop().toLowerCase();
    
    console.log('📝 Generating public_id:', publicId);
    
    return {
      folder: 'mycatbox',
      public_id: publicId,
      format: extension,
      resource_type: 'auto', // Auto-detect file type
      transformation: [{ quality: 'auto' }] // Optimasi otomatis
    };
  }
});

// Filter file (optional - bisa dihapus jika ingin semua format)
const fileFilter = (req, file, cb) => {
  // Izinkan semua jenis file
  cb(null, true);
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB
  }
});

// ==================== DATABASE SEDERHANA (IN-MEMORY) ====================
// Untuk production, ganti dengan database sungguhan seperti MongoDB
let fileDatabase = [];

// Fungsi generate ID unik untuk database lokal
function generateLocalId() {
  return crypto.randomBytes(8).toString('hex');
}

// ==================== CLEANUP FUNCTION ====================
// Hapus file dari Cloudinary jika ada error
async function cleanupCloudinaryFile(publicId) {
  try {
    if (publicId) {
      await cloudinary.uploader.destroy(publicId);
      console.log('🧹 Cleanup: File dihapus dari Cloudinary:', publicId);
    }
  } catch (error) {
    console.error('Error cleanup:', error);
  }
}

// ==================== API ENDPOINTS ====================

// [1] TEST ENDPOINT - Untuk cek koneksi
app.get('/api/test', async (req, res) => {
  try {
    const ping = await cloudinary.api.ping();
    res.json({
      success: true,
      message: '✅ Cloudinary connected successfully',
      cloud_name: cloudinary.config().cloud_name,
      timestamp: new Date().toISOString(),
      ping: ping
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '❌ Cloudinary connection failed',
      error: error.message,
      cloud_name: cloudinary.config().cloud_name
    });
  }
});

// [2] UPLOAD ENDPOINT - Upload file ke Cloudinary
app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('\n📢 UPLOAD ENDPOINT DIPANGGIL');
  
  try {
    // Cek apakah ada file
    if (!req.file) {
      console.log('❌ Tidak ada file');
      return res.status(400).json({
        success: false,
        error: 'Tidak ada file yang diupload'
      });
    }

    // Log detail file (tanpa informasi sensitif)
    console.log('✅ File received:');
    console.log('   Original Name:', req.file.originalname);
    console.log('   Size:', req.file.size, 'bytes');
    console.log('   Mimetype:', req.file.mimetype);
    console.log('   Cloudinary URL:', req.file.path);
    console.log('   Public ID:', req.file.filename);

    // Validasi ukuran file
    if (req.file.size > 100 * 1024 * 1024) {
      await cleanupCloudinaryFile(req.file.filename);
      return res.status(400).json({
        success: false,
        error: 'Ukuran file terlalu besar. Maksimal 100MB'
      });
    }

    // Generate ID lokal
    const localId = generateLocalId();

    // Simpan metadata ke database lokal
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

    // Kirim response sukses
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
    
    // Cleanup jika ada file yang terupload sebagian
    if (req.file && req.file.filename) {
      await cleanupCloudinaryFile(req.file.filename);
    }
    
    res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan saat upload: ' + error.message
    });
  }
});

// [3] GET ALL FILES - Mendapatkan daftar file dengan pagination
app.get('/api/files', (req, res) => {
  try {
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
    
    // Sort by upload date descending (terbaru dulu)
    filteredFiles.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

    // Format response
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

// [4] GET FILE INFO - Mendapatkan detail file berdasarkan ID
app.get('/api/files/:id', async (req, res) => {
  try {
    const file = fileDatabase.find(f => f.id === req.params.id);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File tidak ditemukan'
      });
    }

    // Coba ambil info tambahan dari Cloudinary
    try {
      const cloudinaryInfo = await cloudinary.api.resource(file.publicId, {
        colors: true,
        image_metadata: true,
        exif: true
      });

      res.json({
        success: true,
        file: {
          ...file,
          width: cloudinaryInfo.width,
          height: cloudinaryInfo.height,
          format: cloudinaryInfo.format,
          created_at: cloudinaryInfo.created_at,
          bytes: cloudinaryInfo.bytes,
          colors: cloudinaryInfo.colors
        }
      });
    } catch (cloudinaryError) {
      // Jika gagal ambil dari Cloudinary, return data lokal saja
      res.json({
        success: true,
        file: file
      });
    }

  } catch (error) {
    console.error('Error getting file info:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal mendapatkan info file'
    });
  }
});

// [5] GET STATS - Mendapatkan statistik
app.get('/api/stats', (req, res) => {
  try {
    const totalFiles = fileDatabase.length;
    const totalSize = fileDatabase.reduce((acc, file) => acc + file.size, 0);
    const totalDownloads = fileDatabase.reduce((acc, file) => acc + file.downloads, 0);

    // Statistik per format
    const formatStats = {};
    fileDatabase.forEach(file => {
      const format = file.format || 'unknown';
      if (!formatStats[format]) {
        formatStats[format] = {
          count: 0,
          size: 0
        };
      }
      formatStats[format].count++;
      formatStats[format].size += file.size;
    });

    res.json({
      success: true,
      stats: {
        totalFiles,
        totalSize,
        totalDownloads,
        formats: formatStats,
        cloudinary: {
          cloud_name: cloudinary.config().cloud_name,
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

// [6] TRACK DOWNLOAD - Increment download counter
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

// [7] DELETE FILE - Hapus file dari database dan Cloudinary
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
      const result = await cloudinary.uploader.destroy(file.publicId);
      console.log('🗑️  Cloudinary delete result:', result);
    } catch (cloudinaryError) {
      console.error('Error deleting from Cloudinary:', cloudinaryError);
      // Tetap lanjutkan untuk hapus dari database
    }

    // Hapus dari database
    fileDatabase.splice(fileIndex, 1);
    console.log(`📊 File deleted. Total files: ${fileDatabase.length}`);

    res.json({
      success: true,
      message: 'File berhasil dihapus',
      file: {
        id: file.id,
        name: file.originalName
      }
    });

  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal menghapus file'
    });
  }
});

// [8] CLOUDINARY USAGE - Mendapatkan info usage Cloudinary
app.get('/api/cloudinary/usage', async (req, res) => {
  try {
    const usage = await cloudinary.api.usage();
    res.json({
      success: true,
      usage: {
        plan: usage.plan,
        credits_usage: usage.credits?.usage || 0,
        credits_limit: usage.credits?.limit || 'Unlimited',
        storage_usage: usage.storage?.usage || 0,
        storage_limit: usage.storage?.limit || 0,
        bandwidth_usage: usage.bandwidth?.usage || 0,
        bandwidth_limit: usage.bandwidth?.limit || 0,
        requests: usage.requests || 0
      }
    });
  } catch (error) {
    console.error('Error getting Cloudinary usage:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal mendapatkan info usage'
    });
  }
});

// [9] TRANSFORM IMAGE - Generate URL dengan transformasi
app.get('/api/transform/:publicId', (req, res) => {
  try {
    const { publicId } = req.params;
    const { width, height, crop, gravity, effect, quality } = req.query;

    // Buat transformasi
    let transformation = [];
    
    if (width) transformation.push({ width: parseInt(width) });
    if (height) transformation.push({ height: parseInt(height) });
    if (crop) transformation.push({ crop });
    if (gravity) transformation.push({ gravity });
    if (effect) transformation.push({ effect });
    if (quality) transformation.push({ quality: quality === 'auto' ? 'auto' : parseInt(quality) });

    // Generate URL
    const imageUrl = cloudinary.url(publicId, {
      transformation: transformation,
      secure: true,
      fetch_format: 'auto',
      quality: 'auto'
    });

    res.json({
      success: true,
      url: imageUrl,
      publicId: publicId,
      transformations: transformation
    });

  } catch (error) {
    console.error('Error transforming image:', error);
    res.status(500).json({
      success: false,
      error: 'Gagal transformasi gambar'
    });
  }
});

// [10] HEALTH CHECK - Cek status server
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    files_in_db: fileDatabase.length,
    cloudinary: {
      configured: true,
      cloud_name: cloudinary.config().cloud_name
    },
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
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
  
  // Multer error handling
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
  
  // Cloudinary error handling
  if (err.name === 'CloudinaryError') {
    return res.status(500).json({
      success: false,
      error: 'Cloudinary error: ' + err.message
    });
  }
  
  // Default error
  res.status(500).json({
    success: false,
    error: 'Terjadi kesalahan pada server: ' + err.message
  });
});

// ==================== START SERVER ====================
app.listen(PORT, async () => {
  console.log('\n' + '='.repeat(50));
  console.log(`🚀 SERVER STARTED`);
  console.log('='.repeat(50));
  console.log(`📍 Port: http://localhost:${PORT}`);
  console.log(`☁️  Cloud Name: ${cloudinary.config().cloud_name ? '✓ Set' : '✗ Missing'}`);
  console.log(`📁 Upload folder: mycatbox`);
  console.log(`📊 Max file size: 100MB`);
  console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(50));
  console.log(`📝 Test API: http://localhost:${PORT}/api/test`);
  console.log(`📝 Health Check: http://localhost:${PORT}/api/health`);
  console.log('='.repeat(50) + '\n');
  
  // Test Cloudinary connection on startup
  const isConnected = await testCloudinaryConnection();
  if (!isConnected) {
    console.log('\n⚠️  PERINGATAN: Cloudinary tidak terhubung!');
    console.log('   Pastikan file .env sudah benar:');
    console.log('   CLOUDINARY_CLOUD_NAME=deswvfe4w');
    console.log('   CLOUDINARY_API_KEY=your_api_key');
    console.log('   CLOUDINARY_API_SECRET=your_api_secret\n');
  }
});

// Export untuk Vercel
module.exports = app;
