const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrateSessions() {
  // 1. Obtener todos los eventos ordenados
  const { rows: events } = await pool.query(
    `SELECT * FROM charger_monitoring
     WHERE power >= 60
     ORDER BY charger_name, connector_id, timestamp`
  );

  // 2. Agrupar por conector
  const sessionsToInsert = [];
  let lastSession = {};

  for (const event of events) {
    const key = `${event.charger_name}__${event.connector_id}`;
    if (!lastSession[key]) lastSession[key] = null;

    if (event.status === 'Charging') {
      // Si no hay sesión abierta, abrir una nueva
      if (!lastSession[key]) {
        lastSession[key] = {
          charger_name: event.charger_name,
          connector_id: event.connector_id,
          connector_type: event.connector_type,
          power: event.power,
          session_start: event.timestamp,
        };
      }
      // Si ya hay sesión abierta, ignorar (ya está cargando)
    } else {
      // Si hay sesión abierta y termina la carga, registrar fin
      if (lastSession[key]) {
        const session_end = event.timestamp;
        const duration_minutes = Math.round((new Date(session_end) - new Date(lastSession[key].session_start)) / 60000);
        sessionsToInsert.push({
          ...lastSession[key],
          session_end,
          duration_minutes
        });
        lastSession[key] = null;
      }
    }
  }

  // 3. Insertar sesiones en la nueva tabla
  for (const s of sessionsToInsert) {
    await pool.query(
      `INSERT INTO connector_sessions (charger_name, connector_id, connector_type, power, session_start, session_end, duration_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [s.charger_name, s.connector_id, s.connector_type, s.power, s.session_start, s.session_end, s.duration_minutes]
    );
  }

  console.log(`Migradas ${sessionsToInsert.length} sesiones.`);
  await pool.end();
}

migrateSessions().catch(err => {
  console.error('Error migrando sesiones:', err);
});
