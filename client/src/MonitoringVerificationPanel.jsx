import React, { useEffect, useState } from "react";

export default function MonitoringVerificationPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let timeout;
    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/monitoring-verification", { cache: "no-store" });
        if (!res.ok) throw new Error("No hay datos de verificación disponibles");
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await res.text();
          throw new Error("Respuesta no es JSON: " + text.slice(0, 200));
        }
        const json = await res.json();
        setData(json);
        console.log('[MonitoringVerificationPanel] Valor crudo de timestamp:', json.timestamp);
      } catch (e) {
        setError(
          (e && e.stack) ? e.stack : (typeof e === 'object' ? JSON.stringify(e) : String(e))
        );
        setData(null);
      } finally {
        setLoading(false);
        timeout = setTimeout(fetchData, 30000);
      }
    }
    fetchData();
    return () => clearTimeout(timeout);
  }, []);

  function renderFechaSeguro(fecha) {
    try {
      if (!fecha) return "-";
      if (typeof fecha === "number") {
        const ms = fecha > 1e12 ? fecha : fecha * 1000;
        return new Date(ms).toLocaleString();
      }
      const ms = Date.parse(fecha);
      if (!isNaN(ms)) return new Date(ms).toLocaleString();
      return "(fecha inválida)";
    } catch (e) {
      return "(fecha inválida)";
    }
  }

  if (loading) return <div className="my-4">Cargando verificación de monitoreo...</div>;
  if (error) return <div className="my-4 text-red-600">ERROR VERIFICACIÓN MONITOREO: {error}</div>;
  if (!data) return null;

  return (
    <div className="my-4 p-4 bg-orange-50 border border-orange-200 rounded">
      <h2 className="text-lg font-bold text-orange-700 mb-2">Verificación de Monitoreo</h2>
      <div className="mb-2">
        <span className="font-semibold">Cargadores recibidos:</span> {data.cargadoresRecibidos}
      </div>
      <div className="mb-2">
        <span className="font-semibold">Total de conectores procesados:</span> {data.totalConectores}
      </div>
      <div className="mb-2">
        <span className="font-semibold">Detalle por cargador:</span>
        <ul className="list-disc ml-6">
          {data.detalleCargadores.map(c => (
            <li key={c.name}>{c.name}: {c.conectores} conectores</li>
          ))}
        </ul>
      </div>
      {data.faltantes && data.faltantes.length > 0 && (
        <div className="mb-2 text-red-700">
          <span className="font-semibold">Cargadores faltantes:</span> {data.faltantes.join(", ")}
        </div>
      )}
      {data.conectoresInactivos && data.conectoresInactivos.length > 0 && (
        <div className="mb-2 text-yellow-700">
          <span className="font-semibold">Conectores inactivos (&gt;2h):</span>
          <ul className="list-disc ml-6">
            {data.conectoresInactivos.map((c, i) => (
              <li key={c.chargerName + c.connectorId + i}>
                {c.chargerName} | {c.connectorId} ({c.minutosSinCambio} min sin cambio)
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-xs text-gray-500 mt-2">
        Última actualización: {renderFechaSeguro(data.timestamp)}<br />
        <span className="text-orange-600">Valor crudo: {String(data.timestamp)}</span>
      </div>
    </div>
  );
}
