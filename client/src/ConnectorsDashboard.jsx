import React, { useEffect, useState } from 'react';

function ConnectorsDashboard() {
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/connector-sessions/summary`)
      .then(res => res.json())
      .then(data => {
        setConnectors(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching connector sessions:', err);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Cargando conectores...</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {connectors.map(conn => (
        <ConnectorCard key={conn.charger_name + conn.connector_id} data={conn} />
      ))}
    </div>
  );
}

function ConnectorCard({ data }) {
  return (
    <div className={`border rounded-lg shadow p-4 ${data.active ? 'bg-green-100' : 'bg-gray-100'}`}>
      <h3 className="font-bold">{data.charger_name}</h3>
      <div className="text-sm text-gray-600">Tipo: {data.connector_type} | Potencia: {data.power} kW</div>
      <div className="mt-2">
        {data.active ? (
          <>
            <span className="text-green-700 font-semibold">Cargando</span><br />
            <span>Inicio: {new Date(data.session_start).toLocaleString()}</span>
          </>
        ) : (
          <>
            <span className="text-gray-700 font-semibold">Libre</span><br />
            {data.session_end && (
              <>
                <span>Última sesión:</span><br />
                <span>Inicio: {new Date(data.session_start).toLocaleString()}</span><br />
                <span>Fin: {new Date(data.session_end).toLocaleString()}</span><br />
                <span>Duración: {data.duration_minutes} min</span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ConnectorsDashboard;
