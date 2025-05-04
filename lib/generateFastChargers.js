const fs = require('fs');
const path = require('path');

/**
 * Genera el archivo fast_chargers.json a partir de la base de datos.
 * @param {Pool} pool - Instancia de pg.Pool
 * @param {string} [filePath] - Ruta donde guardar el archivo (opcional)
 * @returns {Promise<number>} - Cantidad de conectores rápidos generados
 */
async function generateFastChargersJson(pool, filePath = path.join(__dirname, '../fast_chargers.json')) {
  const { rows } = await pool.query(
    `SELECT DISTINCT connector_id FROM charger_monitoring WHERE power >= 60`
  );
  const ids = rows.map(r => r.connector_id).filter(Boolean);
  fs.writeFileSync(filePath, JSON.stringify(ids, null, 2), 'utf8');
  return ids.length;
}

module.exports = { generateFastChargersJson };
