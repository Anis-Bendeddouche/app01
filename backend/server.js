const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3001;

// ==========================================
// SÉCURITÉ
// ==========================================

// Helmet : en-têtes HTTP de sécurité
app.use(helmet({
  contentSecurityPolicy: false, // Désactivé pour permettre les ressources CDN (Font Awesome, etc.)
  crossOriginEmbedderPolicy: false
}));

// Rate limiting : max 30 requêtes/min par IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Trop de requêtes. Réessaie dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Limite plus stricte pour le scraping (1 requête/5 sec max)
const scrapeLimiter = rateLimit({
  windowMs: 5 * 1000, // 5 secondes
  max: 1,
  message: { error: 'Trop de requêtes d\'analyse. Attends 5 secondes.' },
});
app.use('/api/niches/analyze', scrapeLimiter);

// CORS restreint (en production, mettre le vrai domaine)
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*', // À restreindre en prod
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

// Parseur JSON avec limite réduite
app.use(express.json({ limit: '1mb' }));

// ==========================================
// FICHIERS STATIQUES
// ==========================================
app.use(express.static(path.join(__dirname, '..')));

// ==========================================
// ROUTES
// ==========================================
app.use('/api/niches', require('./routes/niches'));

// Route racine
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'start-ici.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==========================================
// GESTION DES ERREURS
// ==========================================
app.use((err, req, res, next) => {
  console.error('🚨 Erreur:', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// ==========================================
// DÉMARRAGE
// ==========================================
app.listen(PORT, () => {
  console.log(`\n🎯 Niche Finder démarré sur http://localhost:${PORT}`);
  console.log(`📦 API disponible sur http://localhost:${PORT}/api`);
  console.log(`🛡️  Sécurité : rate-limit 30req/min, Helmet actif\n`);
});
