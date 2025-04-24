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
        }).catch(err => console.error('Error guardando evento Charging en PostgreSQL:', err));
      }
      // Si está en Charging, sumar el tiempo de la sesión en curso al acumulado para mostrar en tiempo real
      if (prev.state === 'Charging' && prev.sessionStart) {
        prev.accumulatedMinutesDisplay = (prev.accumulatedMinutes || 0) + minutesBetween(prev.sessionStart, now);
      } else {
        prev.accumulatedMinutesDisplay = prev.accumulatedMinutes || 0;
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
  console.log('--- /api/sessions request (agrupando sesiones) ---');
  try {
    const { chargerName, connectorType, connectorId } = req.query;
    console.log('Parámetros recibidos:', { chargerName, connectorType, connectorId });
    logConnectorStates();
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

    // --- Agrupación robusta por connectorId ---
    const sessionsByConnector = {};
    for (const row of rows) {
      const cid = row.connector_id;
      const charger = row.charger_name;
      const ctype = row.connector_type;
      const timestampMs = row.timestamp ? new Date(row.timestamp).getTime() : null;
      if (!sessionsByConnector[cid]) {
        sessionsByConnector[cid] = {
          chargerName: charger,
          connectorId: cid,
          connectorType: ctype,
          start: null,
          end: null,
          power: null,
          durationMinutes: null,
          status: null,
        };
      }
      if (row.status === 'Charging') {
        // Solo tomar el primer Charging como inicio de sesión
        if (!sessionsByConnector[cid].start) {
          sessionsByConnector[cid].start = timestampMs;
          sessionsByConnector[cid].power = row.power;
          sessionsByConnector[cid].status = 'Charging';
        }
      } else if (row.status === 'SessionEnded') {
        // Si hay un inicio, cerrar la sesión
        if (sessionsByConnector[cid].start && !sessionsByConnector[cid].end) {
          sessionsByConnector[cid].end = timestampMs;
          sessionsByConnector[cid].durationMinutes = Math.round((sessionsByConnector[cid].end - sessionsByConnector[cid].start) / 60000);
          sessionsByConnector[cid].status = 'Ended';
        }
      }
    }
    // Construir array de sesiones válidas (solo sesiones con start)
    let sessions = Object.values(sessionsByConnector).filter(s => s.start);

    // --- Agregar la sesión activa desde memoria si corresponde y priorizarla ---
    for (const chargerNameKey in connectorsState) {
      for (const connectorIdKey in connectorsState[chargerNameKey]) {
        const state = connectorsState[chargerNameKey][connectorIdKey];
        if (state.state === 'Charging' && state.sessionStart) {
          // Buscar conector de forma segura
          const chargerObj = getChargersWithAccumulated().find(c => c.name === chargerNameKey);
          const connectorObj = chargerObj ? (chargerObj.connectors || []).find(conn => conn.connectorId === connectorIdKey) : null;
          const connectorTypeSafe = connectorObj ? connectorObj.type : null;
          const idx = sessions.findIndex(s => s.chargerName === chargerNameKey && s.connectorId === connectorIdKey && !s.end);
          const sessionMem = {
            chargerName: chargerNameKey,
            connectorId: connectorIdKey,
            connectorType: connectorTypeSafe,
            start: state.sessionStart,
            end: null,
            durationMinutes: minutesBetween(state.sessionStart, getNow()),
            power: connectorObj ? connectorObj.power : null,
            status: 'Charging',
          };
          if (idx !== -1) {
            sessions[idx] = sessionMem;
          } else {
            if (
              (!chargerName || chargerNameKey === chargerName) &&
              (!connectorId || connectorIdKey === connectorId)
            ) {
              sessions.unshift(sessionMem);
            }
          }
        }
      }
    }
    // --- Eliminar duplicados: solo una sesión activa por connectorId ---
    const uniqueSessions = [];
    const seenActive = new Set();
    for (const s of sessions) {
      if (!s.end) {
        if (seenActive.has(s.connectorId)) continue;
        seenActive.add(s.connectorId);
      }
      uniqueSessions.push(s);
    }
    uniqueSessions.sort((a, b) => b.start - a.start);
    // Log de depuración de lo que se devuelve
    console.log('Sesiones agrupadas a devolver:', JSON.stringify(uniqueSessions, null, 2));
    res.json({ sessions: uniqueSessions });
  } catch (err) {
    console.error('Error al obtener sesiones agrupadas:', err);
    res.status(500).json({ sessions: [], error: 'Error al obtener sesiones', details: err.message });
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

// --- Filtrar conectores lentos en inserciones ---
function insertMonitoringRecordSafe({ charger_name, connector_type, connector_id, power, status, timestamp }) {
  if (typeof power === 'string') power = parseFloat(power);
  if (power < 60) return Promise.resolve(); // No guardar eventos de conectores lentos
  return insertMonitoringRecord({ charger_name, connector_type, connector_id, power, status, timestamp });
}

app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
});
