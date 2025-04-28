import React, { useEffect, useState } from 'react';

function ChargerStatusCards({ chargers, loading, onSelectCharger, selectedCharger }) {
  // Contar cargadores en cada estado en tiempo real
  const counts = { Charging: 0, Available: 0, Unavailable: 0 };
  chargers.forEach(c => {
    (c.connectors || []).forEach(conn => {
      if (conn.status === 'Charging') counts.Charging++;
      else if (conn.status === 'Available') counts.Available++;
      else if (conn.status === 'Unavailable') counts.Unavailable++;
    });
  });

  const statusConfig = {
    Charging: {
      label: 'Cargando',
      icon: <span className="text-3xl">⚡️</span>,
      color: 'bg-orange-500',
    },
    Available: {
      label: 'Disponible',
      icon: <span className="text-3xl">✅</span>,
      color: 'bg-green-500',
    },
    Unavailable: {
      label: 'Fuera de servicio',
      icon: <span className="text-3xl">⛔️</span>,
      color: 'bg-gray-400',
    },
  };

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {Object.entries(statusConfig).map(([status, cfg]) => (
        <button
          key={status}
          className={`rounded-xl shadow-lg p-6 flex flex-col items-center border-2 w-full text-left ${cfg.color} bg-opacity-10 hover:bg-opacity-20 transition-transform hover:scale-105 ${selectedCharger ? 'opacity-50' : ''}`}
          disabled={!!selectedCharger}
        >
          <div className="mb-2">{cfg.icon}</div>
          <div className="text-2xl font-bold mb-1">{loading ? <span className="animate-pulse">...</span> : counts[status]}</div>
          <div className="text-base font-semibold">{cfg.label}</div>
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

// Elimina el renderizado de la lista larga de ChargerStatusCard en el home
// Solo deja ChargerStatusCards (estado general en tiempo real)
// Si necesitas mostrar los totales históricos por cargador, hazlo solo en la vista de detalle, no aquí

export default ChargerStatusCards;
