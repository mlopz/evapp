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
app.use(express.json({ limit: '20mb' }));

// --- Configuración ---
const API_URL = 'https://app.eve-move.com/eve/miem';
const POLL_INTERVAL = 30 * 1000; // 30 segundos

// --- Estructuras en memoria ---
let chargersData = [];
let lastPollTimestamp = null;
let connectorsState = {}; // { chargerName: { connectorId: { state, lastState, lastUpdate, accumulatedMinutes, sessionStart } } }
let sessions = []; // [{ chargerName, connectorId, start, end, durationMinutes }]

function getNow() {
  // Siempre retorna segundos (entero)
  return Math.floor(Date.now() / 1000);
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
  // Llamar a la rutina de verificación al inicio
  // Si tienes una lista de cargadores esperados, pásala como segundo argumento
  // Ejemplo: verificarMonitoreoCargadores(newChargers, ['Cargador1', 'Cargador2', ...]);
  verificarMonitoreoCargadores(newChargers);
  for (const charger of newChargers) {
    const chargerName = charger.name;
    if (!connectorsState[chargerName]) connectorsState[chargerName] = {};
    (charger.connectors || []).forEach((connector, connectorIndex) => {
      const connectorId = connector.connectorId || `${chargerName}-${connector.type}-${connectorIndex}`;
      // IGNORAR CARGADORES LENTOS
      if (!shouldProcessConnector(connectorId)) return;
      if (!connectorsState[chargerName][connectorId]) {
        connectorsState[chargerName][connectorId] = {
          state: connector.status,
          lastState: null,
          lastUpdate: now,
          accumulatedMinutes: 0,
          sessionStart: null,
        };
      }
      const prev = connectorsState[chargerName][connectorId];
      const newState = connector.status;
      // SOLO lógica de registro real, SIN cierre automático
      // --- NUEVO: Detectar cierre de sesión ---
      if (prev.state === 'Charging' && newState !== 'Charging') {
        console.log(`[MONITORING] Detectado cierre de sesión: ${chargerName} | ${connectorId} | ${connector.type} | ${connector.power} | ${now}`);
        insertMonitoringRecordSafe({
          charger_name: chargerName,
          connector_type: getChargersWithAccumulated().find(c => c.name === chargerName).connectors.find(conn => conn.connectorId === connectorId).type,
          connector_id: connectorId,
          power: connector.power,
          status: 'SessionEnded',
          timestamp: now,
          reason: 'session_end'
        }).catch(err => console.error('Error insertando SessionEnded:', err));
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
  console.log(`[AUDITORÍA] Ejecutando pollChargers a las ${new Date().toLocaleString()}`);
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
    chargersData = Array.isArray(data) ? processChargersWithConnectorId(data) : [];
    if (chargersData.length > 0) {
      console.log(`[AUDITORÍA] pollChargers recibió ${chargersData.length} cargadores`);
      updateConnectorsState(chargersData);
    } else {
      console.warn('[AUDITORÍA] pollChargers no recibió datos de cargadores');
    }
    lastPollTimestamp = getNow();
  } catch (err) {
    console.error('Error consultando la API pública:', err);
  }
}

// --- Variable global para el último resultado de verificación ---
let lastMonitoringVerification = null;

// --- Rutina de verificación de monitoreo ---
function verificarMonitoreoCargadores(newChargers, expectedChargers = []) {
  const now = getNow();
  // A. Loguear el total de cargadores y conectores procesados
  const cargadoresRecibidos = newChargers.length;
  let totalConectores = 0;
  const detalleCargadores = [];
  newChargers.forEach(charger => {
    const count = (charger.connectors || []).length;
    totalConectores += count;
    detalleCargadores.push({ name: charger.name, conectores: count });
  });

  // B. Detectar cargadores faltantes
  let faltantes = [];
  if (expectedChargers.length > 0) {
    const receivedNames = newChargers.map(c => c.name);
    faltantes = expectedChargers.filter(name => !receivedNames.includes(name));
  }

  // C. Detectar conectores inactivos
  const conectoresInactivos = [];
  for (const chargerName in connectorsState) {
    for (const connectorId in connectorsState[chargerName]) {
      const state = connectorsState[chargerName][connectorId];
      const minutosSinCambio = (now - state.lastUpdate) / 60;
      if (minutosSinCambio > 120) { // 2 horas sin cambio
        conectoresInactivos.push({
          chargerName,
          connectorId,
          minutosSinCambio: minutosSinCambio.toFixed(1)
        });
      }
    }
  }

  // Guardar el resultado global
  lastMonitoringVerification = {
    timestamp: now,
    cargadoresRecibidos,
    totalConectores,
    detalleCargadores,
    faltantes,
    conectoresInactivos
  };

  // Logs para consola
  console.log(`[MONITORING-VERIFICACION] Cargadores recibidos: ${cargadoresRecibidos}`);
  detalleCargadores.forEach(c => console.log(`[MONITORING-VERIFICACION] ${c.name}: ${c.conectores} conectores`));
  console.log(`[MONITORING-VERIFICACION] Total conectores procesados: ${totalConectores}`);
  if (faltantes.length > 0) {
    console.warn(`[MONITORING-VERIFICACION] FALTAN cargadores: ${faltantes.join(', ')}`);
  }
  conectoresInactivos.forEach(c => console.warn(`[MONITORING-VERIFICACION] Conector inactivo hace ${c.minutosSinCambio} minutos: ${c.chargerName} | ${c.connectorId}`));
}

// --- Endpoint para exponer el resultado de verificación ---
app.get('/api/monitoring-verification', (req, res) => {
  if (!lastMonitoringVerification) {
    // Siempre responde JSON, nunca vacío ni HTML
    return res.status(404).json({ error: 'Aún no hay datos de verificación.' });
  }
  res.set('Content-Type', 'application/json');
  res.json(lastMonitoringVerification);
});

// --- Al iniciar el backend: sincronizar estado antes de cerrar/abrir sesiones ---
async function syncAndCloseAndOpenChargingSessionsOnStartup() {
  console.log('--- [SYNC] Sincronizando estado inicial desde la API antes de gestionar sesiones ---');
  await pollChargers(); // Espera a que pollChargers actualice chargersData y connectorsState
  setTimeout(() => {
    closeAndOpenChargingSessionsOnStartup();
  }, 1000); // Espera 1 segundo extra para asegurar actualización en memoria
}

// Reemplazar el setTimeout existente para usar la versión robusta
setTimeout(syncAndCloseAndOpenChargingSessionsOnStartup, 2000); // Menor espera porque pollChargers es await

function closeAndOpenChargingSessionsOnStartup() {
  const now = getNow();
  let closed = 0;
  let opened = 0;
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
            timestamp: now,
            reason: 'backend_restart'
          }).catch(err => console.error('Error cerrando sesión previa al iniciar backend:', err));
          state.sessionStart = null;
          state.state = 'Available';
          closed++;
        }
        // Abrir una nueva sesión Charging
        state.sessionStart = now;
        insertMonitoringRecordSafe({
          charger_name: chargerName,
          connector_type: getChargersWithAccumulated().find(c => c.name === chargerName).connectors.find(conn => conn.connectorId === connectorId).type,
          connector_id: connectorId,
          power: null,
          status: 'Charging',
          timestamp: now,
          reason: 'backend_restart'
        }).catch(err => console.error('Error abriendo nueva sesión Charging al iniciar backend:', err));
        opened++;
      }
    }
  }
  console.log(`[REINICIO] Sesiones cerradas: ${closed}, sesiones abiertas: ${opened}`);
}

