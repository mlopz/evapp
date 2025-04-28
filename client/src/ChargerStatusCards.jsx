import React, { useEffect, useState } from 'react';

const statusConfig = {
  Charging: {
    label: 'Cargando',
    color: 'bg-orange-100 text-orange-800 border-orange-400',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
    ),
  },
  Available: {
    label: 'Disponible',
    color: 'bg-green-100 text-green-800 border-green-400',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" /></svg>
    ),
  },
  Unavailable: {
    label: 'No disponible',
    color: 'bg-gray-200 text-gray-600 border-gray-400',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="8" y1="8" x2="16" y2="16" /><line x1="16" y1="8" x2="8" y2="16" /></svg>
    ),
  },
};

export default function ChargerStatusCards({ chargers, loading, selected, onSelect }) {
  // Contar cargadores por estado principal (el estado general del cargador)
  const counts = { Charging: 0, Available: 0, Unavailable: 0 };
  chargers.forEach(charger => {
    // Considerar un cargador "Cargando" si algún conector está Charging
    if (charger.connectors.some(c => c.state === 'Charging')) counts.Charging++;
    else if (charger.connectors.some(c => c.state === 'Available')) counts.Available++;
    else counts.Unavailable++;
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      {Object.entries(statusConfig).map(([status, cfg]) => (
        <button
          key={status}
          onClick={() => onSelect(selected === status ? null : status)}
          className={`flex flex-col items-center justify-center border-2 rounded-xl p-6 shadow transition transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 ${cfg.color} ${selected === status ? 'ring-4 ring-blue-300 border-blue-500' : ''}`}
          disabled={loading}
          type="button"
        >
          <div className="mb-2">{cfg.icon}</div>
          <div className="text-2xl font-bold mb-1">{loading ? <span className="animate-pulse">...</span> : counts[status]}</div>
          <div className="text-base font-semibold">{cfg.label}</div>
          {chargers.map(charger => (
            <ChargerStatusCard key={charger.name} charger={charger} />
          ))}
        </button>
      ))}
    </div>
  );
}

function ChargerStatusCard({ charger }) {
  const [stats, setStats] = useState({ total_sessions: 0, total_minutes: 0 });
  useEffect(() => {
    if (!charger?.name) return;
    fetch(`${process.env.REACT_APP_API_URL}/api/sessions/stats?charger_name=${encodeURIComponent(charger.name)}`)
      .then(res => res.json())
      .then(data => setStats({
        total_sessions: data.total_sessions || 0,
        total_minutes: data.total_minutes || 0
      }))
      .catch(() => setStats({ total_sessions: 0, total_minutes: 0 }));
  }, [charger?.name]);

  return (
    <div className="flex flex-col items-center">
      <span className="text-2xl font-bold text-orange-600">{stats.total_minutes}</span>
      <span className="text-gray-600">Minutos acumulados</span>
      <span className="text-2xl font-bold text-orange-600 mt-2">{stats.total_sessions}</span>
      <span className="text-gray-600">Sesiones totales</span>
    </div>
  );
}
