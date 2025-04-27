console.log('--- Backend iniciado: index.js ---');

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { insertMonitoringRecord } = require('./monitoringRepository');
const pool = require('./db'); // Agregado aquí para que esté disponible en todo el archivo

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// --- Configuración ---
const API_URL = 'https://app.eve-move.com/eve/miem';
const POLL_INTERVAL = 30 * 1000; // 30 segundos

// --- Estructuras en memoria ---
let chargersData = [];
let lastPollTimestamp = null;
let connectorsState = {}; // { chargerName: { connectorId: { state, lastState, lastUpdate, accumulatedMinutes, sessionStart } } }
let sessions = []; // [{ chargerName, connectorId, start, end, durationMinutes }]

function getNow() {
  return Date.now();
}

function minutesBetween(ts1, ts2) {
  return Math.floor((ts2 - ts1) / 60000);
}

function isFastChargerSession(session) {
  const charger = getChargersWithAccumulated().find(
    c => c.name === session.chargerName
  );
  return charger && charger.connectors && charger.connectors.some(conn => conn.power >= 60 && conn.type === session.connectorType);
}

function processChargersWithConnectorId(rawChargers) {
  return rawChargers.map(charger => {
    const chargerName = charger.name;
    const connectors = (charger.cnns || []).map((connector, idx) => {
      const connectorId = `${chargerName}-${connector.type}-${idx}`;
      return {
        ...connector,
        connectorId,
      };
    });
    return {
      ...charger,
      connectors,
    };
  });
}

function updateConnectorsState(newChargers) {
  const now = getNow();
  for (const charger of newChargers) {
    const chargerName = charger.name;
    if (!connectorsState[chargerName]) connectorsState[chargerName] = {};
    (charger.connectors || []).forEach((connector, connectorIndex) => {
      const connectorId = connector.connectorId || `${chargerName}-${connector.type}-${connectorIndex}`;
      if (!connectorsState[chargerName][connectorId]) {
        connectorsState[chargerName][connectorId] = {
          state: connector.status,
          lastState: connector.status,
          lastUpdate: now,
          accumulatedMinutes: 0,
          sessionStart: null,
          accumulatedMinutesDisplay: 0,
        };
      }
      const prev = connectorsState[chargerName][connectorId];
      const newState = connector.status;
      // --- ACTUALIZACIÓN DE MINUTOS ACUMULADOS ---
      // Si termina una sesión, sumar su duración al acumulado
      if (prev.state === 'Charging' && newState !== 'Charging' && prev.sessionStart) {
        const sessionEnd = now;
        const duration = minutesBetween(prev.sessionStart, sessionEnd);
        prev.accumulatedMinutes = (prev.accumulatedMinutes || 0) + duration;
        const sessionObj = {
          chargerName,
          connectorId,
          connectorType: connector.type,
          start: prev.sessionStart,
          end: sessionEnd,
          durationMinutes: duration,
          power: connector.power || null,
        };
        sessions.push(sessionObj);
        // Guardar en PostgreSQL SOLO si power >= 60
        insertMonitoringRecordSafe({
          charger_name: chargerName,
          connector_type: connector.type,
          connector_id: connectorId,
          power: connector.power || null,
          status: 'SessionEnded',
          timestamp: sessionEnd
        }).catch(err => console.error('Error guardando sesión en PostgreSQL:', err));
        prev.sessionStart = null;
      }
      // Si inicia una sesión, no modificar el acumulado
      if (!prev.sessionStart && newState === 'Charging') {
        prev.sessionStart = now;
        // Insertar evento Charging SOLO si power >= 60
        insertMonitoringRecordSafe({
          charger_name: chargerName,
          connector_type: connector.type,
          connector_id: connectorId,
          power: connector.power || null,
          status: 'Charging',
          timestamp: now
        }).catch(err => console.error('Error guardando sesión en PostgreSQL:', err));
      }
      // --- NUEVO: Cierre defensivo ante cambio de estado ---
      if (
        prev.state === 'Charging' &&
        (newState === 'Available' || newState === 'Unavailable')
      ) {
        // Cerrar sesión activa en la base si existe
        pool.query(
          `UPDATE connector_sessions SET session_end = NOW(), duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - session_start))/60), quality = 'FORCED_CLOSE' WHERE charger_name = $1 AND connector_id = $2 AND session_end IS NULL`,
          [chargerName, connectorId]
        ).then(result => {
          if (result.rowCount > 0) {
            console.log(`[DEFENSIVE CLOSE] Sesión forzada cerrada para ${chargerName} - ${connectorId}`);
          }
        }).catch(err => {
          console.error('[DEFENSIVE CLOSE] Error cerrando sesión forzada:', err);
        });
      }
      prev.lastState = prev.state;
      prev.state = newState;
      prev.lastUpdate = now;
    });
  }
  logConnectorStates();
}

