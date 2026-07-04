'use strict';

const path = require('path');
const express = require('express');

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(express.json({ limit: '1mb' }));

// API
app.use('/api', publicRoutes);
app.use('/api', adminRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Frontend estatico
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// SPA fallback (qualquer rota nao-API devolve o index)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Jogo dos Pontos a correr em http://localhost:${PORT}`);
  });
}

module.exports = app;
