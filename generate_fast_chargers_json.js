// Script para generar fast_chargers.json automáticamente desde la base de datos
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { generateFastChargersJson } = require('./lib/generateFastChargers');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

(async () => {
  try {
    const count = await generateFastChargersJson(pool);
    console.log(`Archivo fast_chargers.json generado con ${count} conectores rápidos.`);
  } catch (err) {
    console.error('Error generando fast_chargers.json:', err);
  } finally {
    await pool.end();
  }
})();
