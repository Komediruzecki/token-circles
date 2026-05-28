const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getProfileId } = require('../middleware/profile');

module.exports = function ({ db, apiRateLimiter, uploadReceipt, logError }) {
  const router = express.Router();

  router.post(
    '/api/receipts/upload',
    apiRateLimiter,
    uploadReceipt.single('receipt'),
    (req, res) => {
      try {
        const pid = getProfileId(req);
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }
        const { transaction_id } = req.body;
        if (!transaction_id) {
          return res.status(400).json({ error: 'Transaction ID is required' });
        }
        const filename = `${Date.now()}-${req.file.originalname}`;
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'receipts');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const storagePath = path.join(uploadsDir, filename);
        fs.writeFileSync(storagePath, req.file.buffer);
        const stats = fs.statSync(storagePath);
        const fileType = req.file.mimetype;
        const stmt = db.prepare(
          `INSERT INTO receipts (transaction_id, filename, original_name, file_type, file_size, storage_path, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const result = stmt.run(
          transaction_id,
          filename,
          req.file.originalname,
          fileType,
          stats.size,
          storagePath,
          pid
        );
        res.json({
          id: result.lastInsertRowid,
          transaction_id: parseInt(transaction_id),
          filename,
          original_name: req.file.originalname,
          file_type: fileType,
          file_size: stats.size,
          url: `/receipts/${filename}`,
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
  );

  router.use('/api/receipts/upload', (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
      return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.includes('Invalid file type'))
      return res.status(400).json({ error: err.message });
    next(err);
  });

  router.get('/api/receipts/:id', apiRateLimiter, (req, res) => {
    try {
      const { id } = req.params;
      const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
      if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
      res.json(receipt);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/receipts/transaction/:transactionId', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { transactionId } = req.params;
      const receipt = db
        .prepare('SELECT * FROM receipts WHERE transaction_id = ? AND profile_id = ?')
        .get(transactionId, pid);
      if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
      res.json(receipt);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/receipts/file/:filename', apiRateLimiter, (req, res) => {
    try {
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
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/receipts/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const { id } = req.params;
      const receipt = db
        .prepare('SELECT * FROM receipts WHERE id = ? AND profile_id = ?')
        .get(id, pid);
      if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
      try {
        if (fs.existsSync(receipt.storage_path)) fs.unlinkSync(receipt.storage_path);
      } catch (err) {
        console.error('Error deleting receipt file:', err);
      }
      db.prepare('DELETE FROM receipts WHERE id = ?').run(id);
      res.json({ message: 'Receipt deleted successfully' });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
