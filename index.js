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
        };
      }
      const prev = connectorsState[chargerName][connectorId];
      const newState = connector.status;
      if (prev.state === 'Charging' && newState !== 'Charging' && prev.sessionStart) {
        const sessionEnd = now;
        const duration = minutesBetween(prev.sessionStart, sessionEnd);
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
        // Guardar en PostgreSQL
        insertMonitoringRecord({
          charger_name: chargerName,
          connector_type: connector.type,
          connector_id: connectorId,
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
          connector_type: connector.type,
          connector_id: connectorId,
          power: connector.power || null,
          status: 'Charging',
          timestamp: now
        }).catch(err => console.error('Error guardando evento Charging en PostgreSQL:', err));
      }
      prev.lastState = prev.state;
      prev.state = newState;
      prev.lastUpdate = now;
    });
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
          insertMonitoringRecord({
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

// --- Al iniciar el backend: cerrar y abrir sesiones si corresponde ---
function closeAndOpenChargingSessionsOnStartup() {
  const now = Date.now();
  for (const chargerName in connectorsState) {
    for (const connectorId in connectorsState[chargerName]) {
      const state = connectorsState[chargerName][connectorId];
      if (state.state === 'Charging') {
        // Si hay una sesión previa abierta, cerrarla
        if (state.sessionStart) {
          insertMonitoringRecord({
            charger_name: chargerName,
            connector_type: getChargersWithAccumulated().find(c => c.name === chargerName).connectors.find(conn => conn.connectorId === connectorId).type,
            connector_id: connectorId,
            power: null,
            status: 'SessionEnded',
            timestamp: now
          }).catch(err => console.error('Error cerrando sesión previa al iniciar backend:', err));
        }
        // Abrir una nueva sesión Charging
        state.sessionStart = now;
        insertMonitoringRecord({
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
    const { chargerName, connectorType, connectorId } = req.query;
    console.log('Parámetros recibidos:', { chargerName, connectorType, connectorId });
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
    if (connectorId) {
      params.push(connectorId);
      query += ` AND connector_id = $${params.length}`;
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
      // Normalizar timestamp a número (milisegundos)
      const timestampMs = row.timestamp ? new Date(row.timestamp).getTime() : null;
      if (row.status === 'Charging') {
        if (!currentSession) {
          currentSession = {
            chargerName: row.charger_name,
            connectorId: row.connector_id,
            connectorType: row.connector_type,
            start: timestampMs,
            power: row.power,
            end: null,
            durationMinutes: null
          };
        }
      } else if (row.status === 'SessionEnded') {
        if (currentSession) {
          currentSession.end = timestampMs;
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
    // Agregar sesión activa desde memoria si corresponde (por si no hay eventos en la base)
    for (const chargerNameKey in connectorsState) {
      for (const connectorIdKey in connectorsState[chargerNameKey]) {
        const state = connectorsState[chargerNameKey][connectorIdKey];
        if (state.state === 'Charging' && state.sessionStart) {
          // Si ya existe una sesión activa igual, no la agregues
          if (!sessions.some(s => s.chargerName === chargerNameKey && s.connectorId === connectorIdKey && s.end === null)) {
            // Solo incluir si coincide con el filtro
            if (
              (!chargerName || chargerNameKey === chargerName) &&
              (!connectorId || connectorIdKey === connectorId)
            ) {
              sessions.unshift({
                chargerName: chargerNameKey,
                connectorId: connectorIdKey,
                connectorType: getChargersWithAccumulated().find(c => c.name === chargerNameKey).connectors.find(conn => conn.connectorId === connectorIdKey).type,
                start: state.sessionStart,
                end: null,
                durationMinutes: minutesBetween(state.sessionStart, getNow()),
              });
            }
          }
        }
      }
    }
    sessions.sort((a, b) => b.start - a.start);
    // Log de depuración de lo que se devuelve
    console.log('Sesiones agrupadas a devolver:', JSON.stringify(sessions, null, 2));
    res.json({ sessions });
  } catch (err) {
    console.error('Error al obtener sesiones agrupadas:', err);
    res.status(500).json({ sessions: [], error: 'Error al obtener sesiones', details: err.message });
  }
});

// --- Endpoint para limpiar la base de datos (tabla charger_monitoring) ---
app.post('/api/clear-db', async (req, res) => {
  try {
    const pool = require('./db');
    await pool.query('DELETE FROM charger_monitoring');
    res.json({ success: true, message: 'Base de datos limpiada correctamente.' });
  } catch (err) {
    console.error('Error al limpiar la base de datos:', err);
    res.status(500).json({ success: false, message: 'Error al limpiar la base de datos.', error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
});
