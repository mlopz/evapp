import React, { useEffect, useState } from 'react';
import { MapaZonasInfluencia, MapaVolumenUso } from './MapasCargadores';

const ESTADOS = [
  { key: 'Disponible', label: 'Disponible', color: 'from-orange-400 to-orange-500', icon: (
    <svg className="w-12 h-12 mx-auto mb-2 text-white drop-shadow-lg" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="#34d399" /><path stroke="#fff" strokeWidth="2" d="M9.5 12.5l2 2 3-3"/></svg>
  ) },
  { key: 'Charging', label: 'Cargando', color: 'from-orange-500 to-orange-600', icon: (
    <svg className="w-12 h-12 mx-auto mb-2 text-white drop-shadow-lg" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#fbbf24" stroke="#fff" strokeWidth="2"/></svg>
  ) },
  { key: 'Fuera', label: 'Fuera de servicio', color: 'from-orange-700 to-orange-900', icon: (
    <svg className="w-12 h-12 mx-auto mb-2 text-white drop-shadow-lg" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="#f87171" strokeWidth="2.5" fill="#f87171" /><path stroke="#fff" strokeWidth="2" d="M9 9l6 6m0-6l-6 6"/></svg>
  ) },
];

// Función para mapear los estados del backend a categorías visuales
function mapEstado(estado) {
  if (!estado) return 'Fuera';
  if (estado === 'Charging') return 'Charging';
  if ([ 'Disponible', 'Available', 'Ready' ].includes(estado)) return 'Disponible';
  // Otros posibles estados de fuera de servicio
  if ([ 'Fuera de servicio', 'Error', 'Offline', 'Desconocido', 'Out of Service' ].includes(estado)) return 'Fuera';
  return 'Fuera';
}

// Procesamiento avanzado de estadísticas
function calcularEstadisticasPorCargador(sesiones, cargadores) {
  // Agrupar sesiones por cargador
  const agrupado = {};
  sesiones.forEach(s => {
    if (!agrupado[s.charger_name]) agrupado[s.charger_name] = [];
    agrupado[s.charger_name].push(s);
  });
  return Object.entries(agrupado).map(([charger, sesionesCargador]) => {
    // Sumar minutos por conector y quedarse con los 2 top
    const minutosPorConector = {};
    sesionesCargador.forEach(s => {
      if (!minutosPorConector[s.connector_id]) minutosPorConector[s.connector_id] = 0;
      minutosPorConector[s.connector_id] += s.duration_minutes || 0;
    });
    const top2 = Object.values(minutosPorConector).sort((a,b)=>b-a).slice(0,2);
    const minutosTotales = top2.reduce((a,b)=>a+b,0);
    // Días únicos con sesiones
    const diasUnicos = Array.from(new Set(sesionesCargador.map(s => s.session_start.slice(0,10))));
    const promedioDiario = diasUnicos.length > 0 ? Math.round(minutosTotales / diasUnicos.length) : 0;
    // Agrupar por hora de inicio
    const minutosPorHora = {};
    sesionesCargador.forEach(s => {
      const hora = new Date(s.session_start).getHours();
      if (!minutosPorHora[hora]) minutosPorHora[hora] = 0;
      minutosPorHora[hora] += s.duration_minutes || 0;
    });
    // Top 3 horas con más minutos
    const top3Horas = Object.entries(minutosPorHora)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,3)
      .map(([h]) => (h.padStart ? h.padStart(2,'0') : ('0'+h).slice(-2))+':00');
    // Top 3 horas con menos minutos (solo horas con sesiones)
    const top3HorasMenos = Object.entries(minutosPorHora)
      .sort((a,b)=>a[1]-b[1])
      .slice(0,3)
      .map(([h]) => (h.padStart ? h.padStart(2,'0') : ('0'+h).slice(-2))+':00');
    return {
      charger,
      minutos: minutosTotales,
      promedioDiario,
      top3Horas: top3Horas.join(', '),
      top3HorasMenos: top3HorasMenos.join(', ')
    };
  });
}

