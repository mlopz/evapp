import React, { useEffect, useState } from 'react';


export default function Rentabilidad() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [chargers, setChargers] = useState([]);
const [sesiones, setSesiones] = useState([]);
const [escenario, setEscenario] = useState('auspicioso');
const [tarifas, setTarifas] = useState([]);
const [tarifa, setTarifa] = useState(null);
  const [selectedChargers, setSelectedChargers] = useState([]); // ids seleccionados
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Cargar la lista de cargadores al montar
  useEffect(() => {
    const apiUrl = process.env.REACT_APP_API_URL || '';
    fetch(`${apiUrl}/api/chargers`)
      .then(res => res.json())
      .then(data => setChargers(data.chargers || []));
    // Traer todas las sesiones reales para el prototipo
    fetch(`${apiUrl}/api/sessions`)
      .then(res => res.json())
      .then(data => {
        const sesionesArray = data.sessions || [];
        console.log('Primeras 3 sesiones recibidas:', sesionesArray.slice(0,3));
        setSesiones(sesionesArray);
      });
    // Cargar tarifas desde public/tarifas.json
    fetch('/tarifas.json')
      .then(res => res.json())
      .then(data => {
        setTarifas(data);
        if (data.length > 0) setTarifa(data[0]);
      });
  }, []);

  // Handler de consulta
  const handleConsultar = () => {
    setLoading(true);
    setError(null);
    setStats(null);
    console.log('Cargadores seleccionados:', selectedChargers);
    // Nuevo flujo: pedir sesiones filtradas al backend y calcular rentabilidad localmente
    const apiUrl = process.env.REACT_APP_API_URL || '';
    const chargerParams = selectedChargers.join(',');
    const url = `${apiUrl}/api/sessions/filtradas?chargers=${encodeURIComponent(chargerParams)}&from=${from}&to=${to}`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Error al obtener sesiones filtradas');
        return res.json();
      })
      .then(data => {
        console.log('Sesiones filtradas recibidas:', data.sessions);
        // Aquí va el cálculo local de rentabilidad
        const statsCalculadas = calcularRentabilidadLocal(data.sessions, escenario, tarifa);
        setStats(statsCalculadas);
      })
      .catch(err => {
        console.error('Error en consulta de sesiones filtradas:', err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  };

  // --- Función de cálculo local de rentabilidad ---
  function calcularRentabilidadLocal(sesiones, escenario, tarifa) {
    // Aquí debes implementar el algoritmo de rentabilidad usando las sesiones filtradas, el escenario y la tarifa seleccionada.
    // Por ahora, solo agrupa por cargador y suma minutos como ejemplo:
    const resultados = {};
    sesiones.forEach(s => {
      const key = s.charger_name;
      if (!resultados[key]) {
        resultados[key] = {
          nombre: key,
          empresa: s.empresa || '',
          potencia: s.power || 0,
          minutos: 0,
          kWh: 0,
          recaudacion_bruta: 0,
          gasto_electrico: 0,
          recaudacion_neta: 0
        };
      }
      // Ejemplo: sumar minutos y energía
      const minutos = s.duration_minutes || (s.session_end && s.session_start ? Math.round((new Date(s.session_end) - new Date(s.session_start)) / 60000) : 0);
      resultados[key].minutos += minutos;
      // Ejemplo: energía estimada
      if (s.power && minutos) {
        resultados[key].kWh += (s.power * minutos) / 60;
      }
      // Aquí puedes agregar el cálculo de recaudación y costos según la tarifa y escenario
    });
    // Devuelve array para la tabla
    return Object.values(resultados);
  }


  // Sumar minutos totales de la lista de sesiones por cargador
  const minutosPorCargador = {};
  if (stats && stats.sesiones) {
    stats.sesiones.forEach(s => {
      const key = s.charger_name;
      if (!minutosPorCargador[key]) minutosPorCargador[key] = 0;
      minutosPorCargador[key] += s.duration_minutes || 0;
    });
  }

  // Filtro de cargadores para el autocomplete
  const filteredChargers = chargers.filter(c =>
    (c && c.name && c.name.toLowerCase().includes(search.toLowerCase()))
  );

  // LOG para depuración: mostrar el contenido de stats antes de renderizar la tabla
  console.log('Contenido de stats para la tabla:', stats);
  if (Array.isArray(stats) && stats.length > 0) {
    console.log('Campos del primer objeto de stats:', Object.keys(stats[0]), stats[0]);
  }
  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Estadísticas de Rentabilidad</h2>
      {/* Selector de fechas arriba, en fila propia */}
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <div className="flex-1">
          <label className="block mb-1 font-semibold">Desde</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 w-full" />
        </div>
        <div className="flex-1">
          <label className="block mb-1 font-semibold">Hasta</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1 w-full" />
        </div>
      </div>
      {/* Selectores de escenario, tarifa y botón en otra fila */}
      <div className="flex gap-2 mb-2 items-center">
        {/* Selector de escenario */}
        <select
          value={escenario}
          onChange={e => setEscenario(e.target.value)}
          className="border rounded px-2 py-1"
        >
          <option value="auspicioso">Auspicioso</option>
          <option value="intermedio">Intermedio</option>
          <option value="conservador">Conservador</option>
        </select>
        {/* Selector de tarifa */}
        <select
          value={tarifa ? tarifa.id : ''}
          onChange={e => setTarifa(tarifas.find(t => t.id === e.target.value))}
          className="border rounded px-2 py-1"
        >
          {tarifas.map(t => (
            <option key={t.id} value={t.id}>{t.nombre} - {t.descripcion}</option>
          ))}
        </select>
        <button
          onClick={handleConsultar}
          className="bg-orange-600 text-white px-4 py-1 rounded hover:bg-orange-700"
          disabled={loading}
        >
          {loading ? 'Consultando...' : 'Consultar'}
        </button>
      </div>
      {/* Autocomplete limpio */}
      <div className="mb-4">
        <label className="block mb-1 font-semibold">Selecciona uno o más cargadores</label>
        <input
          type="text"
          placeholder="Buscar por nombre..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded px-2 py-1 mb-2 w-full"
        />
        <div className="max-h-40 overflow-y-auto border rounded bg-white">
          {filteredChargers.map((c) => {
            if (!c.name) return null;
            const nameStr = c.name;
            return (
              <label key={nameStr} className="block px-2 py-1 hover:bg-orange-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedChargers.includes(nameStr)}
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedChargers(prev => [...prev, nameStr]);
                    } else {
                      setSelectedChargers(prev => prev.filter(n => n !== nameStr));
                    }
                  }}
                  className="mr-2"
                />
                <span>{c.name}</span>
              </label>
            );
          })}
        </div>
        {selectedChargers.length === 0 && <div className="text-red-500 text-xs mt-1">Debes seleccionar al menos un cargador</div>}
      </div>
      <button
        className="bg-orange-600 hover:bg-orange-700 text-white font-bold px-4 py-2 rounded mb-4"
        onClick={handleConsultar}
        disabled={loading || !from || !to || selectedChargers.length === 0}
      >
        {loading ? 'Consultando...' : 'Consultar'}
      </button>
      {error && <div className="text-red-600 mb-4">{error}</div>}
      {stats && Array.isArray(stats) && stats.length > 0 && (
        <div className="overflow-x-auto mt-4">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="bg-orange-200">
                <th className="border px-2 py-1">Cargador</th>
                <th className="border px-2 py-1">Empresa</th>
                <th className="border px-2 py-1">Potencia (kW)</th>
                <th className="border px-2 py-1">Minutos</th>
                <th className="border px-2 py-1">Energía (kWh)</th>
                <th className="border px-2 py-1">Recaudación Bruta</th>
                <th className="border px-2 py-1">Gasto Eléctrico</th>
                <th className="border px-2 py-1">Rentabilidad Neta</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((row, i) => (
                <tr key={i} className="even:bg-orange-50">
                  <td className="border px-2 py-1">{row.nombre || '-'}</td>
                  <td className="border px-2 py-1">{row.empresa || '-'}</td>
                  <td className="border px-2 py-1">{row.potencia != null ? row.potencia : '-'}</td>
                  <td className="border px-2 py-1">{row.minutos != null ? row.minutos : '-'}</td>
                  <td className="border px-2 py-1">{row.kWh != null ? row.kWh.toFixed(2) : '-'}</td>
                  <td className="border px-2 py-1">{row.recaudacion_bruta != null ? `$${row.recaudacion_bruta.toFixed(2)}` : '-'}</td>
                  <td className="border px-2 py-1">{row.gasto_electrico != null ? `$${row.gasto_electrico.toFixed(2)}` : '-'}</td>
                  <td className="border px-2 py-1">{row.recaudacion_neta != null ? `$${row.recaudacion_neta.toFixed(2)}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}