const express = require('express');
const router = express.Router();
const { getRentabilidadStats } = require('../services/rentabilidadService');

// Endpoint principal de estadísticas de rentabilidad
router.get('/estadisticas', async (req, res) => {
  try {
    const stats = await getRentabilidadStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo estadísticas de rentabilidad', details: err.message });
  }
});

module.exports = router;
