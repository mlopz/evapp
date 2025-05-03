import React, { useState, useEffect } from "react";
import dayjs from "dayjs";

function Rentabilidad({ fetchSesiones }) {
  const [from, setFrom] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().endOf("month").format("YYYY-MM-DD"));
  const [escenario, setEscenario] = useState("conservador");
  const [tarifaSeleccionada, setTarifaSeleccionada] = useState("");
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opcionesTarifa, setOpcionesTarifa] = useState([]);

  // Cargar opciones de tarifa desde backend (tarifas.json)
  useEffect(() => {
    fetch("/tarifas.json")
      .then(r => r.json())
      .then(data => {
        setOpcionesTarifa(data.map(t => t.Tarifa));
        if (!tarifaSeleccionada && data.length > 0) setTarifaSeleccionada(data[0].Tarifa);
      });
  }, []);

  // Cargar sesiones y pedir cálculo al backend
  useEffect(() => {
    if (!tarifaSeleccionada) return;
    setLoading(true);
    setError("");
    fetchSesiones(from, to)
      .then(sesiones => {
        return fetch("/api/rentabilidad", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, escenario, tarifaSeleccionada, sesiones })
        })
          .then(r => {
            if (!r.ok) throw new Error("Error en backend");
            return r.json();
          });
      })
      .then(data => setResultados(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [from, to, escenario, tarifaSeleccionada, fetchSesiones]);

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4 text-orange-700">Rentabilidad</h2>
      <div className="flex gap-4 mb-4">
        <label>Escenario:</label>
        <select value={escenario} onChange={e => setEscenario(e.target.value)} className="border rounded px-2 py-1">
          <option value="conservador">Conservador</option>
          <option value="intermedio">Intermedio</option>
          <option value="auspicioso">Auspicioso</option>
        </select>
        <label>Desde:</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1" />
        <label>Hasta:</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1" />
        <label>Tarifa eléctrica:</label>
        <select value={tarifaSeleccionada} onChange={e => setTarifaSeleccionada(e.target.value)} className="border rounded px-2 py-1">
          {opcionesTarifa.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
      {loading && <div className="text-orange-600">Calculando rentabilidad...</div>}
      {error && <div className="text-red-600">Error: {error}</div>}
      <table className="min-w-full bg-white border rounded shadow mt-4">
        <thead className="bg-orange-500 text-white">
          <tr>
            <th className="px-2 py-1">Conector/Par</th>
            <th className="px-2 py-1">Empresa</th>
            <th className="px-2 py-1">Pot. nominal</th>
            <th className="px-2 py-1">Minutos</th>
            <th className="px-2 py-1">kWh</th>
            <th className="px-2 py-1">Recaudación bruta ($)</th>
            <th className="px-2 py-1">Gasto eléctrico ($)</th>
            <th className="px-2 py-1">Recaudación neta ($)</th>
            <th className="px-2 py-1">Escenario</th>
          </tr>
        </thead>
        <tbody>
          {resultados.map(r => (
            <tr key={r.nombre} className="border-b">
              <td className="px-2 py-1">{r.nombre}</td>
              <td className="px-2 py-1">{r.empresa}</td>
              <td className="px-2 py-1">{r.potencia}</td>
              <td className="px-2 py-1">{Math.round(r.minutos)}</td>
              <td className="px-2 py-1">{r.kWh.toFixed(2)}</td>
              <td className="px-2 py-1">{r.recaudacion_bruta.toFixed(2)}</td>
              <td className="px-2 py-1">{r.gasto_electrico.toFixed(2)}</td>
              <td className="px-2 py-1 font-semibold text-orange-700">{r.recaudacion_neta.toFixed(2)}</td>
              <td className="px-2 py-1 text-xs text-orange-600 bg-orange-50">{escenario}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Rentabilidad;
