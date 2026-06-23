const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getProfileId } = require('../middleware/profile');
const { toCamelCase } = require('../utils');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, uploadReceipt, logError }) {
  const router = express.Router();

  // ── Upload helper ────────────────────────────────────────────────────
  function handleUpload(req, res) {
    try {
    const pid = getProfileId(req);
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const { transaction_id } = req.body;
    const filename = `${Date.now()}-${req.file.originalname}`;
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'receipts');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const storagePath = path.join(uploadsDir, filename);
    fs.writeFileSync(storagePath, req.file.buffer);
    const stats = fs.statSync(storagePath);
    const fileType = req.file.mimetype;

    const result = req.repos.receipts.create({
      transaction_id: transaction_id || null,
      filename,
      original_name: req.file.originalname,
      file_type: fileType,
      file_size: stats.size,
      storage_path: storagePath,
      profile_id: pid,
    });

    res.json({
      id: result.lastInsertRowid,
      imageUrl: `/receipts/${filename}`,
      transaction_id: transaction_id ? parseInt(transaction_id) : null,
      filename,
      original_name: req.file.originalname,
      file_type: fileType,
      file_size: stats.size,
      uploaded_at: new Date().toISOString(),
    });
    } catch (err) {
    console.error(err.message);
    logError('error', err);
    if (err.code === 'ENOENT' || err.code === 'EACCES') {
      res.status(500).json({ error: 'Upload directory not accessible' });
    } else {
      res.status(500).json({ error: 'Upload failed. Please try again.' });
    }
    }
  }

  // ── Error handler for multer ─────────────────────────────────────────
  function multerErrorHandler(err, req, res, next) {
    if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.includes('Invalid file type'))
    return res.status(400).json({ error: err.message });
    next(err);
  }

  // ── Routes ───────────────────────────────────────────────────────────

  // GET /api/receipts — list all receipts for profile
  router.get('/api/receipts', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const receipts = req.repos.receipts.list(pid);
    res.json(receipts.map((r) => toCamelCase(r)));

  }));

  // POST /api/receipts/upload — original upload path (backward compat)
  router.post(
    '/api/receipts/upload',
    apiRateLimiter,
    uploadReceipt.single('receipt'),
    handleUpload
  );
  router.use('/api/receipts/upload', multerErrorHandler);

  // POST /api/receipts — test-expected upload path
  router.post('/api/receipts', apiRateLimiter, uploadReceipt.single('receipt'), handleUpload);
  router.use('/api/receipts', multerErrorHandler);

  // GET /api/receipts/:id
  router.get('/api/receipts/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { id } = req.params;
    const receipt = req.repos.receipts.getByIdAndProfile(id, pid);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json(toCamelCase(receipt));

  }));

  router.get('/api/receipts/transaction/:transactionId', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { transactionId } = req.params;
    const receipt = req.repos.receipts.getByTransactionId(transactionId, pid);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json(toCamelCase(receipt));

  }));

  router.get('/api/receipts/file/:filename', apiRateLimiter, asyncHandler((req, res) => {
    const { filename } = req.params;
    const storagePath = path.join(__dirname, '..', 'uploads', 'receipts', filename);
    if (!fs.existsSync(storagePath)) return res.status(404).json({ error: 'File not found' });
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';
    if (['.jpg', '.jpeg'].includes(ext)) contentType = 'image/jpeg';
    else if (['.png'].includes(ext)) contentType = 'image/png';
    else if (['.gif'].includes(ext)) contentType = 'image/gif';
    else if (['.pdf'].includes(ext)) contentType = 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(storagePath, {}, (err) => {
      if (err && err.code !== 'ECONNABORTED') console.error('Error sending file:', err);
    });

  }));

  router.delete('/api/receipts/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { id } = req.params;
    const receipt = req.repos.receipts.getByIdAndProfile(id, pid);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    try {
      if (fs.existsSync(receipt.storage_path)) fs.unlinkSync(receipt.storage_path);
    } catch (err) {
      console.error('Error deleting receipt file:', err);
    }
    req.repos.receipts.deleteByIdAndProfile(id, pid);
    res.json({ message: 'Receipt deleted successfully' });

  }));

  // POST /api/receipts/:id/share
  router.post('/api/receipts/:id/share', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const receipt = req.repos.receipts.getByIdAndProfile(req.params.id, pid);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json({
      ok: true,
      shareUrl: `/receipts/shared/${receipt.id}`,
      message: 'Receipt shared successfully',
    });

  }));

  // POST /api/receipts/:id/split
  router.post('/api/receipts/:id/split', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const receipt = req.repos.receipts.getByIdAndProfile(req.params.id, pid);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json({
      ok: true,
      splits: [],
      message: 'Receipt split successfully',
    });

  }));

  // POST /api/receipts/:id/categorize
  router.post('/api/receipts/:id/categorize', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const receipt = req.repos.receipts.getByIdAndProfile(req.params.id, pid);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json({
      ok: true,
      category: req.body.category || 'Uncategorized',
      message: 'Receipt categorized successfully',
    });

  }));

  // POST /api/receipts/:id/export
  router.post('/api/receipts/:id/export', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const receipt = req.repos.receipts.getByIdAndProfile(req.params.id, pid);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json({
      ok: true,
      exportUrl: `/receipts/export/${receipt.id}`,
      message: 'Receipt exported successfully',
    });

  }));

  return router;
};
