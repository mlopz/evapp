import React, { useEffect, useState } from 'react';
import ChargersList from './ChargersList';
import SessionsList from './SessionsList';
import ChargerStatusCards from './ChargerStatusCards';
import ChargerConnectorsView from './ChargerConnectorsView';
import ClearDatabasePage from './ClearDatabasePage';
import './index.css';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import ConnectorStatusCards from './ConnectorStatusCards';
import ChargerCardModal from './ChargerCardModal';

const API_URL = process.env.REACT_APP_API_URL;

function ChargerCard({ charger, minutes, sessions, onClick }) {
  return (
    <button
      className="rounded-xl shadow-lg p-6 bg-white border-2 w-full flex flex-col items-center hover:scale-105 hover:border-orange-500 transition cursor-pointer mb-4"
      onClick={onClick}
    >
      <div className="text-lg font-bold text-gray-800 mb-2">{charger.name}</div>
      <div className="flex gap-6 mb-1">
        <div className="flex flex-col items-center">
          <span className="text-xl font-bold text-orange-600">{minutes}</span>
          <span className="text-xs text-gray-500">Minutos</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xl font-bold text-orange-600">{sessions}</span>
          <span className="text-xs text-gray-500">Sesiones</span>
        </div>
      </div>
    </button>
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
  const [modalCharger, setModalCharger] = useState(null);

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

  // Estado para stats por cargador
  const [chargerStats, setChargerStats] = useState({});
  useEffect(() => {
    if (!filteredChargers.length) return;
    filteredChargers.forEach(charger => {
      fetch(`${process.env.REACT_APP_API_URL}/api/sessions/stats?charger_name=${encodeURIComponent(charger.name)}`)
        .then(res => res.json())
        .then(data => {
          setChargerStats(prev => ({ ...prev, [charger.name]: data }));
        });
    });
  }, [filteredChargers]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <ConnectorStatusCards chargers={chargers} onSelectStatus={setSelectedStatus} selectedStatus={selectedStatus} />
      {selectedStatus && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {filteredChargers.map(charger => (
            <ChargerCard
              key={charger.name}
              charger={charger}
              minutes={chargerStats[charger.name]?.total_minutes || 0}
              sessions={chargerStats[charger.name]?.total_sessions || 0}
              onClick={() => setModalCharger(charger)}
            />
          ))}
        </div>
      )}
      <ChargerCardModal charger={modalCharger} onClose={() => setModalCharger(null)} />
    </div>
  );
}

export default App;
