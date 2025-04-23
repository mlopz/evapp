require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

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

async function saveSessionToFirestore(session) {
  if (!isFastChargerSession(session)) {
    console.log('Sesión ignorada (cargador no rápido):', session);
    return;
  }
  try {
    await db.collection('sessions').add(session);
    console.log('Sesión guardada en Firestore:', session);
  } catch (error) {
    console.error('Error guardando sesión en Firestore:', error);
  }
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
          };
          sessions.push(sessionObj);
          saveSessionToFirestore(sessionObj); // Guardar en Firestore
          prev.sessionStart = null;
        }
        if (!prev.sessionStart && newState === 'Charging') {
          prev.sessionStart = now;
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
  console.log('--- /api/sessions request ---');
  try {
    const { chargerName, connectorType } = req.query;
    console.log('Query params:', { chargerName, connectorType });
    let query = db.collection('sessions');
    console.log('Firestore base query creada');
    if (chargerName) {
      query = query.where('chargerName', '==', chargerName);
      console.log('Filtro por chargerName:', chargerName);
    }
    if (connectorType) {
      query = query.where('connectorType', '==', connectorType);
      console.log('Filtro por connectorType:', connectorType);
    }
    const snapshot = await query.get();
    console.log('Snapshot obtenido, cantidad de docs:', snapshot.size);
    const sessions = [];
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      try {
        let durationMinutes = 0;
        if (
          typeof data.durationMinutes === 'number' && data.durationMinutes > 0
        ) {
          durationMinutes = data.durationMinutes;
        } else if (
          typeof data.start === 'number' && typeof data.end === 'number' && data.end > data.start
        ) {
          durationMinutes = Math.floor((data.end - data.start) / 60000);
        }
        sessions.push({
          ...data,
          durationMinutes,
        });
      } catch (err) {
        console.error('Error procesando sesión:', data, err);
        // Puedes optar por ignorar la sesión problemática o incluirla con un flag
        // sessions.push({ ...data, durationMinutes: 0, invalid: true });
      }
    });
    console.log('Sessions mapeadas:', sessions.length);
    res.json({ sessions });
  } catch (err) {
    console.error('Error al obtener sesiones desde Firestore:', err);
    res.status(500).json({ sessions: [], error: 'Error al obtener sesiones', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
});
