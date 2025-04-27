import React, { useEffect, useState } from 'react';
import { getConnectorAccumulatedMinutes } from './utils/sessionUtils';

const stateColors = {
  active: 'bg-green-100 text-green-700 border-green-400',
  inactive: 'bg-gray-100 text-gray-600 border-gray-400',
};

export default function ChargerConnectorsView({ charger, onSelectConnector, sessions = [] }) {
  // Log para depuración: ver qué conectores se están mostrando
  console.log('Conectores mostrados:', charger.connectors);

  // Buscar la sesión activa o la última sesión cerrada para cada conector
  function getSessionSummary(connectorId) {
    // Prioridad: sesión activa, si no, última cerrada
    const active = sessions.find(
      s => s.charger_name === charger.name && s.connector_id === connectorId && s.active
    );
    if (active) return { ...active, status: 'active' };
    // Buscar la última sesión cerrada
    const closed = sessions
      .filter(s => s.charger_name === charger.name && s.connector_id === connectorId && !s.active)
      .sort((a, b) => new Date(b.session_end) - new Date(a.session_start))[0];
    if (closed) return { ...closed, status: 'inactive' };
    return null;
  }

  // --- Heartbeat integration ---
  const [selectedConnector, setSelectedConnector] = useState(null);
  useEffect(() => {
    let heartbeatInterval = null;
    // Solo enviar heartbeat si hay un conector seleccionado y está Charging
    if (selectedConnector && selectedConnector.status === 'Charging') {
      const sendHeartbeat = () => {
        fetch(`${process.env.REACT_APP_API_URL}/api/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            charger_name: charger.name,
            connector_id: selectedConnector.connectorId
          })
        })
        .then(res => res.json())
        .then(data => {
          if (!data.ok) {
            console.warn('Heartbeat error:', data.error);
          }
        })
        .catch(err => console.warn('Heartbeat fetch error:', err));
      };
      sendHeartbeat(); // Primer ping inmediato
      heartbeatInterval = setInterval(sendHeartbeat, 60 * 1000); // Cada 60 segundos
    }
    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    };
  }, [selectedConnector, charger]);

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="text-xl font-bold mb-4 text-center">{charger.name}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {charger.connectors.map((conn) => {
          const session = getSessionSummary(conn.connectorId);
          const isActive = session && session.status === 'active';
          // Calcular minutos acumulados para este conector
          const acumulado = getConnectorAccumulatedMinutes(sessions, charger.name, conn.connectorId);
          return (
            <button
              key={conn.connectorId}
              onClick={() => {
                onSelectConnector(conn.connectorId);
                setSelectedConnector(session);
              }}
              className={`rounded-xl shadow-lg p-6 transition-transform hover:scale-105 border-2 w-full text-left ${
                isActive ? stateColors.active : stateColors.inactive
              }`}
              type="button"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                <span className="font-bold text-lg text-gray-800 flex-1 truncate">{conn.type}</span>
                <span className={`text-xs px-2 py-1 rounded ${isActive ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-700'}`}>{isActive ? 'Cargando' : 'Libre'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                <span className="font-medium">Potencia:</span> <span>{conn.power} kW</span>
              </div>
              <div className="text-sm mt-2">
                {session ? (
                  isActive ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-green-700">Inicio:</span>
                        <span>{new Date(session.session_start).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-medium text-green-700">Duración:</span>
                        <span>{Math.floor((Date.now() - new Date(session.session_start)) / 60000)} min</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-700">Última sesión:</span>
                        <span>{new Date(session.session_start).toLocaleString()}</span>
                        <span className="mx-1">→</span>
                        <span>{new Date(session.session_end).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-medium text-gray-700">Duración:</span>
                        <span>{session.duration_minutes} min</span>
                      </div>
                    </>
                  )
                ) : (
                  <span className="italic text-gray-400">Sin sesiones registradas</span>
                )}
              </div>
              <div className="flex justify-between items-center mt-4">
                <span className="text-xs text-gray-400">ID: {conn.connectorId}</span>
                <span className="text-xs font-semibold text-orange-600">Minutos acumulados: {acumulado} min</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
