// Endpoint REST para cálculo de rentabilidad (bruta y neta) por escenario
// Usa costos_carga.json para la bruta y tarifas.json para el gasto eléctrico

const express = require('express');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const router = express.Router();

// Utilidades para cargar los archivos JSON
const COSTOS_PATH = path.join(__dirname, './costos_carga.json');
const TARIFAS_PATH = path.join(__dirname, './tarifas.json');

// --- Lógica de potencia por escenario ---
function getSessionPower({ empresa, potencia }, ocupacion, escenario) {
  if (escenario === "auspicioso") return 60;
  if (empresa === "UTE") {
    if (potencia === 300) return 60;
    if (escenario === "conservador") {
      if (ocupacion === 1) return 45;
      if (ocupacion >= 2) return 27;
    }
    if (escenario === "intermedio") {
      if (ocupacion === 1) return 60;
      if (ocupacion >= 2) return 30;
    }
  }
  // Mobility y eOne siempre 60
  return 60;
}

// Detectar empresa y potencia
function getChargerInfo(name) {
  let empresa = "Desconocido";
  let potencia = 60;
  const lower = name.toLowerCase();
  if (name.includes("UTE") || lower.includes("zonamerica")) {
    empresa = "UTE";
    if (
      name.includes("ANCAP Trinidad") ||
      lower.includes("leguizamon")
    ) {
      potencia = 300;
    }
  } else if (lower.includes("mobility") || lower.includes("auxicar")) {
    empresa = "Mobility";
    potencia = 60;
  } else if (lower.includes("eone")) {
    empresa = "eOne";
    potencia = 60;
  }
  return { empresa, potencia };
}

// Agrupamiento por pares de conectores
function getPairKey(chargerName, connectorId) {
  const match = connectorId.match(/(\d+)$/);
  const idx = match ? parseInt(match[1]) : 0;
  const pair = Math.floor(idx / 2);
  return `${chargerName} - Par ${pair + 1}`;
}

// Calcular ocupación simultánea
function calcularOcupacionSimultanea(sesiones, session) {
  const start = dayjs(session.session_start);
  const end = dayjs(session.session_end);
  return sesiones.filter(
    (s) =>
      s.charger_name === session.charger_name &&
      dayjs(s.session_start).isBefore(end) &&
      dayjs(s.session_end).isAfter(start)
  ).length;
}

// Calcular ocupación simultánea para cada sesión de un cargador.
function calcularOcupacionSimultaneaPorSesion(sesiones) {
  return sesiones.map(sesionActual => {
    const inicioA = dayjs(sesionActual.session_start);
    const finA = dayjs(sesionActual.session_end);
    // Contar cuántas sesiones se solapan con la actual para el mismo cargador
    const ocupadosSimultaneo = sesiones.filter(s => {
      if (s === sesionActual) return false;
      if (s.charger_name !== sesionActual.charger_name) return false;
      const inicioB = dayjs(s.session_start);
      const finB = dayjs(s.session_end);
      // Hay solapamiento si los intervalos se cruzan
      return inicioA.isBefore(finB) && finA.isAfter(inicioB);
    }).length + 1; // +1 para incluir la sesión actual
    return {
      ...sesionActual,
      ocupadosSimultaneo
    };
  });
}

// Calcular rentabilidad bruta
function calcularRecaudacionBruta({ empresa }, kWh, sessionStart, sessionEnd, costos) {
  if (empresa === "UTE") {
    return costos.UTE.fijo + kWh * costos.UTE.variable * costos.UTE.factor;
  }
  if (empresa === "Mobility") {
    // Prorrateo horario
    const start = dayjs(sessionStart);
    let kWhAlta = 0, kWhBaja = 0;
    if (start.hour() >= 18 && start.hour() < 22) {
      kWhAlta = kWh;
    } else {
      kWhBaja = kWh;
    }
    return kWhAlta * costos.Mobility.alta + kWhBaja * costos.Mobility.baja;
  }
  if (empresa === "eOne") {
    return kWh * costos.eOne.variable;
  }
  return 0;
}

// Calcular gasto eléctrico (para rentabilidad neta)
function calcularGastoElectrico(tarifa, kWh) {
  // tarifa: objeto de tarifas.json seleccionado según criterio
  return kWh * parseFloat(tarifa["Precio estimado (UYU $/kWh)"] || 0);
}

// --- Endpoint principal ---
// POST /api/rentabilidad
// Body: { from, to, escenario, tarifaSeleccionada, sesiones }
router.post('/api/rentabilidad', async (req, res) => {
  console.log('DEBUG rentabilidad: request recibido');
  try {
    const bodyStr = JSON.stringify(req.body);
    console.log('Tamaño del body:', bodyStr.length, 'bytes');
    const { from, to, escenario, tarifaSeleccionada, sesiones } = req.body;
    // Cargar archivos de criterios
    const costos = JSON.parse(fs.readFileSync(COSTOS_PATH, 'utf8'));
    const tarifas = JSON.parse(fs.readFileSync(TARIFAS_PATH, 'utf8'));
    // Buscar tarifa seleccionada
    const tarifa = tarifas.find(t => t.Tarifa === tarifaSeleccionada);
    if (!tarifa) return res.status(400).json({ error: 'Tarifa no encontrada' });
    // Filtrar sesiones por rango de fechas
    const sesionesFiltradas = sesiones.filter(s => {
      const start = dayjs(s.session_start);
      return start.isAfter(dayjs(from).subtract(1, 'day')) && start.isBefore(dayjs(to).add(1, 'day'));
    });
    // --- NUEVO: calcular ocupación simultánea para cada sesión ---
    const sesionesConOcupacion = calcularOcupacionSimultaneaPorSesion(sesionesFiltradas);
    // Procesar sesiones
    const resultados = {};
    sesionesConOcupacion.forEach((session) => {
      const { empresa, potencia } = getChargerInfo(session.charger_name);
      // Usar el campo ocupadosSimultaneo para lógica de potencia
      const power = getSessionPower({ empresa, potencia }, session.ocupadosSimultaneo, escenario);
      const minutos = dayjs(session.session_end).diff(dayjs(session.session_start), "minute");
      const kWh = power * (minutos / 60);
      const recaudacion_bruta = calcularRecaudacionBruta({ empresa }, kWh, session.session_start, session.session_end, costos);
      const gasto_electrico = calcularGastoElectrico(tarifa, kWh);
      const recaudacion_neta = recaudacion_bruta - gasto_electrico;
      const key = getPairKey(session.charger_name, session.connector_id);
      if (!resultados[key]) {
        resultados[key] = {
          nombre: key,
          empresa,
          potencia,
          minutos: 0,
          kWh: 0,
          recaudacion_bruta: 0,
          gasto_electrico: 0,
          recaudacion_neta: 0
        };
      }
      resultados[key].minutos += minutos;
      resultados[key].kWh += kWh;
      resultados[key].recaudacion_bruta += recaudacion_bruta;
      resultados[key].gasto_electrico += gasto_electrico;
      resultados[key].recaudacion_neta += recaudacion_neta;
    });
    // Devuelve array para la tabla
    res.json(Object.values(resultados));
  } catch (err) {
    console.error('ERROR rentabilidad:', err);
    res.status(500).json({ error: 'Error interno en el cálculo de rentabilidad', detalle: err.message });
  }
});

// Para usar este archivo: require('./rentabilidad_api')(app) en tu index.js
module.exports = router;
