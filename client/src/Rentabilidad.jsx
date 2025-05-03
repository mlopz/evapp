import React, { useState, useEffect } from "react";
import dayjs from "dayjs";

// Utilidad para detectar empresa y potencia
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

// Lógica de potencia por escenario
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

// Calcular recaudación neta
function calcularRecaudacion({ empresa }, kWh, sessionStart, sessionEnd) {
  if (empresa === "UTE") {
    return 121.9 + kWh * 10.8 * 0.7;
  }
  if (empresa === "Mobility") {
    // Prorrateo horario
    const start = dayjs(sessionStart);
    const end = dayjs(sessionEnd);
    let kWhAlta = 0,
      kWhBaja = 0;
    const totalMinutes = end.diff(start, "minute");
    // Si toda la sesión está en franja alta
    if (start.hour() >= 18 && start.hour() < 22) {
      kWhAlta = kWh;
    } else {
      kWhBaja = kWh;
    }
    return kWhAlta * 25 + kWhBaja * 12.54;
  }
  if (empresa === "eOne") {
    return kWh * 14.64;
  }
  return 0;
}

// Agrupamiento por pares de conectores
function getPairKey(chargerName, connectorId) {
  // Ejemplo: para 4 conectores, pares 0-1 y 2-3
  // Toma el número final del conectorId si es posible
  const match = connectorId.match(/(\d+)$/);
  const idx = match ? parseInt(match[1]) : 0;
  const pair = Math.floor(idx / 2);
  return `${chargerName} - Par ${pair + 1}`;
}

// Lógica para calcular ocupación simultánea
type Session = {
  charger_name: string,
  connector_id: string,
  session_start: string,
  session_end: string
};
function calcularOcupacionSimultanea(sesiones, session) {
  // Cuenta cuántas sesiones del mismo cargador están activas en el intervalo de esta sesión
  const start = dayjs(session.session_start);
  const end = dayjs(session.session_end);
  return sesiones.filter(
    (s) =>
      s.charger_name === session.charger_name &&
      dayjs(s.session_start).isBefore(end) &&
      dayjs(s.session_end).isAfter(start)
  ).length;
}

function procesarSesiones(sesiones, escenario) {
  // Agrupa por par, calcula minutos, kWh y recaudación
  const resultados = {};
  sesiones.forEach((session) => {
    const { empresa, potencia } = getChargerInfo(session.charger_name);
    const ocupacion = calcularOcupacionSimultanea(sesiones, session);
    const power = getSessionPower({ empresa, potencia }, ocupacion, escenario);
    const minutos =
      (dayjs(session.session_end).diff(dayjs(session.session_start), "minute"));
    const kWh = power * (minutos / 60);
    const recaudacion = calcularRecaudacion(
      { empresa },
      kWh,
      session.session_start,
      session.session_end
    );
    const key = getPairKey(session.charger_name, session.connector_id);
    if (!resultados[key]) {
      resultados[key] = {
        nombre: key,
        minutos: 0,
        kWh: 0,
        recaudacion: 0
      };
    }
    resultados[key].minutos += minutos;
    resultados[key].kWh += kWh;
    resultados[key].recaudacion += recaudacion;
  });
  // Devuelve array para la tabla
  return Object.values(resultados);
}

const escenarios = [
  { label: "Conservador", value: "conservador" },
  { label: "Intermedio", value: "intermedio" },
  { label: "Auspicioso", value: "auspicioso" }
];

export default function Rentabilidad({ fetchSesiones }) {
  const [escenario, setEscenario] = useState("conservador");
  const [from, setFrom] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().endOf("month").format("YYYY-MM-DD"));
  const [sesiones, setSesiones] = useState([]);
  const [resultados, setResultados] = useState([]);

  // --- NUEVO: Orden y búsqueda ---
  const [sortBy, setSortBy] = useState("nombre");
  const [sortDirection, setSortDirection] = useState("asc");
  const [buscador, setBuscador] = useState("");

  useEffect(() => {
    async function cargar() {
      const data = await fetchSesiones(from, to); // Debes pasar esta función desde el dashboard
      setSesiones(data);
    }
    cargar();
  }, [from, to, fetchSesiones]);
  useEffect(() => {
    setResultados(procesarSesiones(sesiones, escenario));
  }, [sesiones, escenario]);

  // --- Filtrar y ordenar resultados ---
  let resultadosFiltrados = resultados.filter(r =>
    r.nombre.toLowerCase().includes(buscador.toLowerCase())
  );
  resultadosFiltrados = resultadosFiltrados.sort((a, b) => {
    let vA = a[sortBy];
    let vB = b[sortBy];
    // Si es string, comparar insensible a mayúsculas
    if (typeof vA === 'string') vA = vA.toLowerCase();
    if (typeof vB === 'string') vB = vB.toLowerCase();
    if (vA < vB) return sortDirection === 'asc' ? -1 : 1;
    if (vA > vB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // --- Handler para ordenar ---
  const handleSort = (col) => {
    if (sortBy === col) {
      setSortDirection(dir => dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDirection('asc');
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4 text-orange-700">Rentabilidad por escenario</h2>
      <div className="flex gap-4 mb-4">
        {escenarios.map((e) => (
          <button
            key={e.value}
            className={`px-4 py-2 rounded font-semibold border ${
              escenario === e.value
                ? "bg-orange-500 text-white border-orange-700"
                : "bg-white text-orange-700 border-orange-300"
            }`}
            onClick={() => setEscenario(e.value)}
          >
            {e.label}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-8">
          <label>Desde:</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border rounded px-2 py-1"
          />
          <label>Hasta:</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>
      </div>
      {/* Buscador para rentabilidad */}
      <div className="mb-4 flex justify-end">
        <input
          type="text"
          className="w-full max-w-xs px-3 py-2 border border-orange-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-600 text-base shadow"
          placeholder="Buscar cargador/par..."
          value={buscador}
          onChange={e => setBuscador(e.target.value)}
        />
      </div>
      <table className="min-w-full bg-white border rounded shadow">
        <thead className="bg-orange-500 text-white">
          <tr>
            <th className="px-2 py-1 cursor-pointer select-none" onClick={()=>handleSort('nombre')}>
              Conector/Par {sortBy==='nombre' && (sortDirection==='asc'?'▲':'▼')}
            </th>
            <th className="px-2 py-1 cursor-pointer select-none" onClick={()=>handleSort('minutos')}>
              Minutos {sortBy==='minutos' && (sortDirection==='asc'?'▲':'▼')}
            </th>
            <th className="px-2 py-1 cursor-pointer select-none" onClick={()=>handleSort('kWh')}>
              kWh {sortBy==='kWh' && (sortDirection==='asc'?'▲':'▼')}
            </th>
            <th className="px-2 py-1 cursor-pointer select-none" onClick={()=>handleSort('recaudacion')}>
              Recaudación neta ($) {sortBy==='recaudacion' && (sortDirection==='asc'?'▲':'▼')}
            </th>
          </tr>
        </thead>
        <tbody>
          {resultadosFiltrados.map((r) => (
            <tr key={r.nombre} className="border-b">
              <td className="px-2 py-1">{r.nombre}</td>
              <td className="px-2 py-1">{Math.round(r.minutos)}</td>
              <td className="px-2 py-1">{r.kWh.toFixed(2)}</td>
              <td className="px-2 py-1">{r.recaudacion.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
