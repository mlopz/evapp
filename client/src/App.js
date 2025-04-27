import React, { useEffect, useState } from 'react';
import ChargersList from './ChargersList';
import SessionsList from './SessionsList';
import ChargerStatusCards from './ChargerStatusCards';
import ChargerConnectorsView from './ChargerConnectorsView';
import ClearDatabasePage from './ClearDatabasePage';
import './index.css';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

const API_URL = process.env.REACT_APP_API_URL;

function App() {
  const [chargers, setChargers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [selectedCharger, setSelectedCharger] = useState(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState(null);

  const fetchChargers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/chargers`);
      const data = await res.json();
      setChargers(data.chargers || []);
      setError(null);
    } catch (err) {
      setError('Error al obtener los cargadores');
    } finally {
      setLoading(false);
    }
  };

  // Nuevo: fetch de todas las sesiones para el home
  const fetchAllSessions = async () => {
    try {
      const res = await fetch(`${API_URL}/api/sessions`);
      if (!res.ok) throw new Error('Respuesta no OK');
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Respuesta no es JSON');
      }
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : (data.sessions || []));
    } catch (err) {
      // No interrumpe el loading general
      console.error('Error al obtener todas las sesiones', err);
    }
  };

  useEffect(() => {
    let interval;
    fetchChargers();
    fetchAllSessions();
    interval = setInterval(() => {
      fetchChargers();
      fetchAllSessions();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Obtener sesiones filtradas por chargerName y connectorId
  const fetchSessions = async (chargerName, connectorId) => {
    setLoading(true);
    try {
      let url = `${API_URL}/api/sessions`;
      const params = [];
      if (chargerName) params.push(`chargerName=${encodeURIComponent(chargerName)}`);
      if (connectorId) params.push(`connectorId=${encodeURIComponent(connectorId)}`);
      if (params.length > 0) url += `?${params.join('&')}`;
      const res = await fetch(url);
      const data = await res.json();
      setSessions(data.sessions || []);
      setError(null);
    } catch (err) {
      setError('Error al obtener las sesiones');
    } finally {
      setLoading(false);
    }
  };

  // Cuando se selecciona un conector, obtener el historial real filtrado
  useEffect(() => {
    if (selectedConnectorId && selectedCharger) {
      fetchSessions(selectedCharger.name, selectedConnectorId);
    }
  }, [selectedConnectorId, selectedCharger]);

  useEffect(() => {
    if (sessions.length > 0) {
      console.log('Ejemplo de sesión:', sessions[0]);
    }
  }, [sessions]);

  return (
    <Router>
      <Routes>
        {/* Ruta oculta para limpiar la base de datos */}
        <Route path="/limpiar-db" element={<ClearDatabasePage />} />
        {/* Resto de la app */}
        <Route path="/*" element={
          <div className="min-h-screen bg-gray-100 p-4">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-2xl font-bold text-gray-800">EV Chargers Monitor</h1>
              {(selectedCharger || selectedConnectorId) && (
                <button
                  className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                  onClick={() => {
                    setSelectedConnectorId(null);
                    setSelectedCharger(null);
                  }}
                >Volver</button>
              )}
            </div>
            {loading && <div className="text-center text-gray-500">Cargando...</div>}
            {error && <div className="text-center text-red-500">{error}</div>}
            {!loading && !error && !selectedCharger && !selectedConnectorId && (
              <>
                <div className="flex flex-col gap-2 mb-4">
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 px-4 rounded shadow transition"
                      onClick={() => {
                        fetch(`${API_URL}/api/connector-sessions/export`).then(res => {
                          if (!res.ok) throw new Error('Error al exportar');
                          return res.blob();
                        }).then(blob => {
                          const link = document.createElement('a');
                          link.href = window.URL.createObjectURL(blob);
                          link.download = 'connector_sessions.csv';
                          document.body.appendChild(link);
                          link.click();
                          link.remove();
                        }).catch(err => alert('No se pudo exportar: ' + err.message));
                      }}
                    >
                      Exportar sesiones (CSV)
                    </button>
                    <button
                      className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded shadow transition"
                      onClick={() => {
                        fetch(`${API_URL}/api/chargers/export`).then(res => {
                          if (!res.ok) throw new Error('Error al exportar');
                          return res.blob();
                        }).then(blob => {
                          const link = document.createElement('a');
                          link.href = window.URL.createObjectURL(blob);
                          link.download = 'chargers_connectors.csv';
                          document.body.appendChild(link);
                          link.click();
                          link.remove();
                        }).catch(err => alert('No se pudo exportar: ' + err.message));
                      }}
                    >
                      Exportar cargadores (CSV)
                    </button>
                    <button
                      className="bg-gray-700 hover:bg-gray-800 text-white font-semibold py-2 px-4 rounded shadow transition"
                      onClick={() => {
                        fetch(`${API_URL}/api/charger-monitoring/export`).then(res => {
                          if (!res.ok) throw new Error('Error al exportar');
                          return res.blob();
                        }).then(blob => {
                          const link = document.createElement('a');
                          link.href = window.URL.createObjectURL(blob);
                          link.download = 'charger_monitoring.csv';
                          document.body.appendChild(link);
                          link.click();
                          link.remove();
                        }).catch(err => alert('No se pudo exportar: ' + err.message));
                      }}
                    >
                      Exportar eventos (CSV)
                    </button>
                  </div>
                  <div className="flex items-center justify-center gap-4 mt-2 text-gray-700">
                    <span className="font-semibold">
                      {chargers.length} cargadores rápidos
                    </span>
                    <span className="text-xl">•</span>
                    <span className="font-semibold">
                      {chargers.reduce((sum, c) => sum + (c.connectors?.length || 0), 0)} conectores totales
                    </span>
                  </div>
                </div>
                {/* Resumen de cargadores y conectores */}
                <ChargerStatusCards
                  chargers={chargers}
                  loading={loading}
                  selected={filterStatus}
                  onSelect={setFilterStatus}
                />
                <ChargersList
                  chargers={filterStatus ? chargers.filter(c =>
                    filterStatus === 'Charging' ? c.connectors.some(conn => conn.state === 'Charging') :
                    filterStatus === 'Available' ? (!c.connectors.some(conn => conn.state === 'Charging') && c.connectors.some(conn => conn.state === 'Available')) :
                    (!c.connectors.some(conn => conn.state === 'Charging') && !c.connectors.some(conn => conn.state === 'Available'))
                  ) : chargers}
                  onSelectCharger={setSelectedCharger}
                  sessions={sessions}
                />
              </>
            )}
            {/* Mostrar conectores de un cargador seleccionado */}
            {!loading && !error && selectedCharger && !selectedConnectorId && (
              <ChargerConnectorsView
                charger={selectedCharger}
                onSelectConnector={setSelectedConnectorId}
                sessions={sessions}
              />
            )}
            {/* Mostrar sesiones de un conector seleccionado */}
            {!loading && !error && selectedConnectorId && selectedCharger && (
              <SessionsList
                sessions={sessions}
                onBack={() => setSelectedConnectorId(null)}
                connectorId={selectedConnectorId}
              />
            )}
          </div>
        } />
      </Routes>
    </Router>
  );
}

export default App;
