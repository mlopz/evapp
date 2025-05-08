import React, { useEffect, useState } from 'react';

export default function Rentabilidad() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/rentabilidad/estadisticas')
      .then((res) => {
        if (!res.ok) throw new Error('Error al obtener estadísticas');
        return res.json();
      })
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-4">Cargando...</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;
  if (!stats) return <div className="p-4">Sin datos.</div>;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Estadísticas de Rentabilidad</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded shadow p-4">
          <h3 className="font-semibold">Energía total entregada</h3>
          <p>{stats.energiaTotal} kWh</p>
        </div>
        <div className="bg-white rounded shadow p-4">
          <h3 className="font-semibold">Total de sesiones</h3>
          <p>{stats.totalSesiones}</p>
        </div>
        <div className="bg-white rounded shadow p-4">
          <h3 className="font-semibold">Recaudación estimada</h3>
          <p>${stats.recaudacionEstim}</p>
        </div>
        <div className="bg-white rounded shadow p-4">
          <h3 className="font-semibold">Costos estimados</h3>
          <p>${stats.costoEstim}</p>
        </div>
        <div className="bg-white rounded shadow p-4 md:col-span-2">
          <h3 className="font-semibold">Rentabilidad</h3>
          <p>${stats.rentabilidad}</p>
        </div>
      </div>
      <h4 className="mt-8 mb-2 font-semibold">Rentabilidad por cargador</h4>
      <table className="min-w-full bg-white rounded shadow">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left">Cargador</th>
            <th className="px-2 py-1 text-left">Energía (kWh)</th>
            <th className="px-2 py-1 text-left">Sesiones</th>
            <th className="px-2 py-1 text-left">Rentabilidad</th>
          </tr>
        </thead>
        <tbody>
          {stats.porCargador.map((c) => (
            <tr key={c.charger_name}>
              <td className="px-2 py-1">{c.charger_name}</td>
              <td className="px-2 py-1">{c.energia}</td>
              <td className="px-2 py-1">{c.sesiones}</td>
              <td className="px-2 py-1">${c.rentabilidad}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
, { useState } from "react";
import dayjs from "dayjs";

const ESCENARIOS = [
  { value: "conservador", label: "Conservador" },
  { value: "intermedio", label: "Intermedio" },
  { value: "optimista", label: "Optimista" },
];

// Parámetros por escenario
const ESCENARIO_PARAMS = {
  conservador: {
    descripcion: 'Escenario conservador: baja utilización, precios bajos, costos altos.',
    supuestos: [
      'Baja ocupación promedio',
      'Precio de venta bajo',
      'Costo energético alto',
      'Menor recaudación por riesgos o mantenimiento'
    ]
  },
  intermedio: {
    descripcion: 'Escenario intermedio: utilización y precios promedio, costos estándar.',
    supuestos: [
      'Ocupación y precios promedio',
      'Costos estándar',

export default function Rentabilidad() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/rentabilidad/estadisticas')
      .then((res) => {
        if (!res.ok) throw new Error('Error al obtener estadísticas');
        return res.json();
      })
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  React.useEffect(() => {
    fetch('https://evapp-production.up.railway.app/tarifas.json')
      .then(r => r.json())
      .then(data => setTarifas(data))
      .catch(() => setTarifas([]));
  }, []);

  // Handler principal
  const calcularRentabilidad = async () => {
    setLoading(true);
    setError("");
    setResultados([]);
    try {
      console.log("DEBUG antes del fetch a /api/rentabilidad");
      // 1. Fetch sesiones
      const sesionesRes = await fetch(`/api/connector-sessions?from=${from}&to=${to}`);
      const sesiones = await sesionesRes.json();
      console.log("DEBUG sesiones recibidas:", sesiones);
      if (!Array.isArray(sesiones) || sesiones.length === 0) {
        setError("No hay sesiones en el rango seleccionado");
        setLoading(false);
        return;
      }
      // 2. Fetch costos carga
      const costosRes = await fetch("/costos_carga.json");
      const costosCarga = await costosRes.json();
      console.log("DEBUG costos_carga:", costosCarga);
      // 3. Mapeo de sesiones
      const sesionesMapeadas = sesiones.map(s => ({
        chargerName: s.charger_name,
        connectorId: s.connector_id,
        connectorType: s.connector_type,
        start: s.session_start,
        end: s.session_end,
        durationMinutes: s.duration_minutes,
        empresa: s.charger_name && s.charger_name.startsWith("UTE") ? "UTE" : (s.charger_name && s.charger_name.startsWith("eOne") ? "eOne" : "Mobility"),
        potencia: s.power || 60
      }));
      console.log("DEBUG sesiones mapeadas:", sesionesMapeadas);
      // 4. POST a rentabilidad
      const tarifaSeleccionadaObj = tarifas.find(t => t.id === tarifaSeleccionada);
      const body = {
        from,
        to,
        escenario,
        sesiones: sesionesMapeadas,
        costosCarga,
        tarifa: tarifaSeleccionadaObj // Enviar objeto completo
      };
      console.log("DEBUG body rentabilidad:", body);
      let rentRes, text;
      try {
        console.log("DEBUG antes del fetch a /api/rentabilidad");
        rentRes = await fetch('https://evapp-production.up.railway.app/api/rentabilidad', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        text = await rentRes.text();
        console.log("DEBUG respuesta backend:", text);
      } catch (fetchErr) {
        console.error("DEBUG error de red o CORS en fetch /api/rentabilidad:", fetchErr);
        setError("Error de red o CORS: " + fetchErr.message);
        setLoading(false);
        return;
      }
      if (!rentRes.ok) {
        console.log("DEBUG respuesta backend no OK:", text);
        throw new Error(text);
      }
      let data = [];
      // Loguear status y headers de la respuesta
      console.log("DEBUG rentRes.status:", rentRes.status);
      console.log("DEBUG rentRes.headers:", rentRes.headers);
      console.log("DEBUG string recibido del backend antes de parsear:", text, "typeof:", typeof text);
      if (!text) {
        setError("Respuesta vacía del backend");
        setLoading(false);
        return;
      }
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.error("DEBUG error parseando JSON:", parseErr);
        setError("Respuesta del backend no es JSON válido: " + text);
        setLoading(false);
        return;
      }
      setResultados(data);
    } catch (err) {
      console.error("DEBUG error rentabilidad:", err);
      setError(err.message || "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  // --- Tabla de criterios técnicos por escenario ---
  const getCriteriosTabla = (escenario) => {
    // Lógica reflejando getSessionPower del backend
    return [
      {
        empresa: 'UTE', potencia: 300, ocupacion: '1',
        potenciaUsada: escenario === 'conservador' ? 45 : (escenario === 'intermedio' ? 60 : 60)
      },
      {
        empresa: 'UTE', potencia: 300, ocupacion: '2 o más',
        potenciaUsada: escenario === 'conservador' ? 27 : (escenario === 'intermedio' ? 30 : 60)
      },
      {
        empresa: 'UTE', potencia: 60, ocupacion: 'cualquier', potenciaUsada: 60 },
      { empresa: 'Mobility', potencia: 60, ocupacion: 'cualquier', potenciaUsada: 60 },
      { empresa: 'eOne', potencia: 60, ocupacion: 'cualquier', potenciaUsada: 60 }
    ];
  };

  return (
    <div className="max-w-4xl mx-auto bg-white shadow rounded p-6 mt-8">
      <h2 className="text-2xl font-bold mb-4 text-orange-700">Rentabilidad</h2>
      <div className="flex flex-wrap gap-4 mb-4">
        <div>
          <label className="block text-sm font-semibold mb-1">Desde</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Hasta</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1" />
        </div>
        <div className="mb-4">
          <label className="block mb-2 font-semibold">Selecciona una tarifa:</label>
          <select
            value={tarifaSeleccionada}
            onChange={e => setTarifaSeleccionada(e.target.value)}
            className="border rounded px-2 py-1"
          >
            <option value="">-- Selecciona una tarifa --</option>
            {tarifas.map(tarifa => (
              <option key={tarifa.id} value={tarifa.id}>
                {tarifa.nombre} - {tarifa.descripcion}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Escenario</label>
          <select value={escenario} onChange={e => setEscenario(e.target.value)} className="border rounded px-2 py-1">
            {ESCENARIOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button
            className="bg-orange-600 hover:bg-orange-700 text-white font-bold px-4 py-2 rounded"
            onClick={calcularRentabilidad}
            disabled={loading || !from || !to || !tarifaSeleccionada}
          >
            {loading ? "Calculando..." : "Calcular rentabilidad"}
          </button>
        </div>
      </div>
      {/* Descripción del escenario seleccionado */}
      <div className="mb-4 p-3 bg-orange-50 border-l-4 border-orange-400 rounded">
        <div className="font-semibold text-orange-700 mb-1">Escenario seleccionado: {ESCENARIOS.find(e => e.value === escenario)?.label}</div>
        <div className="text-sm text-gray-700 mb-1">{ESCENARIO_PARAMS[escenario]?.descripcion}</div>
        <ul className="list-disc ml-6 text-xs text-gray-600">
          {ESCENARIO_PARAMS[escenario]?.supuestos.map((s,i) => <li key={i}>{s}</li>)}
        </ul>
      </div>
      {/* Tabla de criterios técnicos según escenario */}
      <div className="mb-4 p-3 bg-orange-50 border-l-4 border-orange-400 rounded">
        <div className="font-semibold text-orange-700 mb-1">Criterios técnicos del escenario seleccionado</div>
        <div className="text-xs text-gray-700 mb-2">La potencia usada para el cálculo depende de la empresa, la potencia nominal del cargador y la ocupación simultánea.</div>
        <table className="min-w-[300px] text-xs border border-orange-200 bg-white rounded">
          <thead>
            <tr className="bg-orange-100">
              <th className="px-2 py-1 text-left">Empresa</th>
              <th className="px-2 py-1 text-left">Potencia cargador (kW)</th>
              <th className="px-2 py-1 text-left">Ocupación simultánea</th>
              <th className="px-2 py-1 text-left">Potencia usada (kW)</th>
            </tr>
          </thead>
          <tbody>
            {getCriteriosTabla(escenario).map((row, i) => (
              <tr key={i}>
                <td className="px-2 py-1">{row.empresa}</td>
                <td className="px-2 py-1">{row.potencia}</td>
                <td className="px-2 py-1">{row.ocupacion}</td>
                <td className="px-2 py-1 font-semibold text-orange-800">{row.potenciaUsada}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Tabla de costos de la tarifa seleccionada */}
      {tarifaSeleccionada && tarifas.length > 0 && (
        (() => {
          const t = tarifas.find(t => t.id === tarifaSeleccionada);
          if (!t) return null;
          return (
            <div className="mb-4 p-3 bg-orange-50 border-l-4 border-orange-400 rounded">
              <div className="font-semibold text-orange-700 mb-1">Costos de la tarifa seleccionada: {t.nombre}</div>
              <table className="min-w-[200px] text-xs border border-orange-200 bg-white rounded">
                <tbody>
                  {Object.entries(t).filter(([k]) => k !== 'id' && k !== 'nombre' && k !== 'descripcion').map(([k,v]) => (
                    <tr key={k}>
                      <td className="px-2 py-1 font-semibold text-orange-800 text-right capitalize">{k.replace(/_/g,' ')}</td>
                      <td className="px-2 py-1 text-gray-700">{typeof v === 'number' ? v.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()
      )}
      {error && <div className="text-red-600 mb-4">{error}</div>}
      {resultados && resultados.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-300 mt-4">
            <thead className="bg-orange-100">
              <tr>
                <th className="px-2 py-1">Cargador</th>
                <th className="px-2 py-1">Minutos</th>
                <th className="px-2 py-1">kWh</th>
                <th className="px-2 py-1">Recaudación bruta</th>
                <th className="px-2 py-1">Gasto eléctrico</th>
                <th className="px-2 py-1">Rentabilidad neta</th>
                <th className="px-2 py-1">Escenario</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="px-2 py-1">{r.chargerName || r.charger_name}</td>
                  <td className="px-2 py-1">{Math.round(r.minutos || r.durationMinutes)}</td>
                  <td className="px-2 py-1">{(r.kWh || r.energy_kwh || 0).toFixed(2)}</td>
                  <td className="px-2 py-1">{(r.recaudacion_bruta || 0).toFixed(2)}</td>
                  <td className="px-2 py-1">{(r.gasto_electrico || 0).toFixed(2)}</td>
                  <td className="px-2 py-1 font-semibold text-orange-700">{(r.recaudacion_neta || 0).toFixed(2)}</td>
                  <td className="px-2 py-1 text-xs text-orange-600 bg-orange-50">{escenario}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
