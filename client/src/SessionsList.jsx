import React from 'react';

function formatDate(ts) {
  if (!ts) return '-';
  const date = new Date(ts);
  return date.toLocaleString('es-AR', { hour12: false });
}

function safe(val) {
  return val !== null && val !== undefined && val !== '' ? val : '-';
}

// --- Utilidad para mostrar badge de calidad ---
function QualityBadge({ quality }) {
  let color = 'bg-gray-200 text-gray-700';
  let label = quality || 'Sin dato';
  if (quality === 'OK') {
    color = 'bg-green-100 text-green-700 border-green-400';
    label = 'Correcta';
  } else if (quality === 'SESSION_TIMEOUT') {
    color = 'bg-orange-100 text-orange-700 border-orange-400';
    label = 'Timeout (2h)';
  } else if (quality === 'INACTIVITY_TIMEOUT') {
    color = 'bg-red-100 text-red-700 border-red-400';
    label = 'Inactividad (>5min)';
  } else if (quality === 'FORCED_CLOSE') {
    color = 'bg-gray-400 text-white border-gray-600';
    label = 'Cierre forzado';
  } else if (quality === 'TOO_LONG') {
    color = 'bg-yellow-100 text-yellow-800 border-yellow-500';
    label = 'Demasiado larga';
  } else if (quality === 'INVALID') {
    color = 'bg-red-700 text-white border-red-900';
    label = 'Inválida';
  }
  return (
    <span className={`inline-block px-2 py-1 rounded text-xs font-bold border ${color}`} title={quality}>
      {label}
    </span>
  );
}

function SessionsList({ sessions, onBack, connectorId }) {
  // Log de depuración para ver las sesiones recibidas
  console.log('Sesiones a mostrar:', sessions, 'para connectorId:', connectorId);

  // Filtrar sesiones por connectorId
  const filteredSessions = connectorId
    ? sessions.filter(s => s.connector_id === connectorId)
    : sessions;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-4">
        {onBack && (
          <button
            className="px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
            onClick={onBack}
          >
            Volver
          </button>
        )}
        <h2 className="text-xl font-bold text-gray-800">Historial de sesiones</h2>
      </div>
      {filteredSessions.length === 0 ? (
        <div className="text-center text-gray-500">No hay sesiones registradas para este conector.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white rounded shadow">
            <thead>
              <tr className="bg-gray-100 text-gray-700 text-sm">
                <th className="px-3 py-2">Inicio</th>
                <th className="px-3 py-2">Fin</th>
                <th className="px-3 py-2">Duración</th>
                <th className="px-3 py-2">Energía</th>
                <th className="px-3 py-2">Potencia</th>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Calidad</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((s, i) => (
                <tr key={s.id || i} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">{formatDate(s.session_start)}</td>
                  <td className="px-3 py-2">{formatDate(s.session_end)}</td>
                  <td className="px-3 py-2">{safe(s.duration_minutes)} min</td>
                  <td className="px-3 py-2">{safe(s.energy_kwh)} kWh</td>
                  <td className="px-3 py-2">{safe(s.power)} kW</td>
                  <td className="px-3 py-2">{safe(s.id)}</td>
                  <td className="px-3 py-2"><QualityBadge quality={s.quality} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Leyenda explicativa */}
      <div className="mt-4 text-xs text-gray-500">
        <b>Leyenda calidad de sesión:</b>
        <span className="ml-2"><QualityBadge quality="OK" /> Correcta</span>
        <span className="ml-2"><QualityBadge quality="SESSION_TIMEOUT" /> Timeout (2h)</span>
        <span className="ml-2"><QualityBadge quality="INACTIVITY_TIMEOUT" /> Inactividad (&gt;5min)</span>
        <span className="ml-2"><QualityBadge quality="FORCED_CLOSE" /> Cierre forzado</span>
        <span className="ml-2"><QualityBadge quality="TOO_LONG" /> Demasiado larga</span>
        <span className="ml-2"><QualityBadge quality="INVALID" /> Inválida</span>
      </div>
    </div>
  );
}

export default SessionsList;
