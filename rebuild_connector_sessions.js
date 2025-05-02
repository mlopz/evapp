// Script para borrar y reconstruir la tabla connector_sessions usando charger_monitoring
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const BATCH_SIZE = 5000; // Actualizado a 5000 eventos por lote

(async () => {
  try {
    // --- Log de inicio absoluto ---
    await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', ['[REBUILD-DEBUG] INICIO DE REBUILD']);

    // 1. Borrar todas las sesiones actuales
    await pool.query('DELETE FROM connector_sessions');
    console.log('Tabla connector_sessions borrada.');
    await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', ['[REBUILD-DEBUG] Tabla connector_sessions borrada.']);

    // 2. Procesar eventos de charger_monitoring en lotes
    let offset = 0;
    let totalProcessed = 0;
    let totalEvents = 0;
    // Obtener cantidad total de eventos
    const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM charger_monitoring');
    totalEvents = countRes.rows[0].total;
    console.log(`[REBUILD-DEBUG] Total eventos en charger_monitoring: ${totalEvents}`);
    await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-DEBUG] Total eventos en charger_monitoring: ${totalEvents}`]);

    while (offset < totalEvents) {
      // Traer lote de eventos ordenados por timestamp
      const { rows: events } = await pool.query(
        `SELECT * FROM charger_monitoring ORDER BY charger_name, connector_id, timestamp OFFSET $1 LIMIT $2`,
        [offset, BATCH_SIZE]
      );
      if (events.length === 0) break;
      console.log(`[REBUILD-DEBUG] Procesando lote desde offset ${offset} (${events.length} eventos)`);
      await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-DEBUG] Procesando lote desde offset ${offset} (${events.length} eventos)`]);

      // --- Reconstrucción de sesiones por lote ---
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
      totalProcessed += events.length;
      console.log(`[REBUILD-DEBUG] Lote procesado: ${count} sesiones insertadas. Total eventos procesados: ${totalProcessed}/${totalEvents}`);
      await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-DEBUG] Lote procesado: ${count} sesiones insertadas. Total eventos procesados: ${totalProcessed}/${totalEvents}`]);
      offset += BATCH_SIZE;
    }

    console.log(`[REBUILD-DEBUG] Proceso completado. Total eventos procesados: ${totalProcessed}`);
    await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-DEBUG] Proceso completado. Total eventos procesados: ${totalProcessed}`]);
  } catch (err) {
    console.error('Error reconstruyendo connector_sessions:', err);
    await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', ['[REBUILD-ERROR] ' + err.toString()]);
  } finally {
    await pool.end();
  }
})();
