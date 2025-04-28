import React, { useEffect, useState } from "react";

export default function ConnectorStatsCard({ connector }) {
  const [stats, setStats] = useState({ total_sessions: '-', total_minutes: '-' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connector?.connectorId) return;
    setLoading(true);
    fetch(`${process.env.REACT_APP_API_URL}/api/sessions/stats?connector_id=${encodeURIComponent(connector.connectorId)}`)
      .then(res => res.json())
      .then(data => {
        setStats({
          total_sessions: data.total_sessions ?? '-',
          total_minutes: data.total_minutes ?? '-'
        });
        setLoading(false);
      })
      .catch(() => {
        setStats({ total_sessions: '-', total_minutes: '-' });
        setLoading(false);
      });
  }, [connector?.connectorId]);

  return (
    <div
      className={`rounded-lg border shadow p-4 flex flex-col gap-1 ${connector.status === 'Charging' ? 'border-orange-500 bg-orange-50' : connector.status === 'Available' ? 'border-green-500 bg-green-50' : 'border-gray-400 bg-gray-100'}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-gray-800">Conector:</span>
        <span className="text-gray-700">{connector.connectorId}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-800">Estado:</span>
        <span className={`font-bold ${connector.status === 'Charging' ? 'text-orange-600' : connector.status === 'Available' ? 'text-green-600' : 'text-gray-500'}`}>{connector.status}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-orange-700">Minutos:</span>
        <span className="text-sm font-semibold">{loading ? <span className="animate-pulse">...</span> : stats.total_minutes}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-orange-700">Sesiones:</span>
        <span className="text-sm font-semibold">{loading ? <span className="animate-pulse">...</span> : stats.total_sessions}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Tipo:</span>
        <span className="text-xs text-gray-600">{connector.type}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Potencia:</span>
        <span className="text-xs text-gray-600">{connector.power} kW</span>
      </div>
    </div>
  );
}
