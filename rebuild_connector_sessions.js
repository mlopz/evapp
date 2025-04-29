// Script para borrar y reconstruir la tabla connector_sessions usando charger_monitoring
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

(async () => {
  try {
    // 1. Borrar todas las sesiones actuales
    await pool.query('DELETE FROM connector_sessions');
    console.log('Tabla connector_sessions borrada.');

    // 2. Obtener todos los eventos de cargadores rápidos
    const { rows: events } = await pool.query(
      `SELECT * FROM charger_monitoring WHERE power >= 60 ORDER BY charger_name, connector_id, timestamp`
    );

    // 3. Reconstruir sesiones
    let lastSession = {}; // key = charger_name + connector_id
    let sessionsToInsert = [];

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
        // Si ya hay sesión abierta, ignorar
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

    // 4. Insertar sesiones reconstruidas
    let count = 0;
    for (const s of sessionsToInsert) {
      await pool.query(
        `INSERT INTO connector_sessions (charger_name, connector_id, connector_type, power, session_start, session_end, duration_minutes, last_heartbeat)
         VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), $7, to_timestamp($6 / 1000.0))`,
        [s.charger_name, s.connector_id, s.connector_type, s.power, s.session_start, s.session_end, s.duration_minutes]
      );
      count++;
    }
    console.log(`Reconstrucción completada: ${count} sesiones insertadas.`);
  } catch (err) {
    console.error('Error reconstruyendo connector_sessions:', err);
  } finally {
    await pool.end();
  }
})();