function logConnectorStates() {
  console.log('--- Estado actual de connectorsState ---');
  for (const chargerName in connectorsState) {
    for (const connectorId in connectorsState[chargerName]) {
      const state = connectorsState[chargerName][connectorId];
      console.log(`Charger: ${chargerName} | ConnectorId: ${connectorId} | Estado: ${state.state} | sessionStart: ${state.sessionStart} | accumulatedMinutes: ${state.accumulatedMinutes}`);
    }
  }
}

function getChargersWithAccumulated() {
  return chargersData.map(charger => {
    const chargerName = charger.name;
    const connectors = (charger.connectors || []).map(connector => {
      const connectorId = connector.connectorId;
      const stateObj = connectorsState[chargerName]?.[connectorId] || {};
      return {
        ...connector,
        accumulatedMinutes: stateObj.accumulatedMinutesDisplay || 0,
        state: stateObj.state || connector.status,
      };
    });
    return {
      ...charger,
      connectors,
    };
  });
}

function getSessions(filter = {}) {
  let allSessions = [...sessions];
  for (const chargerName in connectorsState) {
    for (const connectorId in connectorsState[chargerName]) {
      const state = connectorsState[chargerName][connectorId];
      if (state.state === 'Charging' && state.sessionStart) {
        allSessions.unshift({
          chargerName,
          connectorId,
          connectorType: getChargersWithAccumulated().find(c => c.name === chargerName).connectors.find(conn => conn.connectorId === connectorId).type,
          start: state.sessionStart,
          end: null,
          durationMinutes: minutesBetween(state.sessionStart, getNow()),
        });
      }
    }
  }
  if (filter.chargerName) allSessions = allSessions.filter(s => s.chargerName === filter.chargerName);
  if (filter.connectorType) allSessions = allSessions.filter(s => s.connectorType === filter.connectorType);
  allSessions.sort((a, b) => (a.end === null ? -1 : 1));
  return allSessions;
}

async function pollChargers() {
  try {
    const res = await fetch(API_URL);
    const contentType = res.headers.get('content-type');
    const text = await res.text();
    let data = null;
    if (contentType && contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('Error al parsear JSON:', e);
      }
    }
    // Procesar y guardar con connectorId
    chargersData = Array.isArray(data) ? processChargersWithConnectorId(data) : [];
    if (chargersData.length > 0) updateConnectorsState(chargersData);
    lastPollTimestamp = getNow();
  } catch (err) {
    console.error('Error consultando la API pública:', err);
  }
}

