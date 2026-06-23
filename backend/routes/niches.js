const express = require('express');
const https = require('https');
const http = require('http');
const router = express.Router();

// Stockage en mémoire
let niches = [];
let nextId = 1;

// ==========================================
// HELPER : Scraper Google Trends (tendance)
// ==========================================
function fetchGoogleTrendsData(keyword) {
  return new Promise((resolve) => {
    try {
      const q = encodeURIComponent(keyword);
      const url = `https://trends.google.com/trends/explore?q=${q}&hl=fr`;
      // On ne peut pas scraper directement Google Trends sans clé API,
      // mais on va utiliser l'API publique "gtrends-api" via RapidAPI (clé utilisateur)
      // Pour l'instant, on retourne une estimation simulée basée sur des patterns
      resolve(null); // Sera enrichi si une clé RapidAPI est configurée
    } catch (e) {
      resolve(null);
    }
  });
}

// ==========================================
// HELPER : Scraper Etsy (nombre de résultats)
// ==========================================
function fetchEtsyCount(keyword) {
  return new Promise((resolve) => {
    try {
      const q = encodeURIComponent(keyword);
      const url = `https://www.etsy.com/search?q=${q}`;
      https.get(url, { timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          // Cherche le nombre total de résultats
          const match = data.match(/(\d[\d,]*)\s*(?:result|résultat)/i);
          if (match) {
            const count = parseInt(match[1].replace(/,/g, ''));
            resolve(count);
          } else {
            // Essayer un autre pattern
            const match2 = data.match(/"count"\s*:\s*(\d+)/);
            if (match2) {
              resolve(parseInt(match2[1]));
            } else {
              resolve(null);
            }
          }
        });
      }).on('error', () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

// ==========================================
// HELPER : Scraper Amazon (nombre de résultats)
// ==========================================
function fetchAmazonCount(keyword) {
  return new Promise((resolve) => {
    try {
      const q = encodeURIComponent(keyword);
      const url = `https://www.amazon.com/s?k=${q}`;
      https.get(url, { timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const match = data.match(/(\d[\d,]*)\s*(?:result|résultat)/i);
          if (match) {
            resolve(parseInt(match[1].replace(/,/g, '')));
          } else {
            const match2 = data.match(/"totalResults"\s*:\s*(\d+)/);
            if (match2) {
              resolve(parseInt(match2[1]));
            } else {
              resolve(null);
            }
          }
        });
      }).on('error', () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

// ==========================================
// HELPER : RapidAPI (si une clé est définie)
// ==========================================
function fetchRapidApiData(keyword, platform) {
  return new Promise((resolve) => {
    const apiKey = process.env.RAPIDAPI_KEY || '';
    if (!apiKey) return resolve(null);

    const options = {
      hostname: 'real-time-amazon-data.p.rapidapi.com',
      path: `/search?query=${encodeURIComponent(keyword)}&country=FR`,
      method: 'GET',
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'real-time-amazon-data.p.rapidapi.com'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ==========================================
// ALGORITHME DE SCORING AMÉLIORÉ
// ==========================================
function computeScore(niche) {
  // Demande 30%, Concurrence inv. 20%, Complexité inv. 15%, Revenue 15%, Marge 10%, TimeToMarket 10%
  const demandScore = (niche.demand / 10) * 30;
  const competitionScore = (1 - niche.competition / 10) * 20;
  const complexityScore = (1 - niche.complexity / 10) * 15;

  let revenueScore = 0;
  if (niche.revenue >= 10000) revenueScore = 15;
  else if (niche.revenue >= 5000) revenueScore = 11;
  else if (niche.revenue >= 2000) revenueScore = 7;
  else if (niche.revenue >= 1000) revenueScore = 4;
  else revenueScore = 1;

  // Marge
  const marginMap = { 'faible': 2, 'moyenne': 5, 'elevee': 10 };
  const marginScore = marginMap[niche.margin || 'moyenne'] || 5;

  // Time to market (inversé : rapide = bonus)
  const ttmMap = { '1-semaine': 10, '1-mois': 7, '3-mois': 4, '6-mois-plus': 1 };
  const ttmScore = ttmMap[niche.timeToMarket || '3-mois'] || 4;

  let score = Math.round(demandScore + competitionScore + complexityScore + revenueScore + marginScore + ttmScore);

  // Bonus concurrence faible
  if (niche.autoCompetitors !== undefined) {
    if (niche.autoCompetitors < 50) score += 5;
    if (niche.autoCompetitors < 20) score += 5;
    if (niche.autoCompetitors < 10) score += 5;
  } else {
    if (niche.competitors < 50) score += 5;
    if (niche.competitors < 20) score += 5;
    if (niche.competitors < 10) score += 5;
  }

  // Bonus si margin élevée
  if (niche.margin === 'elevee') score += 3;
  // Bonus si time to market rapide
  if (niche.timeToMarket === '1-semaine') score += 3;
  if (niche.timeToMarket === '1-mois') score += 1;

  return Math.min(score, 100);
}

// ==========================================
// ROUTES
// ==========================================

// GET /api/niches
router.get('/', (req, res) => {
  const sort = req.query.sort || 'score-desc';
  let sorted = [...niches];
  switch(sort) {
    case 'score': sorted.sort((a,b) => a.score - b.score); break;
    case 'score-desc': sorted.sort((a,b) => b.score - a.score); break;
    case 'name': sorted.sort((a,b) => a.name.localeCompare(b.name)); break;
    case 'date': sorted.sort((a,b) => new Date(b.date) - new Date(a.date)); break;
    default: sorted.sort((a,b) => b.score - a.score);
  }
  res.json(sorted);
});

// GET /api/niches/:id
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const niche = niches.find(n => n.id === id);
  if (!niche) return res.status(404).json({ error: 'Niche introuvable' });
  res.json(niche);
});

// POST /api/niches/analyze - Analyser une niche (scraping + scoring automatique)
router.post('/analyze', async (req, res) => {
  const { name, platform } = req.body;
  if (!name) return res.status(400).json({ error: 'Le nom est requis' });

  const result = { name: name.trim(), platform: platform || 'shopify' };

  // 1. Scraper Etsy / Amazon selon la plateforme
  if (platform === 'etsy' || !platform) {
    const etsyCount = await fetchEtsyCount(name);
    if (etsyCount !== null) result.autoCompetitors = etsyCount;
  }
  if (platform === 'amazon') {
    const amazonCount = await fetchAmazonCount(name);
    if (amazonCount !== null) result.autoCompetitors = amazonCount;
  }

  // 2. RapidAPI (si clé configurée)
  const rapidData = await fetchRapidApiData(name, platform);
  if (rapidData) result.rapidData = rapidData;

  // 3. Suggestion de demande basée sur le nombre de concurrents trouvés
  if (result.autoCompetitors !== undefined) {
    // Logique : beaucoup de résultats = forte demande
    if (result.autoCompetitors > 10000) result.suggestedDemand = 9;
    else if (result.autoCompetitors > 5000) result.suggestedDemand = 8;
    else if (result.autoCompetitors > 1000) result.suggestedDemand = 7;
    else if (result.autoCompetitors > 500) result.suggestedDemand = 6;
    else if (result.autoCompetitors > 100) result.suggestedDemand = 5;
    else result.suggestedDemand = 4;

    // Suggestion de concurrence basée sur le nb de concurrents
    if (result.autoCompetitors > 10000) result.suggestedCompetition = 9;
    else if (result.autoCompetitors > 5000) result.suggestedCompetition = 8;
    else if (result.autoCompetitors > 1000) result.suggestedCompetition = 7;
    else if (result.autoCompetitors > 500) result.suggestedCompetition = 6;
    else if (result.autoCompetitors > 100) result.suggestedCompetition = 4;
    else result.suggestedCompetition = 2;
  }

  res.json(result);
});

// Validation des entrées
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'']/g, '').trim().substring(0, 200);
}

function validateNicheFields(body) {
  const errors = [];
  const name = sanitize(body.name);
  if (!name) errors.push('Le nom est requis');
  if (name.length < 2) errors.push('Le nom doit faire au moins 2 caractères');
  
  const platform = ['shopify', 'appstore', 'playstore', 'amazon', 'etsy', 'web'].includes(body.platform) ? body.platform : 'shopify';
  const margin = ['faible', 'moyenne', 'elevee'].includes(body.margin) ? body.margin : 'moyenne';
  const timeToMarket = ['1-semaine', '1-mois', '3-mois', '6-mois-plus'].includes(body.timeToMarket) ? body.timeToMarket : '3-mois';

  return { errors, name, platform, margin, timeToMarket };
}

// POST /api/niches
router.post('/', (req, res) => {
  const validation = validateNicheFields(req.body);
  if (validation.errors.length > 0) {
    return res.status(400).json({ error: validation.errors.join('. ') });
  }

  const { competitors, demand, competition, complexity, revenue, notes, autoCompetitors } = req.body;

  const niche = {
    id: nextId++,
    name: validation.name,
    platform: validation.platform,
    competitors: Math.min(parseInt(competitors) || 0, 1000000),
    autoCompetitors: autoCompetitors !== undefined ? Math.min(parseInt(autoCompetitors) || 0, 1000000) : undefined,
    demand: Math.min(Math.max(parseInt(demand) || 5, 1), 10),
    competition: Math.min(Math.max(parseInt(competition) || 5, 1), 10),
    complexity: Math.min(Math.max(parseInt(complexity) || 5, 1), 10),
    revenue: Math.min(parseInt(revenue) || 0, 999999999),
    margin: validation.margin,
    timeToMarket: validation.timeToMarket,
    notes: sanitize(notes || '').substring(0, 500),
    date: new Date().toISOString()
  };

  niche.score = computeScore(niche);
  niches.push(niche);
  res.status(201).json(niche);
});

// POST /api/niches/batch
router.post('/batch', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Un tableau items[] est requis' });
  }
  const added = [];
  for (const item of items) {
    if (!item.name) continue;
    const niche = {
      id: nextId++,
      name: item.name.trim(),
      platform: item.platform || 'shopify',
      competitors: parseInt(item.competitors) || 0,
      autoCompetitors: item.autoCompetitors !== undefined ? parseInt(item.autoCompetitors) : undefined,
      demand: parseInt(item.demand) || 5,
      competition: parseInt(item.competition) || 5,
      complexity: parseInt(item.complexity) || 5,
      revenue: parseInt(item.revenue) || 0,
      margin: item.margin || 'moyenne',
      timeToMarket: item.timeToMarket || '3-mois',
      notes: item.notes || '',
      date: new Date().toISOString()
    };
    niche.score = computeScore(niche);
    niches.push(niche);
    added.push(niche);
  }
  res.status(201).json({ count: added.length, niches: added });
});

// PUT /api/niches/:id
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = niches.findIndex(n => n.id === id);
  if (index === -1) return res.status(404).json({ error: 'Niche introuvable' });

  const { name, platform, competitors, demand, competition, complexity, revenue, notes, margin, timeToMarket, autoCompetitors } = req.body;
  if (name) niches[index].name = name.trim();
  if (platform) niches[index].platform = platform;
  if (competitors) niches[index].competitors = parseInt(competitors);
  if (autoCompetitors !== undefined) niches[index].autoCompetitors = parseInt(autoCompetitors);
  if (demand) niches[index].demand = parseInt(demand);
  if (competition) niches[index].competition = parseInt(competition);
  if (complexity) niches[index].complexity = parseInt(complexity);
  if (revenue) niches[index].revenue = parseInt(revenue);
  if (margin) niches[index].margin = margin;
  if (timeToMarket) niches[index].timeToMarket = timeToMarket;
  if (notes !== undefined) niches[index].notes = notes;

  niches[index].score = computeScore(niches[index]);
  res.json(niches[index]);
});

// DELETE /api/niches/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = niches.findIndex(n => n.id === id);
  if (index === -1) return res.status(404).json({ error: 'Niche introuvable' });
  niches.splice(index, 1);
  res.json({ message: 'Niche supprimée', id });
});

// DELETE /api/niches
router.delete('/', (req, res) => {
  const count = niches.length;
  niches = [];
  nextId = 1;
  res.json({ message: `${count} niches supprimées` });
});

module.exports = router;
