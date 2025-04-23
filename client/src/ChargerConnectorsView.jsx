import React from 'react';

const stateColors = {
  Charging: 'bg-orange-100 text-orange-700 border-orange-400',
  Available: 'bg-green-100 text-green-700 border-green-400',
  Unavailable: 'bg-gray-200 text-gray-600 border-gray-400',
};

export default function ChargerConnectorsView({ charger, onSelectConnector, sessions = [] }) {
  // Log para depuración: ver qué conectores se están mostrando
  console.log('Conectores mostrados:', charger.connectors);

  // Para cada conector, calcular cantidad de sesiones y minutos acumulados
  function getConnectorStats(connectorType) {
    const filtered = sessions.filter(s => s.chargerName === charger.name && s.connectorType === connectorType && s.start && (s.end || s.end === null));
    const count = filtered.length;
    const minutes = filtered.reduce((sum, s) => {
      if (typeof s.durationMinutes === 'number') {
        return sum + s.durationMinutes;
      }
      if (s.start && s.end) {
        return sum + Math.round((s.end - s.start) / 60000);
      }
      return sum;
    }, 0);
    return { count, minutes };
  }

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="text-xl font-bold mb-4 text-center">{charger.name}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {charger.connectors.map((conn, idx) => {
          const stats = getConnectorStats(conn.type);
          return (
            <button
              key={conn.type}
              onClick={() => onSelectConnector(conn)}
              className={`border rounded-lg p-4 flex flex-col gap-2 shadow hover:bg-gray-50 ${stateColors[conn.state]}`}
              type="button"
            >
              <span className="text-lg font-semibold capitalize">{conn.type}</span>
              <span className="text-xs">Potencia: <b>{conn.power} kW</b></span>
              <span className="text-xs">Estado: <b>{conn.state}</b></span>
              <span className="text-xs">Sesiones: <b>{stats.count}</b></span>
              <span className="text-xs">Minutos acumulados: <b>{stats.minutes}</b></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
