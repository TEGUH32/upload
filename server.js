// server.js - File Upload Service dengan Cloudinary
require('dotenv').config();

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
// Gunakan cloud name yang benar: deswvfe4w
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'deswvfe4w',
  api_key: process.env.CLOUDINARY_API_KEY || '649231255323586',
  api_secret: process.env.CLOUDINARY_API_SECRET || '-gh_1AgpnF_jL7ldBRhanMrgxAM',
  secure: true
});

console.log('✅ Cloudinary configured dengan:');
console.log('   Cloud Name:', cloudinary.config().cloud_name);
console.log('   API Key:', cloudinary.config().api_key ? '✓ Set' : '✗ Missing');
console.log('   API Secret:', cloudinary.config().api_secret ? '✓ Set' : '✗ Missing');

// Test koneksi Cloudinary
async function testCloudinaryConnection() {
  try {
    // Coba panggil API sederhana untuk test koneksi
    const result = await cloudinary.api.ping();
    console.log('✅ Koneksi Cloudinary berhasil!');
    return true;
  } catch (error) {
    console.error('❌ Koneksi Cloudinary gagal:', error.message);
    return false;
  }
}

// Panggil test koneksi
testCloudinaryConnection();

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== MULTER STORAGE UNTUK CLOUDINARY ====================
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'mycatbox', // Folder di Cloudinary
    resource_type: 'auto', // Auto-detect file type
    public_id: (req, file) => {
      // Generate unique filename tanpa karakter khusus
      const originalName = file.originalname.split('.')[0];
      const safeName = originalName.replace(/[^a-zA-Z0-9]/g, '-');
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      return `${safeName}-${uniqueSuffix}`;
    },
    format: (req, file) => {
      // Ambil ekstensi file asli
      const ext = file.originalname.split('.').pop();
      return ext;
    }
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB
  }
});

// ==================== DATABASE SEDERHANA ====================
let fileDatabase = [];

// Fungsi generate ID lokal
function generateLocalId() {
  return crypto.randomBytes(8).toString('hex');
}

// ==================== TEST ENDPOINT ====================
app.get('/api/test', async (req, res) => {
  try {
    const ping = await cloudinary.api.ping();
    res.json({
      success: true,
      message: '✅ Cloudinary connected successfully',
      cloud_name: cloudinary.config().cloud_name,
      ping: ping,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      success: false,
      message: '❌ Cloudinary connection failed',
      error: error.message,
      cloud_name: cloudinary.config().cloud_name,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== UPLOAD ENDPOINT ====================
app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('📢 Upload endpoint dipanggil');
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Tidak ada file yang diupload'
      });
    }

    console.log('✅ File uploaded ke Cloudinary:');
    console.log('   URL:', req.file.path);
    console.log('   Public ID:', req.file.filename);
    console.log('   Size:', req.file.size, 'bytes');

    // Generate ID lokal
    const localId = generateLocalId();

    // Simpan ke database lokal
    const fileData = {
      id: localId,
      originalName: req.file.originalname,
      url: req.file.path,
      publicId: req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype,
      service: 'cloudinary',
      uploadDate: new Date().toISOString(),
      downloads: 0
    };

    fileDatabase.push(fileData);
    console.log(`✅ Total file di database: ${fileDatabase.length}`);

    // Kirim response
    res.json({
      success: true,
      url: req.file.path,
      directUrl: req.file.path,
      fileId: localId,
      publicId: req.file.filename,
      service: 'cloudinary',
      fileName: req.file.originalname,
      fileSize: req.file.size,
      message: 'File berhasil diupload ke Cloudinary'
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan pada server: ' + error.message
    });
  }
});

// ==================== GET ALL FILES ====================
app.get('/api/files', (req, res) => {
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

// ==================== GET FILE INFO ====================
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
    file: file
  });
});

// ==================== GET STATS ====================
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
      cloudinary: {
        cloud_name: cloudinary.config().cloud_name,
        files: totalFiles
      }
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
  res.json({ success: true, downloads: file.downloads });
});

// ==================== DELETE FILE ====================
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
      console.log(`✅ File ${file.publicId} dihapus dari Cloudinary`);
    } catch (cloudinaryError) {
      console.error('Error deleting from Cloudinary:', cloudinaryError);
    }

    // Hapus dari database
    fileDatabase.splice(fileIndex, 1);

    res.json({
      success: true,
      message: 'File berhasil dihapus'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error menghapus file'
    });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    files: fileDatabase.length,
    cloudinary: {
      configured: true,
      cloud_name: cloudinary.config().cloud_name
    }
  });
});

// ==================== ROUTES ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({
      success: false,
      error: 'Endpoint API tidak ditemukan'
    });
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  res.status(500).json({
    success: false,
    error: 'Terjadi kesalahan pada server: ' + err.message
  });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`\n🚀 Server berjalan di http://localhost:${PORT}`);
  console.log(`📡 Mode: ${process.env.VERCEL ? 'Vercel' : 'Local'}`);
  console.log(`☁️  Cloud Name: deswvfe4w`);
  console.log(`📝 Test API: http://localhost:${PORT}/api/test\n`);
});
