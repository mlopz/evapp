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

    // 2. Obtener todos los eventos de cargadores rápidos (sin filtro de potencia)
    const { rows: events } = await pool.query(
      `SELECT * FROM charger_monitoring ORDER BY charger_name, connector_id, timestamp`
    );

    // 3. Reconstruir sesiones con lógica robusta (idéntica a migrate_sessions.js)
    let lastSession = {}; // key = charger_name + connector_id
    let lastSessionEnd = {}; // para el cierre artificial
    let sessionsToInsert = [];

    for (const event of events) {
      const key = `${event.charger_name}__${event.connector_id}`;
      if (!lastSession[key]) lastSession[key] = null;
      if (!lastSessionEnd[key]) lastSessionEnd[key] = null;

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
          lastSessionEnd[key] = session_end;
          lastSession[key] = null;
        } else {
          // --- cierre sin sesión abierta ---
          const session_end = new Date(event.timestamp);
          const prev_end = lastSessionEnd[key] ? new Date(lastSessionEnd[key]) : null;
          let session_start, duration_minutes;
          if (prev_end && (session_end - prev_end) / 60000 < 70) {
            session_start = new Date(prev_end.getTime() + 10 * 60000); // +10 min
            duration_minutes = Math.round((session_end - session_start) / 60000);
            if (duration_minutes < 1) duration_minutes = 1;
          } else {
            duration_minutes = 35;
            session_start = new Date(session_end.getTime() - 35 * 60000);
          }
          sessionsToInsert.push({
            charger_name: event.charger_name,
            connector_id: event.connector_id,
            connector_type: event.connector_type,
            power: event.power,
            session_start: session_start.toISOString(),
            session_end: session_end.toISOString(),
            duration_minutes
          });
          lastSessionEnd[key] = session_end.toISOString();
          console.log(`Cierre sin inicio: ${event.charger_name} - ${event.connector_id} (${event.timestamp}) inicio artificial: ${session_start.toISOString()} duración: ${duration_minutes}`);
        }
      }
    }

    // --- CIERRE DE SEGURIDAD: cerrar sesiones abiertas a los 70 minutos ---
    for (const key in lastSession) {
      const sesion = lastSession[key];
      if (sesion) {
        const session_start = new Date(sesion.session_start);
        const session_end = new Date(session_start.getTime() + 70 * 60000); // +70 minutos
        sessionsToInsert.push({
          charger_name: sesion.charger_name,
          connector_id: sesion.connector_id,
          connector_type: sesion.connector_type,
          power: sesion.power,
          session_start: session_start.toISOString(),
          session_end: session_end.toISOString(),
          duration_minutes: 70
        });
        console.log(`Cierre de seguridad: sesión abierta para ${sesion.charger_name} - ${sesion.connector_id} cerrada a los 70 minutos.`);
      }
    }

    // 4. Insertar sesiones reconstruidas
    let count = 0;
    for (const s of sessionsToInsert) {
      await pool.query(
        `INSERT INTO connector_sessions (charger_name, connector_id, connector_type, power, session_start, session_end, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
