const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { router: apiRouter, metaRoutes, adminRoutes } = require('./routes');
const { DB_PATH } = require('./db');

const PORT = parseInt(process.env.PORT || '3500', 10);
const STATIC_ROOT = path.resolve(__dirname, '..');

const app = express();

app.use(cors());
// strict:false lets us accept primitive JSON values (true, 123, "x") for
// meta singletons like seeded=true or migration_version=11
app.use(express.json({ limit: '20mb', strict: false }));

app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  next();
});

app.use((req, _res, next) => {
  const tag = req.method.padEnd(6);
  console.log(`  ${tag} ${req.url}`);
  next();
});

app.use('/api/admin', adminRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api', apiRouter);

app.use(express.static(STATIC_ROOT, { etag: false, lastModified: false }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const lanAddrs = [];
const ifaces = os.networkInterfaces();
for (const name of Object.keys(ifaces)) {
  for (const iface of ifaces[name]) {
    if (iface.family === 'IPv4' && !iface.internal) lanAddrs.push(iface.address);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  const line = '═'.repeat(54);
  console.log('');
  console.log(`╔${line}╗`);
  console.log('║   SCR Management System — Backend Started           ║');
  console.log(`╚${line}╝`);
  console.log('');
  console.log(`   Local:    http://localhost:${PORT}/`);
  for (const a of lanAddrs) console.log(`   LAN:      http://${a}:${PORT}/`);
  console.log('');
  console.log(`   API:      http://localhost:${PORT}/api/`);
  console.log(`   Health:   http://localhost:${PORT}/api/admin/health`);
  console.log(`   Database: ${DB_PATH}`);
  console.log('');
  console.log('   Press Ctrl+C to stop');
  console.log('');
});
