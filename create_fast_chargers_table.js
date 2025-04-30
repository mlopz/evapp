// Script para crear la tabla fast_chargers en PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const createTableSQL = `
CREATE TABLE IF NOT EXISTS fast_chargers (
  connector_id VARCHAR(128) PRIMARY KEY,
  charger_name VARCHAR(128) NOT NULL,
  connector_type VARCHAR(64),
  power INTEGER NOT NULL
);
`;

(async () => {
  try {
    await pool.query(createTableSQL);
    console.log('Tabla fast_chargers creada o ya existe.');
  } catch (err) {
    console.error('Error creando la tabla fast_chargers:', err);
  } finally {
    await pool.end();
  }
})();
