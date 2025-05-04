import React, { useState, useEffect } from "react";

export default function MonitoringVerificationPanel() {
  const [expandido, setExpandido] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!expandido) return;
    setLoading(true);
    setError("");
    fetch("https://evapp-production.up.railway.app/api/monitoring-verification", { cache: "no-store" })
      .then(res => {
        if (!res.ok) throw new Error("No hay datos de verificación disponibles");
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          return res.text().then(text => {
            throw new Error(
              `Respuesta inesperada del servidor. Tipo: ${contentType}. Cuerpo: ${text.slice(0, 200)}`
            );
          });
        }
        return res.json();
      })
      .then(json => setData(json))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [expandido]);

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

  return (
    <div className="bg-white rounded shadow mb-4">
      <button
        className="w-full text-left px-4 py-3 font-semibold bg-orange-500 text-white rounded-t focus:outline-none hover:bg-orange-600 transition"
        onClick={() => setExpandido(!expandido)}
        aria-expanded={expandido}
      >
        {expandido ? "Ocultar verificación de monitoreo" : "Verificación de monitoreo"}
      </button>
      {expandido && (
        <div className="p-4 border-t border-orange-200">
          {loading && <div className="text-gray-500">Cargando...</div>}
          {error && <div className="text-red-600 font-semibold">ERROR VERIFICACIÓN MONITOREO: {error}</div>}
          {data && (
            <div>
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
          )}
        </div>
      )}
    </div>
  );
}
