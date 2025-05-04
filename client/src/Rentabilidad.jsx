import React, { useState } from "react";
import dayjs from "dayjs";

const ESCENARIOS = [
  { value: "conservador", label: "Conservador" },
  { value: "intermedio", label: "Intermedio" },
  { value: "optimista", label: "Optimista" },
];

export default function Rentabilidad() {
  const [from, setFrom] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().endOf("month").format("YYYY-MM-DD"));
  const [tarifas, setTarifas] = useState([]);
  const [tarifaSeleccionada, setTarifaSeleccionada] = useState("");
  const [escenario, setEscenario] = useState(ESCENARIOS[0].value);
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Cargar tarifas.json al montar
  React.useEffect(() => {
    fetch("/tarifas.json")
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
      const body = {
        from,
        to,
        tarifa: tarifaSeleccionada,
        escenario,
        sesiones: sesionesMapeadas,
        costosCarga
      };
      const rentRes = await fetch("/api/rentabilidad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await rentRes.text();
      console.log("DEBUG respuesta backend:", text);
      if (!rentRes.ok) throw new Error(text);
      let data = [];
      try {
        data = JSON.parse(text);
      } catch {
        setError("Respuesta del backend no es JSON válido: " + text);
        setLoading(false);
        return;
      }
      setResultados(data);
    } catch (err) {
      setError(err.message || "Error desconocido");
    } finally {
      setLoading(false);
    }
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