// --- Cierre automático de sesiones por inactividad de la API ---
setInterval(() => {
  const now = Date.now();
  // Si la última actualización fue hace más de 2 minutos
  if (lastPollTimestamp && now - lastPollTimestamp > 2 * 60 * 1000) {
    console.warn('[INACTIVIDAD API] Cerrando todas las sesiones de carga activas por falta de datos');
    for (const chargerName in connectorsState) {
      for (const connectorId in connectorsState[chargerName]) {
        const state = connectorsState[chargerName][connectorId];
        if (state.state === 'Charging' && state.sessionStart) {
          insertMonitoringRecordSafe({
            charger_name: chargerName,
            connector_type: getChargersWithAccumulated().find(c => c.name === chargerName).connectors.find(conn => conn.connectorId === connectorId).type,
            connector_id: connectorId,
            power: null,
            status: 'SessionEnded',
            timestamp: now
          }).catch(err => console.error('Error cerrando sesión por inactividad:', err));
          state.sessionStart = null;
          state.state = 'Available';
        }
      }
    }
  }
}, 30 * 1000);

// --- Cierre automático de sesiones por timeout o inactividad ---
setInterval(async () => {
  try {
    // 2 horas en minutos
    const MAX_SESSION_MINUTES = 120;
    // 5 minutos de inactividad
    const MAX_INACTIVITY_MINUTES = 5;
    const now = new Date();
    // Buscar sesiones activas
    const { rows: activeSessions } = await pool.query(
      `SELECT id, charger_name, connector_id, session_start, last_heartbeat, EXTRACT(EPOCH FROM (NOW() - session_start))/60 AS elapsed_minutes, EXTRACT(EPOCH FROM (NOW() - last_heartbeat))/60 AS inactivity_minutes
       FROM connector_sessions WHERE session_end IS NULL`
    );
    for (const s of activeSessions) {
      // Cierre por timeout total
      if (s.elapsed_minutes > MAX_SESSION_MINUTES) {
        await pool.query(
          `UPDATE connector_sessions SET session_end = NOW(), duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - session_start))/60), quality = 'SESSION_TIMEOUT' WHERE id = $1`,
          [s.id]
        );
        console.log(`[AUTO-CLOSE] Sesión id ${s.id} cerrada por duración > ${MAX_SESSION_MINUTES} min.`);
        continue;
      }
      // Cierre por inactividad
      if (s.last_heartbeat && s.inactivity_minutes > MAX_INACTIVITY_MINUTES) {
        await pool.query(
          `UPDATE connector_sessions SET session_end = NOW(), duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - session_start))/60), quality = 'INACTIVITY_TIMEOUT' WHERE id = $1`,
          [s.id]
        );
        console.log(`[AUTO-CLOSE] Sesión id ${s.id} cerrada por inactividad > ${MAX_INACTIVITY_MINUTES} min.`);
        continue;
      }
    }
  } catch (err) {
    console.error('[AUTO-CLOSE] Error al cerrar sesiones automáticas:', err);
  }
}, 60 * 1000); // Ejecuta cada minuto

// --- Al iniciar el backend: cerrar y abrir sesiones si corresponde ---
function closeAndOpenChargingSessionsOnStartup() {
  const now = Date.now();
  for (const chargerName in connectorsState) {
    for (const connectorId in connectorsState[chargerName]) {
      const state = connectorsState[chargerName][connectorId];
      if (state.state === 'Charging') {
        // Si hay una sesión previa abierta, cerrarla
        if (state.sessionStart) {
          insertMonitoringRecordSafe({
            charger_name: chargerName,
            connector_type: getChargersWithAccumulated().find(c => c.name === chargerName).connectors.find(conn => conn.connectorId === connectorId).type,
            connector_id: connectorId,
            power: null,
            status: 'SessionEnded',
            timestamp: now
          }).catch(err => console.error('Error cerrando sesión previa al iniciar backend:', err));
          state.sessionStart = null;
          state.state = 'Available';
        }
        // Abrir una nueva sesión Charging
        state.sessionStart = now;
        insertMonitoringRecordSafe({
          charger_name: chargerName,
          connector_type: getChargersWithAccumulated().find(c => c.name === chargerName).connectors.find(conn => conn.connectorId === connectorId).type,
          connector_id: connectorId,
          power: null,
          status: 'Charging',
          timestamp: now
        }).catch(err => console.error('Error abriendo nueva sesión Charging al iniciar backend:', err));
      }
    }
  }
}

