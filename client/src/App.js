import React, { useEffect, useState } from 'react';
import ChargersList from './ChargersList';
import SessionsList from './SessionsList';
import ChargerStatusCards from './ChargerStatusCards';
import ChargerConnectorsView from './ChargerConnectorsView';
import ClearDatabasePage from './ClearDatabasePage';
import './index.css';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import ConnectorStatusCards from './ConnectorStatusCards';

const API_URL = process.env.REACT_APP_API_URL;

function ChargerStatsRow({ charger }) {
  const [stats, setStats] = useState({ total_sessions: 0, total_minutes: 0 });
  useEffect(() => {
    fetch(`${process.env.REACT_APP_API_URL}/api/sessions/stats?charger_name=${encodeURIComponent(charger.name)}`)
      .then(res => res.json())
      .then(data => setStats({
        total_sessions: data.total_sessions || 0,
        total_minutes: data.total_minutes || 0
      }))
      .catch(() => setStats({ total_sessions: 0, total_minutes: 0 }));
  }, [charger.name]);
  return (
    <tr className="border-b">
      <td className="py-2 px-4 font-semibold text-gray-800">{charger.name}</td>
      <td className="py-2 px-4 text-orange-700">{stats.total_minutes}</td>
      <td className="py-2 px-4 text-orange-700">{stats.total_sessions}</td>
    </tr>
  );
}

function App() {
  const [chargers, setChargers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [selectedCharger, setSelectedCharger] = useState(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState(null);
  const [stats, setStats] = useState({ total_sessions: 0, total_minutes: 0 });
  const [selectedStatus, setSelectedStatus] = useState(null);

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
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_URL}/api/sessions/stats`);
        const data = await res.json();
        setStats({
          total_sessions: data.total_sessions || 0,
          total_minutes: data.total_minutes || 0
        });
      } catch (err) {
        setStats({ total_sessions: 0, total_minutes: 0 });
      }
    };
    fetchStats();
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

  // Filtrar cargadores según el estado seleccionado
  const filteredChargers = selectedStatus
    ? chargers.filter(c => (c.connectors || []).some(conn => conn.status === selectedStatus))
    : [];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <ConnectorStatusCards chargers={chargers} onSelectStatus={setSelectedStatus} selectedStatus={selectedStatus} />
      {selectedStatus && (
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4 text-gray-800">Cargadores en estado "{selectedStatus === 'Charging' ? 'Cargando' : selectedStatus === 'Available' ? 'Disponible' : 'Fuera de servicio'}"</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white rounded shadow">
              <thead>
                <tr>
                  <th className="py-2 px-4 text-left">Nombre</th>
                  <th className="py-2 px-4 text-left">Minutos acumulados</th>
                  <th className="py-2 px-4 text-left">Sesiones totales</th>
                </tr>
              </thead>
              <tbody>
                {filteredChargers.map(charger => (
                  <ChargerStatsRow key={charger.name} charger={charger} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
