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
  const [selectedConnector, setSelectedConnector] = useState(null);

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

  useEffect(() => {
    let interval;
    fetchChargers();
    interval = setInterval(fetchChargers, 30000);
    return () => clearInterval(interval);
  }, []);

  // Esta función ahora recibe el cargador y conector seleccionados
  const fetchSessions = async (chargerName, connectorType) => {
    setLoading(true);
    try {
      // Construir la URL con los parámetros de filtro
      let url = `${API_URL}/api/sessions`;
      const params = [];
      if (chargerName) params.push(`chargerName=${encodeURIComponent(chargerName)}`);
      if (connectorType) params.push(`connectorType=${encodeURIComponent(connectorType)}`);
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
    if (selectedConnector && selectedCharger) {
      fetchSessions(selectedCharger.name, selectedConnector.type);
    }
  }, [selectedConnector, selectedCharger]);

  // Mostrar la estructura de una sesión en consola para debug
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
              {(selectedCharger || selectedConnector) && (
                <button
                  className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                  onClick={() => {
                    setSelectedConnector(null);
                    setSelectedCharger(null);
                  }}
                >Volver</button>
              )}
            </div>
            {loading && <div className="text-center text-gray-500">Cargando...</div>}
            {error && <div className="text-center text-red-500">{error}</div>}
            {!loading && !error && !selectedCharger && !selectedConnector && (
              <>
                {/* Resumen de cargadores y conectores */}
                <div className="flex items-center justify-center gap-4 mb-2 text-gray-700">
                  <span className="font-semibold">
                    {chargers.length} cargadores rápidos
                  </span>
                  <span className="text-xl">•</span>
                  <span className="font-semibold">
                    {chargers.reduce((sum, c) => sum + (c.connectors?.length || 0), 0)} conectores totales
                  </span>
                </div>
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
            {!loading && !error && selectedCharger && !selectedConnector && (
              <ChargerConnectorsView
                charger={selectedCharger}
                onSelectConnector={setSelectedConnector}
                sessions={sessions}
              />
            )}
            {/* Mostrar sesiones de un conector seleccionado */}
            {!loading && !error && selectedConnector && selectedCharger && (
              <SessionsList
                sessions={sessions}
                onBack={() => setSelectedConnector(null)}
                connector={selectedConnector}
              />
            )}
          </div>
        } />
      </Routes>
    </Router>
  );
}

export default App;