// Ejecutar al iniciar el backend
setTimeout(closeAndOpenChargingSessionsOnStartup, 3000); // Espera 3 segundos por si hay inicialización previa

setInterval(pollChargers, POLL_INTERVAL);
pollChargers();

app.get('/api/chargers', (req, res) => {
  console.log('--- /api/chargers llamado ---');
  const allChargers = getChargersWithAccumulated();
  // Filtrar conectores por power >= 60
  const chargersWithFilteredConnectors = allChargers.map(charger => ({
    ...charger,
    connectors: (charger.connectors || []).filter(conn => parseFloat(conn.power) >= 60)
  }));
  const filteredChargers = chargersWithFilteredConnectors.filter(charger => charger.connectors.length > 0);
  // Log de depuración justo antes de enviar la respuesta
  filteredChargers.forEach(charger => {
    console.log('Cargador (RESPUESTA):', charger.name);
    console.log('  connectors (RESPUESTA):', charger.connectors);
  });
  res.json({
    chargers: filteredChargers,
    lastPoll: lastPollTimestamp,
  });
});

app.get('/api/sessions', async (req, res) => {
  try {
    const { chargerName, connectorId } = req.query;
    let query = 'SELECT * FROM connector_sessions WHERE 1=1';
    const params = [];
    if (chargerName) {
      params.push(chargerName);
      query += ` AND charger_name = $${params.length}`;
    }
    if (connectorId) {
      params.push(connectorId);
      query += ` AND connector_id = $${params.length}`;
    }
    query += ' ORDER BY charger_name, connector_id, session_start';
    const { rows } = await pool.query(query, params);
    res.json({ sessions: rows });
  } catch (err) {
    console.error('[sessions] Error:', err);
    res.status(500).json({ sessions: [], error: 'Error al obtener sesiones', details: err.message });
  }
});

app.get('/api/charger-monitoring/export', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM charger_monitoring ORDER BY charger_name, connector_id, timestamp');
    if (!rows.length) return res.status(404).send('No hay datos para exportar');
    const csvHeader = Object.keys(rows[0]).join(',') + '\n';
    const csvRows = rows.map(r => Object.values(r).map(v => (v === null ? '' : `"${String(v).replace(/"/g, '""')}"`)).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="charger_monitoring.csv"');
    res.send(csvHeader + csvRows);
  } catch (err) {
    console.error('[charger-monitoring/export] Error:', err);
    res.status(500).json({ error: 'Error exportando eventos' });
  }
});

// --- Endpoint para limpiar la base de datos (tabla charger_monitoring) ---
app.post('/api/clear-db', async (req, res) => {
  try {
    await pool.query('DELETE FROM charger_monitoring');
    res.json({ success: true, message: 'Base de datos limpiada correctamente.' });
  } catch (err) {
    console.error('Error al limpiar la base de datos:', err);
    res.status(500).json({ success: false, message: 'Error al limpiar la base de datos.', error: err.message });
  }
});