// --- Cierre automático de sesiones por inactividad de la API ---
setInterval(pollChargers, POLL_INTERVAL);
pollChargers();

app.use(require('./rentabilidad_api'));

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

// --- ENDPOINT TEMPORAL: Listar sesiones para frontend ---
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
app.post('/api/create-connector-sessions-table', async (req, res) => {
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
      last_heartbeat TIMESTAMP,
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
// (ELIMINADO COMPLETAMENTE)

// --- ENDPOINT: Estadísticas globales de sesiones (solo conectores activos: power >= 60) ---
app.get('/api/sessions/stats', async (req, res) => {
  try {
    const { from, to, charger_name, connector_id } = req.query;
    let where = "WHERE duration_minutes IS NOT NULL";
    let params = [];
    if (from) {
      params.push(from);
      where += ` AND session_start >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      where += ` AND session_start <= $${params.length}`;
    }
    if (connector_id) {
      params.push(connector_id);
      where += ` AND connector_id = $${params.length}`;
    }
    // Solo filtrar por conectores activos si se consulta por cargador
    if (charger_name && !connector_id) {
      // Buscar los connector_id activos (power >= 60) de ese cargador
      const activeConnectors = await pool.query(
        `SELECT DISTINCT connector_id FROM connector_sessions WHERE charger_name = $1 AND power >= 60` ,
        [charger_name]
      );
      const ids = activeConnectors.rows.map(r => r.connector_id).filter(Boolean);
      if (ids.length === 0) {
        return res.json({ total_sessions: 0, total_minutes: 0 });
      }
      params.push(charger_name);
      where += ` AND charger_name = $${params.length}`;
      // Agregar filtro por lista de connector_id activos
      where += ` AND connector_id = ANY($${params.length + 1})`;
      params.push(ids);
    } else if (charger_name) {
      params.push(charger_name);
      where += ` AND charger_name = $${params.length}`;
    }
    const stats = await pool.query(
      `SELECT COUNT(*) AS total_sessions, COALESCE(SUM(duration_minutes),0) AS total_minutes FROM connector_sessions ${where}`,
      params
    );
    res.json({
      total_sessions: parseInt(stats.rows[0].total_sessions, 10),
      total_minutes: parseInt(stats.rows[0].total_minutes, 10)
    });
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

app.get('/api/fast-chargers/status', async (req, res) => {
  try {
    // Leer los IDs de fast chargers
    const fastChargersArr = Array.from(fastConnectorIds);
    // Suponiendo que chargersData está actualizado en memoria
    // Mapear todos los cargadores y conectores filtrando solo los rápidos
    const result = [];
    for (const charger of chargersData) {
      for (const conn of (charger.connectors || [])) {
        const connectorId = conn.connectorId || `${charger.name}-${conn.type}-${conn.index || 0}`;
        if (fastConnectorIds.has(connectorId)) {
          result.push({
            connector_id: connectorId,
            charger_name: charger.name,
            estado: conn.status || (connectorsState[charger.name]?.[connectorId]?.state) || 'Desconocido',
            power: conn.power,
            connector_type: conn.type,
            lat: charger.latitude || (charger.location && charger.location.latitude) || null,
            lon: charger.longitude || (charger.location && charger.location.longitude) || null
          });
        }
      }
    }
    res.json({ chargers: result });
  } catch (err) {
    console.error('[fast-chargers/status] Error:', err);
    res.status(500).json({ error: 'Error obteniendo estado de cargadores rápidos' });
  }
});

// Endpoint temporal para debug: ver el contenido real de fast_chargers.json
app.get('/api/debug/fast-chargers-json', (req, res) => {
  try {
    const fastChargers = require('./fast_chargers.json');
    res.json(fastChargers);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo leer el archivo fast_chargers.json', details: e.message });
  }
});

// --- INICIO: Protección ante reinicio del backend y registro de fallas ---
const initBackendProtection = async () => {
  try {
    // 1. Buscar el último timestamp en charger_monitoring
    const { rows: lastEventRows } = await pool.query('SELECT MAX(timestamp) as last_ts FROM charger_monitoring');
    const lastTimestamp = lastEventRows[0]?.last_ts;
    if (!lastTimestamp) {
      console.log('No hay eventos en charger_monitoring. No se requiere cierre de sesiones.');
      return;
    }

    // 2. Buscar sesiones abiertas
    const { rows: openSessions } = await pool.query('SELECT * FROM connector_sessions WHERE session_end IS NULL');
    if (openSessions.length > 0) {
      for (const session of openSessions) {
        await pool.query('UPDATE connector_sessions SET session_end = $1 WHERE id = $2', [toISODateSafe(lastTimestamp), session.id]);
      }
      console.log(`Cerradas ${openSessions.length} sesiones abiertas hasta ${toISODateSafe(lastTimestamp)}`);
    }

    // 3. Registrar incidente de reinicio
    await pool.query(
      `CREATE TABLE IF NOT EXISTS backend_failures (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        type VARCHAR(50) NOT NULL,
        details TEXT
      )`
    );
    await pool.query(
      'INSERT INTO backend_failures (type, details) VALUES ($1, $2)',
      ['BACKEND_RESTART', `Cerradas ${openSessions.length} sesiones abiertas hasta ${toISODateSafe(lastTimestamp)}`]
    );
    console.log('Incidente de reinicio registrado en backend_failures.');
  } catch (err) {
    console.error('Error en la protección de backend:', err);
    // Registrar el error como incidente
    try {
      await pool.query('INSERT INTO backend_failures (type, details) VALUES ($1, $2)', ['BACKEND_PROTECTION_ERROR', err.toString()]);
    } catch (e2) {
      console.error('Error registrando el incidente de protección:', e2);
    }
  }
};

// Llamar a la función de protección antes de iniciar el polling normal
(async () => {
  await initBackendProtection();
  // ... aquí continúa el arranque normal del backend ...
  app.listen(PORT, () => {
    console.log(`Servidor backend escuchando en puerto ${PORT}`);
  });
})();

// --- CARGA DE CARGADORES RAPIDOS ---
const fs = require('fs');
let fastConnectorIds = new Set();
try {
  const fastChargersRaw = fs.readFileSync('./fast_chargers.json', 'utf-8');
  const fastChargersArr = JSON.parse(fastChargersRaw);
  fastConnectorIds = new Set(fastChargersArr);
  console.log(`[FAST CHARGERS] Cargados ${fastConnectorIds.size} connectors rápidos.`);
} catch (err) {
  console.error('[FAST CHARGERS] Error al cargar fast_chargers.json:', err);
}

function shouldProcessConnector(connectorId) {
  return fastConnectorIds.has(connectorId);
}

// --- MODIFICAR insertMonitoringRecordSafe PARA ACTUALIZAR HEARTBEAT SI YA EXISTE SESION ACTIVA ---
async function insertMonitoringRecordSafe({ charger_name, connector_type, connector_id, power, status, timestamp, reason = 'state_change' }) {
  // FILTRO: ignorar si no es rápido
  if (!shouldProcessConnector(connectorId)) return;
  if (typeof power === 'string') power = parseFloat(power);
  // --- DEFENSIVO: asegurar timestamp en segundos ---
  if (typeof timestamp === 'number') {
    if (timestamp > 1e12) {
      // Si viene en milisegundos, pasar a segundos
      timestamp = Math.floor(timestamp / 1000);
    } else if (timestamp > 1e10) {
      // Si es un número muy grande pero menor a 1e12, probablemente error de conversión
      console.warn('[insertMonitoringRecordSafe] Timestamp sospechoso:', timestamp);
      timestamp = Math.floor(timestamp / 1000);
    }
  } else {
    // Si viene como string, intentar parsear
    const tNum = Number(timestamp);
    if (!isNaN(tNum)) {
      timestamp = tNum > 1e12 ? Math.floor(tNum / 1000) : Math.floor(tNum);
    } else {
      console.warn('[insertMonitoringRecordSafe] Timestamp no numérico:', timestamp);
      return;
    }
  }
  // Guardar en charger_monitoring como log histórico SOLO si es rápido
  await insertMonitoringRecord({ charger_name, connector_type, connector_id, power, status, timestamp, reason });

  // Solo registrar sesión cuando status es 'SessionEnded'
  if (status === 'SessionEnded') {
    // Buscar sesión activa
    const res = await pool.query(
      `SELECT id, session_start FROM connector_sessions WHERE charger_name = $1 AND connector_id = $2 AND session_end IS NULL ORDER BY session_start DESC LIMIT 1`,
      [charger_name, connector_id]
    );
    if (res.rows.length === 0) return;
    let session_start = res.rows[0].session_start;
    let session_end = new Date(timestamp);
    let duration_minutes = Math.round((session_end - new Date(session_start)) / 60000);
    // Si la duración es mayor a 90 minutos, guardar como 70
    if (duration_minutes > 90) duration_minutes = 70;
    // Si la duración es menor a 5 minutos, eliminar la sesión
    if (duration_minutes < 5) {
      await pool.query('DELETE FROM connector_sessions WHERE id = $1', [res.rows[0].id]);
      console.log(`[AUTO-CLEAN] Sesión id ${res.rows[0].id} eliminada por ser < 5 min.`);
      return;
    }
    await pool.query(
      `UPDATE connector_sessions SET session_end = $1, duration_minutes = $2, quality = NULL WHERE id = $3`,
      [session_end, duration_minutes, res.rows[0].id]
    );
    return;
  }
  // Si es 'Charging', crear nueva sesión solo si no existe una activa
  if (status === 'Charging') {
    const res = await pool.query(
      `SELECT id FROM connector_sessions WHERE charger_name = $1 AND connector_id = $2 AND session_end IS NULL`,
      [charger_name, connector_id]
    );
    if (res.rows.length === 0) {
      let sessionStartISO = toISODateSafe(timestamp);
      if (!sessionStartISO) return; // No registrar si la fecha es inválida
      await pool.query(
        `INSERT INTO connector_sessions (charger_name, connector_id, connector_type, power, session_start)
         VALUES ($1, $2, $3, $4, $5)`,
        [charger_name, connector_id, connector_type, power, sessionStartISO]
      );
    }
    return;
  }
}

// --- Función robusta para convertir cualquier timestamp a string ISO seguro ---
function toISODateSafe(ts) {
  if (typeof ts === 'number') {
    // Si es muy grande, probablemente milisegundos
    if (ts > 1e12) ts = Math.floor(ts / 1000);
    return new Date(ts * 1000).toISOString();
  }
  if (typeof ts === 'string') {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

const rebuildConnectorSessions = require('./lib/rebuildConnectorSessions');

// --- Endpoint para reconstruir tabla connector_sessions desde charger_monitoring (ONE-TIME) ---
app.post('/api/rebuild-connector-sessions', async (req, res) => {
  try {
    const result = await rebuildConnectorSessions(pool, { cleanDebugLogs: true });
    res.json({ ok: true, message: `Reconstrucción completada: ${result.inserted} sesiones insertadas.` });
  } catch (err) {
    console.error('Error reconstruyendo connector_sessions:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Scheduler automático para el rebuild de sesiones cada 60 minutos ---
const REBUILD_INTERVAL = 60 * 60 * 1000; // 60 minutos
setInterval(() => {
  rebuildConnectorSessions(pool, { cleanDebugLogs: false })
    .then(result => console.log(`[REBUILD] Ejecutado automáticamente. Sesiones insertadas: ${result.inserted}`))
    .catch(err => console.error('[REBUILD] Error en ejecución automática:', err));
}, REBUILD_INTERVAL);

// --- ENDPOINT PARA INCIDENTES DEL BACKEND ---
app.get('/api/backend-failures', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM backend_failures ORDER BY timestamp DESC LIMIT 7');
    res.json({ ok: true, incidents: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

// --- Exportar la función para uso en otros módulos si es necesario ---
module.exports = {
  toISODateSafe,
  insertMonitoringRecordSafe,
  initBackendProtection
};

// --- ENDPOINT PARA OBTENER SESIONES FILTRADAS POR FECHA ---
app.get('/api/connector-sessions', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'Parámetros from y to requeridos' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM connector_sessions WHERE session_start >= $1 AND session_end <= $2 ORDER BY session_start ASC',
      [from, to]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

const { insertMonitoringRecordSafe } = require('./monitoringRepository');
insertMonitoringRecordSafe({
  charger_name: 'BACKEND',
  connector_type: null,
  connector_id: null,
  power: null,
  status: 'backend_restart',
  timestamp: Date.now(),
  reason: 'backend_restart'
});
console.log('[AUDITORÍA] Evento backend_restart registrado en base de datos');
