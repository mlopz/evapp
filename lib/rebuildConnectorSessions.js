// Lógica unificada para reconstrucción de sesiones y logging persistente
module.exports = async function rebuildConnectorSessions(pool, options = {}) {
  // Opcional: puedes pasar options.cleanDebugLogs = true para limpiar logs previos
  if (options.cleanDebugLogs) {
    await pool.query('DELETE FROM rebuild_debug_logs');
  }
  // Log de inicio
  await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', ['[REBUILD-DEBUG] INICIO DE REBUILD']);

  // Obtener eventos
  const { rows: events } = await pool.query(
    `SELECT * FROM charger_monitoring ORDER BY charger_name, connector_id, timestamp`
  );
  const debugCount = `[REBUILD-DEBUG] Cantidad de eventos en charger_monitoring: ${events.length}`;
  await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [debugCount]);
  if (events.length > 0) {
    const debugTs = `[REBUILD-DEBUG] Timestamp evento más reciente: ${events[events.length-1].timestamp}`;
    await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [debugTs]);
  }

  // --- Aquí va la lógica robusta de reconstrucción de sesiones ---
  let lastSession = {}; // key = charger_name + connector_id
  let lastSessionEnd = {};
  let sessionsToInsert = [];

  for (const event of events) {
    const key = `${event.charger_name}__${event.connector_id}`;
    if (!lastSession[key]) lastSession[key] = null;
    if (!lastSessionEnd[key]) lastSessionEnd[key] = null;

    // Convertir a string ISO si es numérico
    let eventTimestamp = event.timestamp;
    if (typeof eventTimestamp === 'number') {
      try {
        eventTimestamp = new Date(eventTimestamp).toISOString();
      } catch (e) {
        await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [`[REBUILD-ERROR] Timestamp inválido: ${event.timestamp}`]);
        continue;
      }
    }

    if (event.status === 'Charging') {
      if (!lastSession[key]) {
        lastSession[key] = {
          charger_name: event.charger_name,
          connector_id: event.connector_id,
          connector_type: event.connector_type,
          power: event.power,
          session_start: eventTimestamp,
        };
        await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [
          `[REBUILD-FIX] Apertura sesión: ${event.charger_name} - ${event.connector_id} | status: ${event.status} | ts: ${eventTimestamp}`
        ]);
      } else {
        await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [
          `[REBUILD-FIX] Ignorado Charging repetido: ${event.charger_name} - ${event.connector_id} | ts: ${eventTimestamp}`
        ]);
      }
    } else {
      if (lastSession[key]) {
        let session_end = eventTimestamp;
        let session_start = lastSession[key].session_start;
        // Asegurar formato string ISO
        if (typeof session_start === 'number') session_start = new Date(session_start).toISOString();
        if (typeof session_end === 'number') session_end = new Date(session_end).toISOString();
        let duration_minutes = Math.round((new Date(session_end) - new Date(session_start)) / 60000);
        sessionsToInsert.push({
          ...lastSession[key],
          session_end,
          duration_minutes
        });
        await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [
          `[REBUILD-FIX] Cierre sesión: ${event.charger_name} - ${event.connector_id} | status cierre: ${event.status} | ts cierre: ${session_end} | ts apertura: ${session_start} | duración: ${duration_minutes} min`
        ]);
        lastSessionEnd[key] = session_end;
        lastSession[key] = null;
      } else {
        await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [
          `[REBUILD-FIX] Evento de cierre sin sesión abierta: ${event.charger_name} - ${event.connector_id} | status: ${event.status} | ts: ${eventTimestamp}`
        ]);
      }
    }
  }
  // Cierre artificial de sesiones abiertas a los 70 min
  for (const key in lastSession) {
    const sesion = lastSession[key];
    if (sesion) {
      let session_start = sesion.session_start;
      if (typeof session_start === 'number') session_start = new Date(session_start).toISOString();
      const session_end = new Date(new Date(session_start).getTime() + 70 * 60000).toISOString(); // +70 minutos
      const duration_minutes = 70;
      sessionsToInsert.push({
        charger_name: sesion.charger_name,
        connector_id: sesion.connector_id,
        connector_type: sesion.connector_type,
        power: sesion.power,
        session_start,
        session_end,
        duration_minutes
      });
      await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [
        `[REBUILD-FIX] Cierre artificial (70min) para ${sesion.charger_name} - ${sesion.connector_id} | ts apertura: ${session_start} | ts cierre: ${session_end} | duración: ${duration_minutes} min`
      ]);
    }
  }

  // Borrar y reinsertar sesiones
  await pool.query('DELETE FROM connector_sessions');
  for (const s of sessionsToInsert) {
    await pool.query(
      'INSERT INTO connector_sessions (charger_name, connector_id, connector_type, power, session_start, session_end, duration_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [s.charger_name, s.connector_id, s.connector_type, s.power, s.session_start, s.session_end, s.duration_minutes]
    );
  }
  await pool.query('INSERT INTO rebuild_debug_logs (log) VALUES ($1)', [
    `[REBUILD-DEBUG] Sesiones insertadas: ${sessionsToInsert.length}`
  ]);
  return { inserted: sessionsToInsert.length };
}