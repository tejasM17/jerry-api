const express = require('express');
const router = express.Router();
const { streamResponse } = require('../controllers/stream.controller');

// POST /api/stream
router.post('/stream', async (req, res) => {
  // Basic payload validation
  if (!req.body || typeof req.body.prompt !== 'string') {
    return res.status(400).json({ error: 'Invalid payload: "prompt" string required.' });
  }

  // Set streaming headers
  res.setHeader('Content-Type', 'text/plain');
  // Disable buffering for Nginx/Apache proxies
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    await streamResponse(req, res);
  } catch (err) {
    console.error('Streaming error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Streaming failed.' });
    } else {
      // If headers already sent, end the stream with an error message
      res.write('\n\n[Error streaming response]');
      res.end();
    }
  }
});

module.exports = router;
