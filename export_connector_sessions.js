// Script para exportar la tabla connector_sessions a un archivo CSV
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

(async () => {
  try {
    const { rows, fields } = await pool.query('SELECT * FROM connector_sessions ORDER BY session_start DESC');
    if (!rows.length) {
      console.log('No hay registros en connector_sessions.');
      return;
    }
    // Obtener los nombres de los campos
    const headers = Object.keys(rows[0]);
    const csvRows = [headers.join(',')];
    for (const row of rows) {
      const values = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        // Formatear fechas
        if (val instanceof Date) return val.toISOString();
        // Escapar comas y saltos de línea
        return String(val).replace(/\n/g, ' ').replace(/,/g, ';');
      });
      csvRows.push(values.join(','));
    }
    const filePath = path.join(__dirname, 'connector_sessions_export.csv');
    fs.writeFileSync(filePath, csvRows.join('\n'), 'utf8');
    console.log(`Exportación completada: ${filePath}`);
  } catch (err) {
    console.error('Error exportando connector_sessions:', err);
  } finally {
    await pool.end();
  }
})();
