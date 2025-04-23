import React from 'react';

const statusColors = {
  Charging: 'bg-orange-500 text-white',
  Available: 'bg-green-500 text-white',
  Unavailable: 'bg-gray-400 text-white',
};

function ConnectorItem({ connector }) {
  const { type, state, accumulatedMinutes } = connector;
  const colorClass = statusColors[state] || 'bg-gray-200';

  return (
    <div className={`flex items-center justify-between rounded px-3 py-2 mb-2 shadow ${colorClass}`}>
      <div className="font-semibold">{type}</div>
      <div className="capitalize">{state}</div>
      <div className="text-sm">{accumulatedMinutes} min Charging</div>
    </div>
  );
}

export default ConnectorItem;
