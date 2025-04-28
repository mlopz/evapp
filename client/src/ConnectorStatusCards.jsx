import React from 'react';

const statusConfig = {
  Charging: {
    label: 'Cargando',
    color: 'bg-orange-500',
    icon: <span className="text-3xl">⚡️</span>,
  },
  Available: {
    label: 'Disponible',
    color: 'bg-green-500',
    icon: <span className="text-3xl">✅</span>,
  },
  Unavailable: {
    label: 'Fuera de servicio',
    color: 'bg-gray-400',
    icon: <span className="text-3xl">⛔️</span>,
  },
};

export default function ConnectorStatusCards({ chargers, onSelectStatus, selectedStatus }) {
  // Contar conectores en cada estado
  const counts = { Charging: 0, Available: 0, Unavailable: 0 };
  chargers.forEach(charger => {
    (charger.connectors || []).forEach(conn => {
      if (conn.status === 'Charging') counts.Charging++;
      else if (conn.status === 'Available') counts.Available++;
      else if (conn.status === 'Unavailable') counts.Unavailable++;
    });
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-8">
      {Object.entries(statusConfig).map(([status, cfg]) => (
        <button
          key={status}
          className={`rounded-xl shadow-lg p-8 flex flex-col items-center border-2 w-full text-left ${cfg.color} bg-opacity-10 focus:outline-none focus:ring-2 focus:ring-orange-400 ${selectedStatus === status ? 'ring-4 border-orange-500' : ''}`}
          onClick={() => onSelectStatus(status)}
        >
          <div className="mb-2">{cfg.icon}</div>
          <div className="text-4xl font-bold mb-1 text-orange-700">{counts[status]}</div>
          <div className="text-base font-semibold text-gray-800">{cfg.label}</div>
        </button>
      ))}
    </div>
  );
}
