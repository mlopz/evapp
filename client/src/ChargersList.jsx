import React, { useState } from 'react';
import ConnectorItem from './ConnectorItem';

function ChargersList({ chargers, onSelectCharger, sessions = [] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' o 'asc'

  // Ordenar cargadores por nombre
  const sortedChargers = [...chargers].sort((a, b) => a.name.localeCompare(b.name));

  // Filtrar por nombre según el searchTerm
  const filteredChargers = sortedChargers.filter(charger =>
    charger.name.toLowerCase().includes(searchTerm.trim().toLowerCase())
  );

  // Calcular minutos acumulados por cargador usando el campo de conectores
  const chargersWithStats = filteredChargers.map((charger) => {
    const totalMinutes = (charger.connectors || []).reduce((sum, conn) => sum + (conn.accumulatedMinutes || 0), 0);
    // Contar sesiones de todos los conectores de este cargador
    const sessionCount = sessions
      ? sessions.filter(s => s.chargerName === charger.name).length
      : 0;
    return { ...charger, totalMinutes, sessionCount };
  });

  // Ordenar cargadores por minutos acumulados
  const sortedChargersWithStats = [...chargersWithStats].sort((a, b) =>
    sortOrder === 'desc' ? b.totalMinutes - a.totalMinutes : a.totalMinutes - b.totalMinutes
  );

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          className="w-full px-3 py-2 border rounded shadow focus:outline-none focus:ring-2 focus:ring-blue-300"
          placeholder="Buscar cargador..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="flex justify-end mb-2">
        <label className="mr-2 text-gray-600">Ordenar por minutos:</label>
        <select
          className="border rounded px-2 py-1"
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value)}
        >
          <option value="desc">Mayor a menor</option>
          <option value="asc">Menor a mayor</option>
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {sortedChargersWithStats.length === 0 ? (
          <div className="col-span-full text-center text-gray-500">No se encontraron cargadores.</div>
        ) : (
          sortedChargersWithStats.map((charger) => {
            // Estado principal: Charging > Available > Unavailable
            let status = 'Unavailable';
            if (charger.connectors.some(c => c.state === 'Charging')) status = 'Charging';
            else if (charger.connectors.some(c => c.state === 'Available')) status = 'Available';
            // Potencia máxima
            const maxPower = Math.max(...charger.connectors.map(c => c.power || 0));
            // Número de conectores
            const connectorCount = charger.connectors.length;
            return (
              <button
                key={charger.name}
                className={`bg-white border rounded-lg shadow-sm p-4 flex flex-col gap-2 hover:shadow-md transition cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-blue-300 ${status === 'Charging' ? 'border-orange-400' : status === 'Available' ? 'border-green-400' : 'border-gray-400'}`}
                onClick={() => onSelectCharger(charger)}
                type="button"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${status === 'Charging' ? 'bg-orange-500' : status === 'Available' ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                  <span className="font-bold text-base text-gray-800 truncate" title={charger.name}>{charger.name}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  <span title="Conectores" className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 7h10v10H7z"/><path d="M17 7V5a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v2"/></svg>
                    {connectorCount}
                  </span>
                  <span title="Potencia máxima" className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    {maxPower}kW
                  </span>
                  <span title="Minutos acumulados" className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
                    {charger.totalMinutes} min
                  </span>
                  <span title="Cantidad de sesiones" className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
                    {charger.sessionCount}
                  </span>
                  <span title="Ubicación" className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                    {charger.latitude.toFixed(4)}, {charger.longitude.toFixed(4)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ChargersList;