// --- Endpoint para crear la tabla connector_sessions ---
app.post('/api/create-sessions-table', async (req, res) => {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS connector_sessions (
      id SERIAL PRIMARY KEY,
      charger_name VARCHAR(100) NOT NULL,
      connector_id VARCHAR(100) NOT NULL,
      connector_type VARCHAR(50),
      power INTEGER,
      session_start TIMESTAMP NOT NULL,
      session_end TIMESTAMP,
      duration_minutes INTEGER,
      energy_kwh REAL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
  try {
    await pool.query(createTableSQL);
    res.json({ ok: true, message: 'Tabla connector_sessions creada (o ya existía).' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Endpoint temporal para migrar sesiones históricas ---
app.post('/api/migrate-sessions', async (req, res) => {
  try {
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

      // Convertir timestamp a ISO si es número
      let eventTimestamp = event.timestamp;
      if (typeof eventTimestamp === 'number') {
        eventTimestamp = new Date(eventTimestamp).toISOString();
      }

      if (event.status === 'Charging') {
        // Si no hay sesión abierta, abrir una nueva
        if (!lastSession[key]) {
          let session_start = event.timestamp;
          if (typeof session_start === 'number') {
            session_start = new Date(session_start).toISOString();
          }
          lastSession[key] = {
            charger_name: event.charger_name,
            connector_id: event.connector_id,
            connector_type: event.connector_type,
            power: event.power,
            session_start,
          };
        }
        // Si ya hay sesión abierta, ignorar
      } else {
        // Si hay sesión abierta y termina la carga, registrar fin
        if (lastSession[key]) {
          let session_start = lastSession[key].session_start;
          let session_end = event.timestamp;
          if (typeof session_start === 'number') {
            session_start = new Date(session_start).toISOString();
          }
          if (typeof session_end === 'number') {
            session_end = new Date(session_end).toISOString();
          }
          const duration_minutes = Math.round((new Date(session_end) - new Date(session_start)) / 60000);
          sessionsToInsert.push({
            ...lastSession[key],
            session_start,
            session_end,
            duration_minutes
          });
          lastSession[key] = null;
        }
      }
    }

    // 3. Insertar sesiones en la nueva tabla
    let count = 0;
    for (const s of sessionsToInsert) {
      await pool.query(
        `INSERT INTO connector_sessions (charger_name, connector_id, connector_type, power, session_start, session_end, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [s.charger_name, s.connector_id, s.connector_type, s.power, s.session_start, s.session_end, s.duration_minutes]
      );
      count++;
    }

    res.json({ ok: true, migrated: count });
  } catch (err) {
    console.error('Error migrando sesiones:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Endpoint temporal para crear índice único parcial en connector_sessions ---
app.post('/api/create-unique-index-sessions', async (req, res) => {
  try {
    const sql = `CREATE UNIQUE INDEX IF NOT EXISTS unique_active_session
      ON connector_sessions (charger_name, connector_id)
      WHERE session_end IS NULL;`;
    await pool.query(sql);
    res.json({ ok: true, message: 'Índice único parcial creado correctamente.' });
  } catch (err) {
    console.error('Error creando índice único parcial:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Nuevo endpoint para obtener resumen de sesiones por conector ---
app.get('/api/connector-sessions/summary', async (req, res) => {
  try {
    // Traer todas las sesiones activas
    const { rows: activeSessions } = await pool.query(`
      SELECT * FROM connector_sessions WHERE session_end IS NULL
    `);
    // Traer la última sesión cerrada para cada conector
    const { rows: lastSessions } = await pool.query(`
      SELECT DISTINCT ON (charger_name, connector_id)
        charger_name, connector_id, connector_type, power, session_start, session_end, duration_minutes
      FROM connector_sessions
      WHERE session_end IS NOT NULL
      ORDER BY charger_name, connector_id, session_end DESC
    `);
    // Armar mapa para fácil acceso
    const summary = {};
    // Primero, poner sesiones activas
    for (const s of activeSessions) {
      summary[`${s.charger_name}|${s.connector_id}`] = {
        charger_name: s.charger_name,
        connector_id: s.connector_id,
        connector_type: s.connector_type,
        power: s.power,
        active: true,
        session_start: s.session_start,
        session_end: null,
        duration_minutes: null
      };
    }
    // Luego, para los que no están activos, agregar la última sesión cerrada
    for (const s of lastSessions) {
      const key = `${s.charger_name}|${s.connector_id}`;
      if (!summary[key]) {
        summary[key] = {
          charger_name: s.charger_name,
          connector_id: s.connector_id,
          connector_type: s.connector_type,
          power: s.power,
          active: false,
          session_start: s.session_start,
          session_end: s.session_end,
          duration_minutes: s.duration_minutes
        };
      }
    }
    // Responder como array
    res.json(Object.values(summary));
  } catch (err) {
    console.error('[connector-sessions/summary] Error:', err);
    res.status(500).json({ error: 'Error obteniendo resumen de sesiones' });
  }
});

// --- Exportar sesiones de conectores en CSV ---
app.get('/api/connector-sessions/export', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM connector_sessions ORDER BY charger_name, connector_id, session_start');
    if (!rows.length) return res.status(404).send('No hay datos para exportar');
    const csvHeader = Object.keys(rows[0]).join(',') + '\n';
    const csvRows = rows.map(r => Object.values(r).map(v => (v === null ? '' : `"${String(v).replace(/"/g, '""')}"`)).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="connector_sessions.csv"');
    res.send(csvHeader + csvRows);
  } catch (err) {
    console.error('[connector-sessions/export] Error:', err);
    res.status(500).json({ error: 'Error exportando sesiones' });
  }
});

// --- Exportar cargadores y conectores en CSV ---
app.get('/api/chargers/export', async (req, res) => {
  try {
    // Suponemos que chargersData está actualizado en memoria
    if (!chargersData.length) return res.status(404).send('No hay datos de cargadores');
    // Aplanar cargadores y conectores
    const flat = chargersData.flatMap(charger =>
      (charger.connectors || []).map(conn => ({
        charger_name: charger.name,
        charger_location: charger.location || '',
        connector_id: conn.connectorId,
        connector_type: conn.type,
        power: conn.power,
        status: conn.status
      }))
    );
    if (!flat.length) return res.status(404).send('No hay conectores para exportar');
    const csvHeader = Object.keys(flat[0]).join(',') + '\n';
    const csvRows = flat.map(r => Object.values(r).map(v => (v === null ? '' : `"${String(v).replace(/"/g, '""')}"`)).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="chargers_connectors.csv"');
    res.send(csvHeader + csvRows);
  } catch (err) {
    console.error('[chargers/export] Error:', err);
    res.status(500).json({ error: 'Error exportando cargadores' });
  }
});

// --- Endpoint para actualizar el heartbeat de una sesión activa ---
app.post('/api/heartbeat', async (req, res) => {
  try {
    const { charger_name, connector_id } = req.body;
    if (!charger_name || !connector_id) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros charger_name o connector_id' });
    }
    // Actualizar last_heartbeat de la sesión activa
    const result = await pool.query(
      `UPDATE connector_sessions
       SET last_heartbeat = NOW()
       WHERE charger_name = $1 AND connector_id = $2 AND session_end IS NULL
       RETURNING *`,
      [charger_name, connector_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'No hay sesión activa para este conector.' });
    }
    res.json({ ok: true, updated: result.rows[0] });
  } catch (err) {
    console.error('[heartbeat] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Endpoint temporal para depurar y etiquetar sesiones ---
app.post('/api/sessions/cleanup', async (req, res) => {
  try {
    // 1. Agregar columnas si no existen
    await pool.query(`ALTER TABLE connector_sessions
      ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS quality VARCHAR(20) NULL DEFAULT NULL;`);

    // 2. Cerrar sesiones abiertas
    const closeOpen = await pool.query(`UPDATE connector_sessions
      SET session_end = NOW(),
          duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - session_start)) / 60),
          quality = COALESCE(quality, 'FORCED_CLOSE')
      WHERE session_end IS NULL
      RETURNING id;`);

    // 3. Corregir sesiones demasiado largas (8h < dur <= 24h)
    const tooLong = await pool.query(`UPDATE connector_sessions
      SET quality = 'TOO_LONG'
      WHERE duration_minutes > 480 AND duration_minutes <= 1440
      RETURNING id;`);

    // 4. Invalidar sesiones absurdas (negativas, cero, o >24h)
    const invalid = await pool.query(`UPDATE connector_sessions
      SET quality = 'INVALID'
      WHERE duration_minutes <= 0 OR duration_minutes > 1440
      RETURNING id;`);

    // 5. Etiquetar sesiones normales
    const ok = await pool.query(`UPDATE connector_sessions
      SET quality = 'OK'
      WHERE duration_minutes > 0 AND duration_minutes <= 480
      RETURNING id;`);

    res.json({
      ok: true,
      closed_open_sessions: closeOpen.rowCount,
      too_long: tooLong.rowCount,
      invalid: invalid.rowCount,
      ok_quality: ok.rowCount
    });
  } catch (err) {
    console.error('[sessions/cleanup] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Filtrar conectores lentos en inserciones y guardar sesión en connector_sessions ---
async function insertMonitoringRecordSafe({ charger_name, connector_type, connector_id, power, status, timestamp }) {
  console.log('[insertMonitoringRecordSafe] llamado con:', { charger_name, connector_type, connector_id, power, status, timestamp });
  console.log(`[insertMonitoringRecordSafe] charger_name: '${charger_name}'`);
  console.log(`[insertMonitoringRecordSafe] connector_type: '${connector_type}'`);
  console.log(`[insertMonitoringRecordSafe] connector_id: '${connector_id}'`);
  console.log(`[insertMonitoringRecordSafe] power: '${power}'`);
  console.log(`[insertMonitoringRecordSafe] status: '${status}'`);
  console.log(`[insertMonitoringRecordSafe] timestamp: '${timestamp}'`);
  if (typeof power === 'string') power = parseFloat(power);
  if (power < 60) {
    console.log('[insertMonitoringRecordSafe] Potencia menor a 60, no se guarda.');
    return Promise.resolve(); // No guardar eventos de conectores lentos
  }
  // Guardar en charger_monitoring como log histórico
  await insertMonitoringRecord({ charger_name, connector_type, connector_id, power, status, timestamp });

  // --- Nueva lógica: guardar o actualizar sesión en connector_sessions ---
  if (status === 'Charging') {
    console.log(`[insertMonitoringRecordSafe] Intentando insertar nueva sesión en connector_sessions para ${charger_name} - ${connector_id}`);
    // Nueva lógica: SELECT previo y solo insertar si no existe sesión activa
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM connector_sessions WHERE charger_name = $1 AND connector_id = $2 AND session_end IS NULL`,
      [charger_name, connector_id]
    );
    if (existing.length === 0) {
      try {
        const result = await pool.query(
          `INSERT INTO connector_sessions (charger_name, connector_id, connector_type, power, session_start, last_heartbeat)
           VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($5 / 1000.0)) RETURNING *`,
          [charger_name, connector_id, connector_type, power, timestamp]
        );
        console.log('[insertMonitoringRecordSafe] INSERT exitoso:', result.rows);
      } catch (err) {
        console.error('[insertMonitoringRecordSafe] Error al insertar sesión:', err);
      }
    } else {
      console.log('[insertMonitoringRecordSafe] Ya existe sesión activa, no se inserta.');
    }
  } else if (status === 'SessionEnded') {
    console.log(`[insertMonitoringRecordSafe] Intentando cerrar sesión en connector_sessions para ${charger_name} - ${connector_id}`);
    const res = await pool.query(
      `UPDATE connector_sessions
       SET session_end = to_timestamp($1 / 1000.0),
           duration_minutes = ROUND(EXTRACT(EPOCH FROM (to_timestamp($1 / 1000.0) - session_start)) / 60)
       WHERE charger_name = $2 AND connector_id = $3 AND session_end IS NULL
       RETURNING *`,
      [timestamp, charger_name, connector_id]
    );
    console.log('[insertMonitoringRecordSafe] Resultado UPDATE:', res.rows);
    if (res.rowCount === 0) {
      console.warn('[insertMonitoringRecordSafe] No se encontró sesión activa para cerrar.');
    }
  }
}

app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
});
