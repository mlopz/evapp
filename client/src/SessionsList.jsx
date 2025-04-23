import React from 'react';

function formatDate(ts) {
  if (!ts) return '-';
  const date = new Date(ts);
  return date.toLocaleString('es-AR', { hour12: false });
}

function SessionsList({ sessions, onBack, connectorId }) {
  // Log de depuración para ver las sesiones recibidas
  console.log('Sesiones a mostrar:', sessions, 'para connectorId:', connectorId);

  // Filtrar sesiones por connectorId
  const filteredSessions = connectorId
    ? sessions.filter(s => s.connectorId === connectorId)
    : sessions;

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-4 mb-4">
        {onBack && (
          <button
            className="px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
            onClick={onBack}
          >Volver</button>
        )}
        <h2 className="text-xl font-bold">Historial de sesiones</h2>
      </div>
      {filteredSessions.length === 0 ? (
        <div className="text-gray-600">No hay sesiones para este conector.</div>
      ) : (
        <ul className="space-y-4">
          {filteredSessions.map((s, i) => (
            <li key={i} className="border rounded p-3 bg-white shadow">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Inicio:</span>
                <span>{s.start ? new Date(s.start).toLocaleString('es-AR') : '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Fin:</span>
                <span>{s.end ? new Date(s.end).toLocaleString('es-AR') : (s.end === null ? 'En curso' : '-')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Duración:</span>
                <span>{typeof s.durationMinutes === 'number' ? s.durationMinutes + ' min' : '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Energía:</span>
                <span>{s.power ? s.power + ' kW' : '-'}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>ID:</span>
                <span>{s.connectorId}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SessionsList;
