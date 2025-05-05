// Script para generar fast_chargers.json automáticamente desde la base de datos
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

(async () => {
  try {
    // Consulta todos los connector_id de conectores con potencia >= 60
    const { rows } = await pool.query(
      `SELECT DISTINCT connector_id FROM charger_monitoring WHERE power >= 60`
    );
    const ids = rows.map(r => r.connector_id).filter(Boolean);
    if (!ids.length) {
      console.warn('No se encontraron conectores rápidos en la base de datos.');
    }
    const filePath = path.join(__dirname, 'fast_chargers.json');
    fs.writeFileSync(filePath, JSON.stringify(ids, null, 2), 'utf8');
    console.log(`Archivo fast_chargers.json generado con ${ids.length} conectores rápidos.`);
  } catch (err) {
    console.error('Error generando fast_chargers.json:', err);
  } finally {
    await pool.end();
  }
})();
