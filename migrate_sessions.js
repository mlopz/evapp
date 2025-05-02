const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrateSessions() {
  // 1. Obtener todos los eventos ordenados (sin filtrar por potencia)
  const { rows: events } = await pool.query(
    `SELECT * FROM charger_monitoring
     ORDER BY charger_name, connector_id, timestamp`
  );

  // 2. Agrupar por conector
  const sessionsToInsert = [];
  let lastSession = {};
  let lastSessionEnd = {}; // NUEVO: para guardar el último session_end por key

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
        lastSessionEnd[key] = session_end; // Actualizar último cierre
        lastSession[key] = null;
      } else {
        // --- NUEVO: cierre sin sesión abierta ---
        // Buscar la última session_end
        const session_end = new Date(event.timestamp);
        const prev_end = lastSessionEnd[key] ? new Date(lastSessionEnd[key]) : null;
        let session_start, duration_minutes;
        if (prev_end && (session_end - prev_end) / 60000 < 70) {
          // Menos de 70 minutos desde el cierre anterior
          session_start = new Date(prev_end.getTime() + 10 * 60000); // +10 min
          duration_minutes = Math.round((session_end - session_start) / 60000);
          if (duration_minutes < 1) duration_minutes = 1; // evitar duración negativa o cero
        } else {
          // Más de 70 minutos o no hay cierre previo
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
        lastSessionEnd[key] = session_end.toISOString(); // Actualizar último cierre
        // Log para trazabilidad
        console.log(`Cierre sin inicio: ${event.charger_name} - ${event.connector_id} (${event.timestamp}) inicio artificial: ${session_start.toISOString()} duración: ${duration_minutes}`);
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

  // --- CIERRE DE SEGURIDAD: cerrar sesiones abiertas a los 70 minutos ---
  for (const key in lastSession) {
    const sesion = lastSession[key];
    if (sesion) {
      const session_start = new Date(sesion.session_start);
      const session_end = new Date(session_start.getTime() + 70 * 60000); // +70 minutos
      await pool.query(
        `INSERT INTO connector_sessions (charger_name, connector_id, connector_type, power, session_start, session_end, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sesion.charger_name, sesion.connector_id, sesion.connector_type, sesion.power, session_start.toISOString(), session_end.toISOString(), 70]
      );
      console.log(`Cierre de seguridad: sesión abierta para ${sesion.charger_name} - ${sesion.connector_id} cerrada a los 70 minutos.`);
    }
  }

  console.log(`Migradas ${sessionsToInsert.length} sesiones + cierres de seguridad.`);
  await pool.end();
}

migrateSessions().catch(err => {
  console.error('Error migrando sesiones:', err);
});
