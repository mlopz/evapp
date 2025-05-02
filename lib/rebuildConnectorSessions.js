// Lógica unificada para reconstrucción de sesiones y logging persistente
function toISODateSafe(ts) {
  if (typeof ts === 'string') ts = Number(ts);
  if (typeof ts === 'number') {
    if (ts > 1e12 && ts < 1e13) { // milisegundos
      ts = Math.floor(ts / 1000);
    }
    if (ts > 1e9 && ts < 1e11) { // segundos
      const date = new Date(ts * 1000);
      if (!isNaN(date.getTime()) && date.getFullYear() > 2015) {
        return date.toISOString();
      }
    }
  }
  return null;
}

module.exports = async function rebuildConnectorSessions(pool, options = {}) {
  // Opcional: puedes pasar options.cleanDebugLogs = true para limpiar logs previos
  if (options.cleanDebugLogs) {
    await pool.query('DELETE FROM rebuild_debug_logs');
  }
  // Log de inicio
  await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', ['[REBUILD-DEBUG] INICIO DE REBUILD']);

  const BATCH_SIZE = 5000;
  let offset = 0;
  let totalProcessed = 0;
  let totalEvents = 0;
  // Obtener cantidad total de eventos
  const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM charger_monitoring');
  totalEvents = countRes.rows[0].total;
  await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-DEBUG] Total eventos en charger_monitoring: ${totalEvents}`]);

  // Limpiar tabla de sesiones antes de reconstruir
  await pool.query('DELETE FROM connector_sessions');
  await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', ['[REBUILD-DEBUG] Tabla connector_sessions borrada.']);

  while (offset < totalEvents) {
    // Traer lote de eventos ordenados por timestamp
    const { rows: events } = await pool.query(
      `SELECT * FROM charger_monitoring ORDER BY charger_name, connector_id, timestamp OFFSET $1 LIMIT $2`,
      [offset, BATCH_SIZE]
    );
    if (events.length === 0) break;
    await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-DEBUG] Procesando lote desde offset ${offset} (${events.length} eventos)`]);

    // --- Reconstrucción de sesiones por lote ---
    let lastSession = {}; // key = charger_name + connector_id
    let lastSessionEnd = {}; // para el cierre artificial
    let sessionsToInsert = [];
    const INACTIVITY_THRESHOLD_MINUTES = 30;
    let lastChargingTimestamp = {};

    function isValidTimestamp(ts) {
      let date;
      if (typeof ts === 'number') {
        if (ts > 1e12) { // milisegundos
          date = new Date(ts);
        } else if (ts > 1e9) { // segundos
          date = new Date(ts * 1000);
        } else {
          return false;
        }
      } else if (typeof ts === 'string') {
        const num = Number(ts);
        if (!isNaN(num)) {
          if (num > 1e12) {
            date = new Date(num);
          } else if (num > 1e9) {
            date = new Date(num * 1000);
          } else {
            date = new Date(ts);
          }
        } else {
          date = new Date(ts);
        }
      }
      return date && !isNaN(date.getTime()) && date.getFullYear() > 2015;
    }

    for (const event of events) {
      const key = `${event.charger_name}__${event.connector_id}`;
      if (!lastSession[key]) lastSession[key] = null;
      if (!lastSessionEnd[key]) lastSessionEnd[key] = null;

      if (!isValidTimestamp(event.timestamp)) {
        await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-ERROR] Evento con timestamp inválido: ${event.charger_name} - ${event.connector_id} | ts: ${event.timestamp}`]);
        continue;
      }
      const eventTs = toISODateSafe(event.timestamp);
      const eventTsNum = typeof event.timestamp === 'string' ? Number(event.timestamp) : event.timestamp;

      if (event.status === 'Charging') {
        if (!lastSession[key]) {
          // Abrir nueva sesión
          lastSession[key] = {
            charger_name: event.charger_name,
            connector_id: event.connector_id,
            connector_type: event.connector_type,
            power: event.power,
            session_start: eventTs,
          };
        } else if (lastChargingTimestamp[key] && (eventTsNum - lastChargingTimestamp[key]) > INACTIVITY_THRESHOLD_MINUTES * 60) {
          // Cerrar sesión por inactividad
          const session_end = toISODateSafe(lastChargingTimestamp[key]);
          const duration_minutes = Math.round((new Date(session_end) - new Date(lastSession[key].session_start)) / 60000);
          sessionsToInsert.push({
            ...lastSession[key],
            session_end,
            duration_minutes
          });
          // Abrir nueva sesión
          lastSession[key] = {
            charger_name: event.charger_name,
            connector_id: event.connector_id,
            connector_type: event.connector_type,
            power: event.power,
            session_start: eventTs,
          };
        }
        lastChargingTimestamp[key] = eventTsNum;
      } else {
        if (lastSession[key]) {
          // Cierre normal por cambio de estado
          const session_end = eventTs;
          const duration_minutes = Math.round((new Date(session_end) - new Date(lastSession[key].session_start)) / 60000);
          sessionsToInsert.push({
            ...lastSession[key],
            session_end,
            duration_minutes
          });
          lastSession[key] = null;
          lastChargingTimestamp[key] = null;
        }
      }
    }

    // --- CIERRE DE SEGURIDAD: cerrar sesiones abiertas en el último evento Charging ---
    for (const key in lastSession) {
      const sesion = lastSession[key];
      if (sesion && lastChargingTimestamp[key]) {
        const session_start = new Date(sesion.session_start);
        const session_end = toISODateSafe(lastChargingTimestamp[key]);
        const duration_minutes = Math.round((new Date(session_end) - session_start) / 60000);
        sessionsToInsert.push({
          charger_name: sesion.charger_name,
          connector_id: sesion.connector_id,
          connector_type: sesion.connector_type,
          power: sesion.power,
          session_start: session_start.toISOString(),
          session_end,
          duration_minutes
        });
      }
    }

    // Insertar sesiones reconstruidas
    for (const s of sessionsToInsert) {
      if (!s.session_start || !s.session_end) {
        await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [
          `[REBUILD-ERROR] Sesión descartada por session_start o session_end null: ${JSON.stringify(s)}`
        ]);
        continue;
      }
      if (s.session_start === s.session_end || s.duration_minutes <= 0) {
        await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [
          `[REBUILD-DEBUG] Sesión descartada por duración 0 o negativa: ${JSON.stringify(s)}`
        ]);
        continue;
      }
      await pool.query(
        `INSERT INTO connector_sessions (charger_name, connector_id, connector_type, power, session_start, session_end, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [s.charger_name, s.connector_id, s.connector_type, s.power, s.session_start, s.session_end, s.duration_minutes]
      );
    }
    totalProcessed += events.length;
    await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-DEBUG] Lote procesado: ${sessionsToInsert.length} sesiones insertadas. Total eventos procesados: ${totalProcessed}/${totalEvents}`]);
    offset += BATCH_SIZE;
  }

  await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-DEBUG] Proceso completado. Total eventos procesados: ${totalProcessed}`]);
  return { inserted: totalProcessed };
};