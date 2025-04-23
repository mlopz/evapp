import React from 'react';

function formatDate(ts) {
  if (!ts) return '-';
  const date = new Date(ts);
  return date.toLocaleString('es-AR', { hour12: false });
}

function SessionsList({ sessions, onBack, connector }) {
  // Encontrar sesión activa si corresponde
  let activeSession = null;
  if (connector && connector.state === 'Charging') {
    activeSession = sessions.find(s => !s.endTime && s.connectorType === connector.type);
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-4 mb-4">
        {onBack && (
          <button
            className="px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
            onClick={onBack}
          >Volver</button>
        )}
        <h2 className="text-xl font-bold text-center flex-1">
          {connector ? `Sesiones de ${connector.type}` : 'Sesiones'}
        </h2>
      </div>
      {/* Sesión activa */}
      {activeSession && (
        <div className="mb-4 p-4 rounded-lg border-2 border-orange-400 bg-orange-50 flex items-center gap-4">
          <svg className="w-8 h-8 text-orange-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          <div>
            <div className="font-semibold text-orange-700">Sesión activa</div>
            <div className="text-xs text-gray-700">Inicio: {formatDate(activeSession.start)}</div>
            <div className="text-xs text-gray-700">Energía: {activeSession.energy ? activeSession.energy + ' kWh' : '-'}</div>
          </div>
        </div>
      )}
      {sessions.length === 0 ? (
        <div className="text-center text-gray-500">No hay sesiones para este conector.</div>
      ) : (
        <ul className="divide-y divide-gray-200">
          {sessions.map((s, idx) => (
            <li key={s.startTime + '-' + idx} className="py-2 px-2 flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Inicio:</span>
                <span>{s.startTime ? new Date(s.startTime).toLocaleString('es-AR') : '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Fin:</span>
                <span>{s.endTime ? new Date(s.endTime).toLocaleString('es-AR') : '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Energía:</span>
                <span>{s.energy ? s.energy + ' kWh' : '-'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SessionsList;
