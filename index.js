require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { insertMonitoringRecord } = require('./monitoringRepository');

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
let connectorsState = {}; // { chargerName: { connectorType: { state, lastState, lastUpdate, accumulatedMinutes, sessionStart } } }
let sessions = []; // [{ chargerName, connectorType, start, end, durationMinutes }]

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

function updateConnectorsState(newChargers) {
  const now = getNow();
  for (const charger of newChargers) {
    const chargerName = charger.name;
    if (!connectorsState[chargerName]) connectorsState[chargerName] = {};
    (charger.cnns || []).forEach((connector, connectorIndex) => {
      const connectorType = connector.type;
      if (!connectorsState[chargerName][connectorIndex]) {
        connectorsState[chargerName][connectorIndex] = {
          state: connector.status,
          lastState: connector.status,
          lastUpdate: now,
          accumulatedMinutes: 0,
          sessionStart: null,
        };
      } else {
        const prev = connectorsState[chargerName][connectorIndex];
        const newState = connector.status;
        if (prev.state === 'Charging' && newState !== 'Charging' && prev.sessionStart) {
          const sessionEnd = now;
          const duration = minutesBetween(prev.sessionStart, sessionEnd);
          const sessionObj = {
            chargerName,
            connectorIndex,
            connectorType,
            start: prev.sessionStart,
            end: sessionEnd,
            durationMinutes: duration,
            power: connector.power || null,
          };
          sessions.push(sessionObj);
          // Guardar en PostgreSQL
          insertMonitoringRecord({
            charger_name: chargerName,
            connector_type: connectorType,
            power: connector.power || null,
            status: 'SessionEnded',
            timestamp: sessionEnd
          }).catch(err => console.error('Error guardando sesión en PostgreSQL:', err));
          prev.sessionStart = null;
        }
        if (!prev.sessionStart && newState === 'Charging') {
          prev.sessionStart = now;
          // Insertar evento Charging en la base de datos
          insertMonitoringRecord({
            charger_name: chargerName,
            connector_type: connectorType,
            power: connector.power || null,
            status: 'Charging',
            timestamp: now
          }).catch(err => console.error('Error guardando evento Charging en PostgreSQL:', err));
        }
        prev.lastState = prev.state;
        prev.state = newState;
        prev.lastUpdate = now;
      }
    });
  }
}

function getChargersWithAccumulated() {
  return chargersData.map(charger => {
    const chargerName = charger.name;
    const connectors = (charger.cnns || []).map(connector => {
      const connectorType = connector.type;
      const stateObj = connectorsState[chargerName]?.[connectorType] || {};
      return {
        ...connector,
        accumulatedMinutes: stateObj.accumulatedMinutes || 0,
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
    for (const connectorType in connectorsState[chargerName]) {
      const state = connectorsState[chargerName][connectorType];
      if (state.state === 'Charging' && state.sessionStart) {
        allSessions.unshift({
          chargerName,
          connectorType,
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
    chargersData = Array.isArray(data) ? data : [];
    if (data) updateConnectorsState(chargersData);
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
      for (const connectorType in connectorsState[chargerName]) {
        const state = connectorsState[chargerName][connectorType];
        if (state.state === 'Charging' && state.sessionStart) {
          insertMonitoringRecord({
            charger_name: chargerName,
            connector_type: connectorType,
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

// --- Al iniciar el backend: cerrar y abrir sesiones si corresponde ---
function closeAndOpenChargingSessionsOnStartup() {
  const now = Date.now();
  for (const chargerName in connectorsState) {
    for (const connectorType in connectorsState[chargerName]) {
      const state = connectorsState[chargerName][connectorType];
      if (state.state === 'Charging') {
        // Si hay una sesión previa abierta, cerrarla
        if (state.sessionStart) {
          insertMonitoringRecord({
            charger_name: chargerName,
            connector_type: connectorType,
            power: null,
            status: 'SessionEnded',
            timestamp: now
          }).catch(err => console.error('Error cerrando sesión previa al iniciar backend:', err));
        }
        // Abrir una nueva sesión Charging
        state.sessionStart = now;
        insertMonitoringRecord({
          charger_name: chargerName,
          connector_type: connectorType,
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
  const chargersWithFilteredConnectors = allChargers.map(charger => ({
    ...charger,
    connectors: (charger.connectors || []).filter(conn => conn.power >= 60)
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
  console.log('--- /api/sessions request (agrupando sesiones) ---');
  try {
    const { chargerName, connectorType } = req.query;
    console.log('Parámetros recibidos:', { chargerName, connectorType });
    const pool = require('./db');
    let query = 'SELECT * FROM charger_monitoring WHERE 1=1';
    const params = [];
    if (chargerName) {
      params.push(chargerName);
      query += ` AND charger_name = $${params.length}`;
    }
    if (connectorType) {
      params.push(connectorType);
      query += ` AND connector_type = $${params.length}`;
    }
    query += ' ORDER BY timestamp ASC';
    console.log('Consulta SQL:', query);
    console.log('Parámetros SQL:', params);
    const { rows } = await pool.query(query, params);
    console.log('Registros obtenidos de la base:', rows.length);

    // Agrupar eventos en sesiones
    let sessions = [];
    let currentSession = null;
    for (const row of rows) {
      if (row.status === 'Charging') {
        if (!currentSession) {
          currentSession = {
            chargerName: row.charger_name,
            connectorType: row.connector_type,
            start: row.timestamp,
            power: row.power,
            end: null,
            durationMinutes: null
          };
        }
      } else if (row.status === 'SessionEnded') {
        if (currentSession) {
          currentSession.end = row.timestamp;
          currentSession.durationMinutes = Math.round((currentSession.end - currentSession.start) / 60000);
          sessions.push(currentSession);
          currentSession = null;
        }
      }
    }
    if (currentSession) {
      currentSession.end = null;
      currentSession.durationMinutes = Math.round((Date.now() - currentSession.start) / 60000);
      sessions.push(currentSession);
    }
    sessions.sort((a, b) => b.start - a.start);
    console.log('Sesiones agrupadas a devolver:', sessions.length);
    res.json({ sessions });
  } catch (err) {
    console.error('Error al obtener sesiones agrupadas:', err);
    res.status(500).json({ sessions: [], error: 'Error al obtener sesiones', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
});
