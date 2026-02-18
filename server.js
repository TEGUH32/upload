// server.js - File Upload Service dengan Cloudinary
// Menggunakan Cloudinary untuk penyimpanan file

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
cloudinary.config({
  cloud_name: 'deswvfe4w', // Biasanya format: dwbi7zfjl atau sesuai akun
  api_key: '951531676243719',
  api_secret: '951531676243719',
  secure: true
});

console.log('✅ Cloudinary configured');

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== MULTER STORAGE FOR CLOUDINARY ====================
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'mycatbox', // Folder di Cloudinary
    resource_type: 'auto', // Auto-detect file type (image, video, raw, etc)
    public_id: (req, file) => {
      // Generate unique filename
      const uniqueSuffix = crypto.randomBytes(8).toString('hex');
      const fileName = file.originalname.split('.')[0];
      return `${fileName}-${uniqueSuffix}`;
    },
    format: (req, file) => {
      // Get file extension
      const ext = file.originalname.split('.').pop();
      return ext;
    }
  }
});

// Filter file (opsional)
const fileFilter = (req, file, cb) => {
  // Boleh upload semua jenis file
  cb(null, true);
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
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

    // File sudah otomatis terupload ke Cloudinary oleh multer-storage-cloudinary
    const file = req.file;
    
    console.log('✅ File uploaded to Cloudinary:', file.path);
    console.log('File details:', {
      originalname: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      cloudinary_url: file.path,
      public_id: file.filename
    });

    // Generate ID lokal untuk database kita
    const localId = generateLocalId();

    // Simpan metadata ke database lokal
    const fileData = {
      id: localId,
      originalName: file.originalname,
      url: file.path, // URL dari Cloudinary
      directUrl: file.path,
      publicId: file.filename, // Public ID di Cloudinary
      size: file.size,
      mimeType: file.mimetype,
      service: 'cloudinary',
      uploadDate: new Date().toISOString(),
      downloads: 0,
      format: file.format || 'unknown'
    };

    fileDatabase.push(fileData);
    console.log(`✅ File tersimpan di database. Total: ${fileDatabase.length}`);

    // Kirim response
    res.json({
      success: true,
      url: file.path,
      directUrl: file.path,
      fileId: localId,
      publicId: file.filename,
      service: 'cloudinary',
      fileName: file.originalname,
      fileSize: file.size,
      format: file.format,
      message: 'File berhasil diupload ke Cloudinary'
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan saat upload: ' + error.message
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
  
  // Sort by upload date descending
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
    downloads: file.downloads,
    format: file.format
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
app.get('/api/files/:id', async (req, res) => {
  try {
    // Cari di database lokal dulu
    const localFile = fileDatabase.find(f => f.id === req.params.id);
    
    if (!localFile) {
      return res.status(404).json({
        success: false,
        error: 'File tidak ditemukan'
      });
    }

    // Ambil info tambahan dari Cloudinary
    try {
      const cloudinaryInfo = await cloudinary.api.resource(localFile.publicId, {
        colors: true,
        image_metadata: true,
        exif: true
      });

      res.json({
        success: true,
        file: {
          id: localFile.id,
          name: localFile.originalName,
          url: localFile.url,
          publicId: localFile.publicId,
          size: localFile.size,
          format: cloudinaryInfo.format,
          width: cloudinaryInfo.width,
          height: cloudinaryInfo.height,
          bytes: cloudinaryInfo.bytes,
          created_at: cloudinaryInfo.created_at,
          service: 'cloudinary',
          uploadDate: localFile.uploadDate,
          downloads: localFile.downloads,
          colors: cloudinaryInfo.colors,
          tags: cloudinaryInfo.tags
        }
      });
    } catch (cloudinaryError) {
      // Jika gagal ambil dari Cloudinary, return data lokal saja
      res.json({
        success: true,
        file: localFile
      });
    }
  } catch (error) {
    console.error('Error getting file info:', error);
    res.status(500).json({
      success: false,
      error: 'Error mendapatkan info file'
    });
  }
});

// ==================== GET STATS ====================
app.get('/api/stats', (req, res) => {
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
        used: totalFiles
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

    // Hapus dari database lokal
    fileDatabase.splice(fileIndex, 1);

    res.json({
      success: true,
      message: 'File berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      error: 'Error menghapus file'
    });
  }
});

// ==================== GET CLOUDINARY USAGE ====================
app.get('/api/cloudinary/usage', async (req, res) => {
  try {
    const usage = await cloudinary.api.usage();
    res.json({
      success: true,
      usage: {
        plan: usage.plan,
        credits: usage.credits,
        usage: usage.usage,
        limit: usage.limit
      }
    });
  } catch (error) {
    console.error('Error getting Cloudinary usage:', error);
    res.status(500).json({
      success: false,
      error: 'Error mendapatkan info usage'
    });
  }
});

// ==================== TRANSFORM IMAGE ====================
app.get('/api/transform/:publicId', (req, res) => {
  const { publicId } = req.params;
  const { width, height, crop, gravity, effect } = req.query;

  try {
    // Buat URL dengan transformasi
    let transformation = [];
    
    if (width) transformation.push({ width: parseInt(width) });
    if (height) transformation.push({ height: parseInt(height) });
    if (crop) transformation.push({ crop });
    if (gravity) transformation.push({ gravity });
    if (effect) transformation.push({ effect });

    const imageUrl = cloudinary.url(publicId, {
      transformation: transformation,
      secure: true
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
      error: 'Error transformasi gambar'
    });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    files: fileDatabase.length,
    service: 'Cloudinary',
    cloudinary_configured: true
  });
});

// ==================== TEST ENDPOINT ====================
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API Cloudinary berjalan dengan baik',
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
    console.log(`☁️  Cloudinary: ${cloudinary.config().cloud_name}`);
    console.log(`📝 Test API: http://localhost:${PORT}/api/test\n`);
  });
}

module.exports = app;
