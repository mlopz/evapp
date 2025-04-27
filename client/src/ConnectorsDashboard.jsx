import React, { useEffect, useState } from 'react';

function downloadCsv(url, filename) {
  fetch(url)
    .then(res => {
      if (!res.ok) throw new Error('Error al exportar');
      return res.blob();
    })
    .then(blob => {
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    })
    .catch(err => alert('No se pudo exportar: ' + err.message));
}

function ConnectorsDashboard() {
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/connector-sessions/summary`)
      .then(res => res.json())
      .then(data => {
        setConnectors(data);
        setLoading(false);
        console.log('Datos recibidos en ConnectorsDashboard:', data);
      })
      .catch(err => {
        console.error('Error fetching connector sessions:', err);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Cargando conectores...</div>;
  if (!connectors.length) return <div className="text-center text-gray-500">No hay conectores registrados aún.</div>;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 px-4 rounded shadow transition"
          onClick={() => downloadCsv(`${process.env.REACT_APP_API_URL || ''}/api/connector-sessions/export`, 'connector_sessions.csv')}
        >
          Exportar sesiones (CSV)
        </button>
        <button
          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded shadow transition"
          onClick={() => downloadCsv(`${process.env.REACT_APP_API_URL || ''}/api/chargers/export`, 'chargers_connectors.csv')}
        >
          Exportar cargadores (CSV)
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {connectors.map(conn => (
          <ConnectorCard key={conn.charger_name + conn.connector_id} data={conn} />
        ))}
      </div>
    </div>
  );
}

function ConnectorCard({ data }) {
  const isActive = data.active;
  return (
    <div
      className={`rounded-xl shadow-lg p-6 transition-transform hover:scale-105 border-2 ${
        isActive ? 'bg-gradient-to-br from-green-300 to-green-100 border-green-400' : 'bg-gradient-to-br from-gray-100 to-gray-50 border-gray-300'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-400'}`}></div>
        <h3 className="font-bold text-lg text-gray-800 flex-1 truncate">{data.charger_name}</h3>
        <span className={`text-xs px-2 py-1 rounded ${isActive ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-700'}`}>{isActive ? 'Cargando' : 'Libre'}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
        <span className="font-medium">Tipo:</span> <span>{data.connector_type}</span>
        <span className="mx-2">|</span>
        <span className="font-medium">Potencia:</span> <span>{data.power} kW</span>
      </div>
      <div className="text-sm mt-2">
        {isActive ? (
          <>
            <div className="flex items-center gap-2">
              <span className="font-medium text-green-700">Inicio:</span>
              <span>{new Date(data.session_start).toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-medium text-green-700">Duración:</span>
              <span>{Math.floor((Date.now() - new Date(data.session_start)) / 60000)} min</span>
            </div>
          </>
        ) : (
          data.session_end ? (
            <>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">Última sesión:</span>
                <span>{new Date(data.session_start).toLocaleString()}</span>
                <span className="mx-1">→</span>
                <span>{new Date(data.session_end).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-medium text-gray-700">Duración:</span>
                <span>{data.duration_minutes} min</span>
              </div>
            </>
          ) : (
            <span className="italic text-gray-400">Sin sesiones registradas</span>
          )
        )}
      </div>
      <div className="flex justify-end mt-4">
        <span className="text-xs text-gray-400">ID: {data.connector_id}</span>
      </div>
    </div>
  );
}

export default ConnectorsDashboard;
