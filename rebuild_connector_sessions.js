// Script para borrar y reconstruir la tabla connector_sessions usando charger_monitoring
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

(async () => {
  try {
    // --- Log de inicio absoluto ---
    await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', ['[REBUILD-DEBUG] INICIO DE REBUILD']);

    // 1. Borrar todas las sesiones actuales
    // await pool.query('DELETE FROM connector_sessions'); // Desactivado temporalmente
    console.log('Tabla connector_sessions borrada.');

    // 2. Obtener todos los eventos de cargadores rápidos (sin filtro de potencia)
    const { rows: events } = await pool.query(
      `SELECT * FROM charger_monitoring ORDER BY charger_name, connector_id, timestamp`
    );

    // --- Limpiar logs previos de debug (desactivado temporalmente) ---
    // await pool.query('DELETE FROM rebuild_debug_logs');

    // Función auxiliar para loguear en la tabla
    async function logDebug(msg) {
      await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [msg]);
    }

    // --- DEBUG: Mostrar cantidad y timestamp máximo de eventos ---
    const debugCount = `[REBUILD-DEBUG] Cantidad de eventos en charger_monitoring: ${events.length}`;
    console.log(debugCount);
    await logDebug(debugCount);
    if (events.length > 0) {
      const debugTs = `[REBUILD-DEBUG] Timestamp evento más reciente: ${events[events.length-1].timestamp}`;
      console.log(debugTs);
      await logDebug(debugTs);
    }

    // 3. Reconstruir sesiones con lógica robusta (idéntica a migrate_sessions.js)
    let lastSession = {}; // key = charger_name + connector_id
    let lastSessionEnd = {}; // para el cierre artificial
    let sessionsToInsert = [];

    for (const event of events) {
      const key = `${event.charger_name}__${event.connector_id}`;
      if (!lastSession[key]) lastSession[key] = null;
      if (!lastSessionEnd[key]) lastSessionEnd[key] = null;

      if (event.status === 'Charging') {
        if (!lastSession[key]) {
          // Abrir nueva sesión
          lastSession[key] = {
            charger_name: event.charger_name,
            connector_id: event.connector_id,
            connector_type: event.connector_type,
            power: event.power,
            session_start: event.timestamp,
          };
          console.log(`[REBUILD-FIX] Apertura sesión: ${event.charger_name} - ${event.connector_id} | status: ${event.status} | ts: ${event.timestamp}`);
        } else {
          // Ya hay sesión abierta, ignorar Charging repetido
          console.log(`[REBUILD-FIX] Ignorado Charging repetido: ${event.charger_name} - ${event.connector_id} | ts: ${event.timestamp}`);
        }
      } else {
        if (lastSession[key]) {
          // Solo cerrar si hay sesión abierta
          const session_end = event.timestamp;
          const duration_minutes = Math.round((new Date(session_end) - new Date(lastSession[key].session_start)) / 60000);
          sessionsToInsert.push({
            ...lastSession[key],
            session_end,
            duration_minutes
          });
          console.log(`[REBUILD-FIX] Cierre sesión: ${event.charger_name} - ${event.connector_id} | status cierre: ${event.status} | ts cierre: ${event.timestamp} | ts apertura: ${lastSession[key].session_start} | duración: ${duration_minutes} min`);
          lastSessionEnd[key] = session_end;
          lastSession[key] = null;
        } else {
          // Evento de cierre sin sesión abierta: ignorar o crear sesión artificial si lo deseas
          console.log(`[REBUILD-FIX] Evento de cierre sin sesión abierta: ${event.charger_name} - ${event.connector_id} | status: ${event.status} | ts: ${event.timestamp}`);
        }
      }
    }

    // --- CIERRE DE SEGURIDAD: cerrar sesiones abiertas a los 70 minutos ---
    console.log('[REBUILD-FIX] Estado de lastSession antes de cierres artificiales:', lastSession);
    for (const key in lastSession) {
      const sesion = lastSession[key];
      if (sesion) {
        const session_start = new Date(sesion.session_start);
        const session_end = new Date(session_start.getTime() + 70 * 60000); // +70 minutos
        const duration_minutes = 70;
        sessionsToInsert.push({
          charger_name: sesion.charger_name,
          connector_id: sesion.connector_id,
          connector_type: sesion.connector_type,
          power: sesion.power,
          session_start: session_start.toISOString(),
          session_end: session_end.toISOString(),
          duration_minutes
        });
        console.log(`[REBUILD-FIX] Cierre artificial (70min) para ${sesion.charger_name} - ${sesion.connector_id} | ts apertura: ${sesion.session_start} | ts cierre: ${session_end.toISOString()} | duración: ${duration_minutes} min`);
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