// Utilidad para renderizar horas como badges apilados y pequeños
function renderHorasBadges(horasStr, color) {
  if (!horasStr) return '-';
  return (
    <div className="flex flex-col items-end gap-0.5">
      {horasStr.split(',').map((h, i) => (
        <span key={h+i} className={`inline-block px-1.5 py-0.5 rounded bg-${color}-100 text-${color}-700 text-[10px] font-mono`} title={`Hora: ${h}`}>{h}</span>
      ))}
    </div>
  );
}

// Utilidad para calcular el máximo de minutos del TOP 10 cargadores
function getMaxTop10(volumenes) {
  // Ordenar los valores de minutos de mayor a menor
  const top10 = Object.values(volumenes).sort((a,b)=>b-a).slice(0,10);
  return top10.length > 0 ? top10[0] : 1;
}

export default function FastChargersDashboard() {
  const [cargadores, setCargadores] = useState([]);
  const [estadoSeleccionado, setEstadoSeleccionado] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cargadorExpandido, setCargadorExpandido] = useState(null);
  const [connectorExpandido, setConnectorExpandido] = useState(null);
  const [sesiones, setSesiones] = useState([]);
  const [loadingSesiones, setLoadingSesiones] = useState(false);
  const [paginaSesiones, setPaginaSesiones] = useState(1);
  const sesionesPorPagina = 5;
  const [buscador, setBuscador] = useState('');

  // Estado para la pestaña activa
  const [tab, setTab] = useState('cargadores'); // 'cargadores' | 'estadisticas' | 'rentabilidad'
  // Estado para el rango de fechas
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  // --- Incidentes backend (footer discreto) ---
  const [incidentesBackend, setIncidentesBackend] = useState([]);
  useEffect(() => {
    fetch('/api/backend-failures')
      .then(r => r.json())
      .then(data => {
        if (data.ok) setIncidentesBackend(data.incidents);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // Fetch de cargadores
        const url = process.env.REACT_APP_API_URL + '/api/fast-chargers/status';
        console.log('Consultando API:', url);
        const res = await fetch(url);
        const data = await res.json();
        console.log('Respuesta de la API:', data);
        setCargadores(data.chargers || []);

        // Fetch de sesiones (para estadísticas)
        const sesionesUrl = process.env.REACT_APP_API_URL + '/api/sessions';
        console.log('Consultando sesiones:', sesionesUrl);
        const resSesiones = await fetch(sesionesUrl);
        const dataSesiones = await resSesiones.json();
        console.log('Sesiones recibidas:', dataSesiones);
        setSesiones(dataSesiones.sessions || []);
      } catch (err) {
        setError('Error al cargar el estado de los cargadores o sesiones');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Agrupa cargadores por estado visual
  const agrupados = cargadores.reduce((acc, cargador) => {
    const grupo = mapEstado(cargador.estado);
    if (!acc[grupo]) acc[grupo] = [];
    acc[grupo].push(cargador);
    return acc;
  }, {});

  // Debug: log para depuración de filtro
  console.log('DEBUG sesiones:', {
    cargadorExpandido,
    connectorExpandido,
    sesiones: sesiones.map(s => ({
      charger_name: s.charger_name,
      connector_id: s.connector_id
    }))
  });

  // Filtro robusto: comparar como string y trim, usando directamente connectorExpandido como string
  const sesionesFiltradas = sesiones.filter(s =>
    cargadorExpandido && connectorExpandido &&
    String(s.charger_name).trim() === String(cargadorExpandido).trim() &&
    String(s.connector_id).trim() === String(connectorExpandido).trim()
  );

  // Log para revisar si hay sesiones filtradas y sus datos
  console.log('Sesiones filtradas:', sesionesFiltradas.length, sesionesFiltradas.slice(0, 5));

  // Debug: log fechas de sesiones y rango seleccionado
  console.log('DEBUG Estadísticas:', {
    fechaDesde,
    fechaHasta,
    sesiones: sesiones.map(s => ({
      session_start: s.session_start && s.session_start.slice(0,10)
    }))
  });
  // Filtrado de sesiones por rango de fechas (solo fecha, sin horas)
  const sesionesFiltradasEstad = sesiones.filter(s => {
    if (!s.session_start) return false;
    const fechaStr = s.session_start.slice(0,10); // YYYY-MM-DD
    // Log para ver qué fechas compara
    if (fechaDesde || fechaHasta) {
      console.log('Comparando', { fechaStr, fechaDesde, fechaHasta });
    }
    if (fechaDesde && fechaStr < fechaDesde) return false;
    if (fechaHasta && fechaStr > fechaHasta) return false;
    return true;
  });
  // Si no hay fechas seleccionadas, mostrar todas las sesiones
  const sesionesParaEstad = (fechaDesde || fechaHasta) ? sesionesFiltradasEstad : sesiones;

  // --- NUEVO: minutos totales por cargador usando la lógica de la tabla ---
  // Usar la función calcularEstadisticasPorCargador para obtener minutos totales por cargador
  const resumenCargadoresMapa = calcularEstadisticasPorCargador(sesionesParaEstad, cargadores);
  // Construir un objeto volumenesPorCargador: { [charger_name]: minutos }
  const volumenesPorCargador = {};
  resumenCargadoresMapa.forEach(({ charger, minutos }) => {
    volumenesPorCargador[charger] = minutos;
  });
  // Calcular máximo del TOP 10
  const maxTop10 = getMaxTop10(volumenesPorCargador);

  // Agrupación y cálculo de minutos por cargador (suma de los 2 conectores top)
  const minutosPorCargador = {};
  sesionesParaEstad.forEach(s => {
    if (!minutosPorCargador[s.charger_name]) minutosPorCargador[s.charger_name] = {};
    if (!minutosPorCargador[s.charger_name][s.connector_id]) minutosPorCargador[s.charger_name][s.connector_id] = 0;
    minutosPorCargador[s.charger_name][s.connector_id] += s.duration_minutes || 0;
  });
  const resumenCargadores = calcularEstadisticasPorCargador(sesionesParaEstad, cargadores);
  const top10Mas = [...resumenCargadores].sort((a,b)=>b.minutos-a.minutos).slice(0,10);
  const top10Menos = [...resumenCargadores].filter(r=>r.minutos>0).sort((a,b)=>a.minutos-b.minutos).slice(0,10);

  // Calcular volumenes por cargador (por conector) para el mapa
  const volumenes = getVolumenesPorCargador(sesionesParaEstad);
  // Calcular máximo del TOP 10
  const maxTop10Original = getMaxTop10(volumenes);

  // Filtrar cargadores por nombre
  const cargadoresFiltrados = cargadores.filter(c =>
    c.charger_name && c.charger_name.toLowerCase().includes(buscador.toLowerCase())
  );

  return (
    <div className="max-w-3xl mx-auto py-8">
      <h2 className="text-3xl font-extrabold mb-8 text-center text-orange-700 drop-shadow">Cargadores rápidos - Estado actual</h2>
      {/* Buscador en la parte superior */}
      <div className="mb-6 flex justify-center">
        <input
          type="text"
          className="w-full max-w-md px-4 py-2 border border-orange-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-600 text-lg shadow"
          placeholder="Buscar cargador por nombre..."
          value={buscador}
          onChange={e => setBuscador(e.target.value)}
        />
      </div>
      {/* Tabs de navegación */}
      <div className="flex gap-4 mb-8 justify-center">
        <button onClick={()=>setTab('cargadores')} className={`px-4 py-2 rounded-t-lg font-semibold ${tab==='cargadores'?'bg-orange-200 text-orange-900':'bg-gray-100 text-gray-500'}`}>Cargadores</button>
        <button onClick={()=>setTab('estadisticas')} className={`px-4 py-2 rounded-t-lg font-semibold ${tab==='estadisticas'?'bg-orange-200 text-orange-900':'bg-gray-100 text-gray-500'}`}>Estadísticas</button>
        <button onClick={()=>setTab('rentabilidad')} className={`px-4 py-2 rounded-t-lg font-semibold ${tab==='rentabilidad'?'bg-orange-200 text-orange-900':'bg-gray-100 text-gray-500'}`}>Rentabilidad</button>
      </div>

      {/* Sección Estadísticas */}
      {tab==='estadisticas' && (
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-2xl font-bold text-orange-700 mb-4">Estadísticas de uso</h3>
          <div className="flex gap-4 mb-6 flex-wrap items-end">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Desde:</label>
              <input type="date" value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)} className="border px-2 py-1 rounded focus:ring focus:ring-orange-300" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Hasta:</label>
              <input type="date" value={fechaHasta} onChange={e=>setFechaHasta(e.target.value)} className="border px-2 py-1 rounded focus:ring focus:ring-orange-300" />
            </div>
          </div>
          {sesionesParaEstad.length === 0 && (
            <div className="text-center text-red-500 font-semibold mb-4">No hay sesiones en el rango de fechas seleccionado.</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h4 className="font-bold text-orange-700 mb-2">Top 10 cargadores con más minutos</h4>
              <div className="w-full max-w-full">
                <table className="w-full text-[11px] md:text-xs text-gray-700 border border-orange-200 rounded-lg">
                  <thead className="bg-gradient-to-r from-orange-100 to-orange-200">
                    <tr>
                      <th className="py-1 px-1 text-left font-semibold whitespace-nowrap max-w-[90px]">Cargador</th>
                      <th className="py-1 px-1 text-right font-semibold whitespace-nowrap max-w-[45px]">Min</th>
                      <th className="py-1 px-1 text-right font-semibold whitespace-nowrap max-w-[55px]">Prom. 24h</th>
                      <th className="py-1 px-1 text-right font-semibold whitespace-nowrap max-w-[80px]">Top 3 horas</th>
                      <th className="py-1 px-1 text-right font-semibold whitespace-nowrap max-w-[80px]">Top 3 menos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top10Mas.map((r,i)=>(
                      <tr key={r.charger} className="border-b last:border-b-0 hover:bg-orange-50 transition">
                        <td className="py-1 px-1 max-w-[90px] truncate" title={r.charger}>{i+1}. {r.charger}</td>
                        <td className="py-1 px-1 text-right font-semibold font-mono text-orange-800">{r.minutos}</td>
                        <td className="py-1 px-1 text-right font-mono">{r.promedioDiario}</td>
                        <td className="py-1 px-1 text-right">{renderHorasBadges(r.top3Horas, 'orange')}</td>
                        <td className="py-1 px-1 text-right">{renderHorasBadges(r.top3HorasMenos, 'gray')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="font-bold text-orange-700 mb-2">Top 10 cargadores con menos minutos</h4>
              <div className="w-full max-w-full">
                <table className="w-full text-[11px] md:text-xs text-gray-700 border border-orange-200 rounded-lg">
                  <thead className="bg-gradient-to-r from-orange-100 to-orange-200">
                    <tr>
                      <th className="py-1 px-1 text-left font-semibold whitespace-nowrap max-w-[90px]">Cargador</th>
                      <th className="py-1 px-1 text-right font-semibold whitespace-nowrap max-w-[45px]">Min</th>
                      <th className="py-1 px-1 text-right font-semibold whitespace-nowrap max-w-[55px]">Prom. 24h</th>
                      <th className="py-1 px-1 text-right font-semibold whitespace-nowrap max-w-[80px]">Top 3 horas</th>
                      <th className="py-1 px-1 text-right font-semibold whitespace-nowrap max-w-[80px]">Top 3 menos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top10Menos.map((r,i)=>(
                      <tr key={r.charger} className="border-b last:border-b-0 hover:bg-orange-50 transition">
                        <td className="py-1 px-1 max-w-[90px] truncate" title={r.charger}>{i+1}. {r.charger}</td>
                        <td className="py-1 px-1 text-right font-semibold font-mono text-orange-800">{r.minutos}</td>
                        <td className="py-1 px-1 text-right font-mono">{r.promedioDiario}</td>
                        <td className="py-1 px-1 text-right">{renderHorasBadges(r.top3Horas, 'orange')}</td>
                        <td className="py-1 px-1 text-right">{renderHorasBadges(r.top3HorasMenos, 'gray')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="mt-8">
            <h3 className="text-lg font-bold text-orange-700 mb-2">Visualización geográfica de cargadores</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow p-2 border border-orange-100">
                <h4 className="font-semibold text-orange-600 text-sm mb-1 text-center">Zonas de influencia (100 km)</h4>
                <MapaZonasInfluencia cargadores={cargadores} />
              </div>
              <div className="bg-white rounded-xl shadow p-2 border border-orange-100">
                <h4 className="font-semibold text-orange-600 text-sm mb-1 text-center">Volumen de uso (por rango de fechas)</h4>
                <MapaVolumenUso cargadores={cargadores} volumenes={volumenesPorCargador} maxTop10={maxTop10} />
                <div className="flex justify-center gap-2 mt-2 text-xs">
                  <span className="inline-block w-3 h-3 rounded-full bg-green-500"></span> Bajo
                  <span className="inline-block w-3 h-3 rounded-full bg-orange-400"></span> Medio
                  <span className="inline-block w-3 h-3 rounded-full bg-red-600"></span> Alto
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sección Cargadores (vista actual) */}
      {tab==='cargadores' && (
        <div className="flex flex-col md:flex-row gap-6 justify-center mb-10">
          {ESTADOS.map(({ key, label, color, icon }) => (
            <button
              key={key}
              className={`flex-1 rounded-3xl bg-gradient-to-br ${color} shadow-2xl p-8 text-white text-center font-semibold text-xl transition transform hover:scale-105 hover:shadow-orange-400/50 focus:outline-none border-4 ${estadoSeleccionado === key ? 'border-orange-300' : 'border-transparent'}`}
              style={{ minWidth: 220, minHeight: 200 }}
              onClick={() => setEstadoSeleccionado(key)}
            >
              <div>{icon}</div>
              <div className="text-5xl font-extrabold mb-1 drop-shadow-lg">{agrupados[key]?.length || 0}</div>
              <div className="tracking-wide uppercase opacity-90">{label}</div>
            </button>
          ))}
        </div>
      )}
      {loading && <div className="text-center text-gray-500">Cargando...</div>}
      {error && <div className="text-center text-red-500">{error}</div>}
      {estadoSeleccionado && (
        <div className="mt-6">
          <h3 className="text-xl font-bold mb-4 text-orange-600 text-center">
            {ESTADOS.find(e => e.key === estadoSeleccionado)?.label} ({agrupados[estadoSeleccionado]?.length || 0})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {(agrupados[estadoSeleccionado] || []).filter(c => c.charger_name && c.charger_name.toLowerCase().includes(buscador.toLowerCase())).map((c, idx) => {
              // Extraer nombre base del cargador (antes del último guion y tipo)
              const nombreBase = c.charger_name.replace(/-([^-]+-\d+)$/, '');
              const latNum = typeof c.lat === 'number' ? c.lat : Number(c.lat);
              const lonNum = typeof c.lon === 'number' ? c.lon : Number(c.lon);
              const hasLocation = !isNaN(latNum) && !isNaN(lonNum);
              return (
                <button
                  key={c.connector_id + idx}
                  className="bg-white rounded-2xl shadow-lg border border-orange-100 hover:shadow-orange-300/80 hover:border-orange-400 transition p-5 flex flex-col items-start text-left focus:outline-none group"
                  onClick={() => setCargadorExpandido(nombreBase)}
                  title={"Ver conectores asociados"}
                >
                  <div className="flex items-start justify-between mb-2 w-full">
                    <div className="font-bold text-lg text-orange-800 text-left w-full break-words whitespace-normal">
                      {c.charger_name}
                    </div>
                    {c.estado === 'Charging' && (
                      <span className="ml-2 px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 flex items-center text-lg shadow-sm" title="Cargando">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mb-1">ID: {c.connector_id}</div>
                  <div className="text-xs text-gray-500 mb-1">Tipo: {c.connector_type}</div>
                  <div className="text-xs text-gray-500 mb-1">Potencia: <span className="font-semibold text-gray-700">{c.power ? `${c.power} kW` : '-'}</span></div>
                  <div className="text-xs text-gray-500 mb-1">
                    Ubicación:
                    {hasLocation ? (
                      <span className="ml-1 text-orange-600 underline group-hover:text-orange-800">
                        {latNum.toFixed(4)}, {lonNum.toFixed(4)}
                      </span>
                    ) : ' -'}
                  </div>
                  <div className="text-xs text-orange-700 font-semibold mt-1">Minutos totales de sesiones: 
                    {sesiones
                      .filter(s => String(s.charger_name).trim() === String(c.charger_name).trim() && String(s.connector_id).trim() === String(c.connector_id).trim())
                      .reduce((acc, s) => acc + (s.duration_minutes || 0), 0)
                    }
                  </div>
                </button>
              );
            })}
            {(!agrupados[estadoSeleccionado] || agrupados[estadoSeleccionado].length === 0) && (
              <div className="col-span-full text-center py-4 text-gray-400">No hay cargadores en este estado.</div>
            )}
          </div>
        </div>
      )}
      {/* Sección expandida de conectores asociados */}
      {cargadorExpandido && (
        <div className="fixed inset-0 z-30 bg-black bg-opacity-40 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 relative">
            <button onClick={() => setCargadorExpandido(null)} className="absolute right-6 top-6 text-orange-700 text-2xl font-bold hover:text-orange-900">&times;</button>
            <h4 className="text-2xl font-bold mb-4 text-orange-700 text-center">Conectores de {cargadorExpandido}</h4>
            <div className="space-y-4">
              {cargadores.filter(conn => conn.charger_name.replace(/-([^-]+-\d+)$/, '') === cargadorExpandido).map(conn => {
                const latNum = typeof conn.lat === 'number' ? conn.lat : Number(conn.lat);
                const lonNum = typeof conn.lon === 'number' ? conn.lon : Number(conn.lon);
                const hasLocation = !isNaN(latNum) && !isNaN(lonNum);
                const isExpanded = connectorExpandido === conn.connector_id;
                const totalMinutos = sesiones
                  .filter(s => String(s.charger_name).trim() === String(conn.charger_name).trim() && String(s.connector_id).trim() === String(conn.connector_id).trim())
                  .reduce((acc, s) => acc + (s.duration_minutes || 0), 0);
                return (
                  <div key={conn.connector_id} className="border rounded-xl p-4 bg-orange-50/50 mb-2">
                    <button
                      className={`w-full flex flex-col md:flex-row md:items-center gap-3 text-left focus:outline-none ${isExpanded ? 'ring-2 ring-orange-400' : ''}`}
                      onClick={async () => {
                        if (isExpanded) {
                          setConnectorExpandido(null);
                          setSesiones([]);
                          setPaginaSesiones(1);
                        } else {
                          setConnectorExpandido(conn.connector_id);
                          setPaginaSesiones(1);
                          setLoadingSesiones(true);
                          try {
                            const res = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/sessions?connectorId=${encodeURIComponent(conn.connector_id)}`);
                            const data = await res.json();
                            console.log('RESPUESTA CRUDA BACKEND /api/sessions:', data);
                            setSesiones(data.sessions || []);
                          } catch (e) {
                            setSesiones([]);
                          }
                          setLoadingSesiones(false);
                        }
                      }}
                      title={isExpanded ? 'Cerrar sesiones' : 'Ver sesiones de este conector'}
                    >
                      <div className="flex-1">
                        <div className="font-bold text-orange-700 text-lg">ID: {conn.connector_id}</div>
                        <div className="text-xs text-gray-500">Tipo: {conn.connector_type}</div>
                        <div className="text-xs text-gray-500">Potencia: <span className="font-semibold text-gray-700">{conn.power ? `${conn.power} kW` : '-'}</span></div>
                        <div className="text-xs text-gray-500">Estado: <span className="font-semibold">{conn.estado}</span></div>
                        <div className="text-xs text-gray-500">Ubicación: {hasLocation ? `${latNum.toFixed(4)}, ${lonNum.toFixed(4)}` : '-'}</div>
                        <div className="text-xs text-orange-700 font-semibold mt-1">Minutos totales de sesiones: {totalMinutos}</div>
                      </div>
                      {hasLocation && (
                        <a href={`https://maps.google.com/?q=${latNum},${lonNum}`} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded bg-orange-600 text-white text-xs font-semibold hover:bg-orange-800 transition">Ver en Maps</a>
                      )}
                    </button>
                    {/* Sesiones debajo de la tarjeta seleccionada */}
                    {isExpanded && (
                      <div className="mt-4 bg-white rounded-2xl shadow-inner p-4">
                        <h5 className="font-bold text-orange-700 mb-2 text-center">Sesiones históricas</h5>
                        {loadingSesiones ? (
                          <div className="text-center text-gray-400">Cargando sesiones...</div>
                        ) : sesionesFiltradas.length === 0 ? (
                          (!loadingSesiones && sesiones.length > 0) && (
                            <div className="text-center text-red-400 text-xs">No hay coincidencias. Revisa el filtro o los datos de sesión.</div>
                          )
                        ) : (
                          <>
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-xs text-gray-700 border">
                                <thead>
                                  <tr>
                                    <th className="py-2 px-3 font-semibold">Inicio de sesión</th>
                                    <th className="py-2 px-3 font-semibold">Fin de sesión</th>
                                    <th className="py-2 px-3 font-semibold">Duración</th>
                                    <th className="py-2 px-3 font-semibold">Estado</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sesionesFiltradas.slice((paginaSesiones-1)*sesionesPorPagina, paginaSesiones*sesionesPorPagina).map((s, idx) => (
                                    <tr key={s.id || idx} className="border-b last:border-b-0">
                                      <td className="py-2 px-3">{s.session_start ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s.session_start)) : '-'}</td>
                                      <td className="py-2 px-3">{s.session_end ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s.session_end)) : '-'}</td>
                                      <td className="py-2 px-3">{s.duration_minutes != null ? `${s.duration_minutes} min` : '-'}</td>
                                      <td className="py-2 px-3">{s.quality || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {/* Controles de paginación */}
                            <div className="flex justify-center items-center gap-2 mt-2">
                              <button
                                className={`px-2 py-1 rounded ${paginaSesiones === 1 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-orange-200 text-orange-900 hover:bg-orange-300'}`}
                                onClick={() => setPaginaSesiones(p => Math.max(1, p-1))}
                                disabled={paginaSesiones === 1}
                              >Anterior</button>
                              <span className="text-xs font-semibold">Página {paginaSesiones} de {Math.ceil(sesionesFiltradas.length/sesionesPorPagina)}</span>
                              <button
                                className={`px-2 py-1 rounded ${paginaSesiones >= Math.ceil(sesionesFiltradas.length/sesionesPorPagina) ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-orange-200 text-orange-900 hover:bg-orange-300'}`}
                                onClick={() => setPaginaSesiones(p => Math.min(Math.ceil(sesionesFiltradas.length/sesionesPorPagina), p+1))}
                                disabled={paginaSesiones >= Math.ceil(sesionesFiltradas.length/sesionesPorPagina)}
                              >Siguiente</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Sección Rentabilidad (pendiente de especificación) */}
      {tab==='rentabilidad' && (
        <div className="bg-white rounded-xl shadow p-6 text-center text-orange-700 font-bold text-2xl">Próximamente: Rentabilidad</div>
      )}
      {/* Footer discreto con incidentes backend */}
      <footer className="w-full text-xs text-gray-400 mt-8 flex justify-end">
        <details>
          <summary className="cursor-pointer select-none">Incidentes backend recientes</summary>
          <div className="mt-1 max-w-xs">
            {incidentesBackend.length === 0 && <span>No hay incidentes recientes.</span>}
            <ul className="list-disc ml-5">
              {incidentesBackend.map(inc => (
                <li key={inc.id} className="mb-1">
                  <span className="font-semibold text-orange-600">[{new Date(inc.timestamp).toLocaleString()}]</span> <span className="font-bold">{inc.type}</span> <span className="text-gray-500">{inc.details}</span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </footer>
    </div>
  );
}

// Utilidad para calcular volumen de uso por cargador en el rango filtrado
function getVolumenesPorCargador(sesiones) {
  const vol = {};
  sesiones.forEach(s => {
    if (!vol[s.connector_id]) vol[s.connector_id] = 0;
    vol[s.connector_id] += s.duration_minutes || 0;
  });
  return vol;
}
