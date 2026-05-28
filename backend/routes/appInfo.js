const express = require('express');

const APP_VERSION = '1.0.0';
const APP_REPO = 'https://github.com/Komediruzecki/finance-manager';

module.exports = function () {
  const router = express.Router();

  router.get('/api/app-info', (req, res) => {
    res.json({
      version: APP_VERSION,
      repository: APP_REPO,
      nodeVersion: process.version,
    });
  });

  return router;
};
