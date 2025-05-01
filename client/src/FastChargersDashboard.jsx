import React, { useEffect, useState } from 'react';

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

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const url = process.env.REACT_APP_API_URL + '/api/fast-chargers/status';
        console.log('Consultando API:', url);
        const res = await fetch(url);
        const data = await res.json();
        console.log('Respuesta de la API:', data);
        setCargadores(data.chargers || []);
      } catch (err) {
        setError('Error al cargar el estado de los cargadores rápidos');
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

  return (
    <div className="max-w-3xl mx-auto py-8">
      <h2 className="text-3xl font-extrabold mb-8 text-center text-orange-700 drop-shadow">Cargadores rápidos - Estado actual</h2>
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
      {loading && <div className="text-center text-gray-500">Cargando...</div>}
      {error && <div className="text-center text-red-500">{error}</div>}
      {estadoSeleccionado && (
        <div className="mt-6">
          <h3 className="text-xl font-bold mb-4 text-orange-600 text-center">
            {ESTADOS.find(e => e.key === estadoSeleccionado)?.label} ({agrupados[estadoSeleccionado]?.length || 0})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {(agrupados[estadoSeleccionado] || []).map((c, idx) => {
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
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold text-orange-700 text-lg truncate max-w-[13ch]">{c.charger_name}</span>
                    <span className={`ml-auto px-2 py-0.5 rounded text-xs font-semibold ${c.estado === 'Disponible' ? 'bg-green-100 text-green-700' : c.estado === 'Charging' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-700'}`}>{c.estado}</span>
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
                        <div className="font-semibold text-orange-700 text-lg">ID: {conn.connector_id}</div>
                        <div className="text-xs text-gray-500">Tipo: {conn.connector_type}</div>
                        <div className="text-xs text-gray-500">Potencia: <span className="font-semibold text-gray-700">{conn.power ? `${conn.power} kW` : '-'}</span></div>
                        <div className="text-xs text-gray-500">Estado: <span className="font-semibold">{conn.estado}</span></div>
                        <div className="text-xs text-gray-500">Ubicación: {hasLocation ? `${latNum.toFixed(4)}, ${lonNum.toFixed(4)}` : '-'}</div>
                      </div>
                      {hasLocation && (
                        <a href={`https://maps.google.com/?q=${latNum},${lonNum}`} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded bg-orange-600 text-white text-xs font-semibold hover:bg-orange-800 transition">Ver en Maps</a>
                      )}
                    </button>
                    {/* Sesiones debajo de la tarjeta seleccionada */}
                    {isExpanded && (
                      <div className="mt-4 bg-white rounded-xl shadow-inner p-4">
                        <h5 className="font-bold text-orange-700 mb-2 text-center">Sesiones históricas</h5>
                        {loadingSesiones ? (
                          <div className="text-center text-gray-400">Cargando sesiones...</div>
                        ) : sesiones.length === 0 ? (
                          <div className="text-center text-gray-400">No hay sesiones para este conector.</div>
                        ) : (
                          <>
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-xs text-gray-700 border">
                                <thead>
                                  <tr className="bg-orange-100">
                                    <th className="py-2 px-3 font-semibold">Inicio de sesión</th>
                                    <th className="py-2 px-3 font-semibold">Fin de sesión</th>
                                    <th className="py-2 px-3 font-semibold">Duración</th>
                                    <th className="py-2 px-3 font-semibold">Estado</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sesiones.slice((paginaSesiones-1)*sesionesPorPagina, paginaSesiones*sesionesPorPagina).map((s, idx) => (
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
                              <span className="text-xs font-semibold">Página {paginaSesiones} de {Math.ceil(sesiones.length/sesionesPorPagina)}</span>
                              <button
                                className={`px-2 py-1 rounded ${paginaSesiones >= Math.ceil(sesiones.length/sesionesPorPagina) ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-orange-200 text-orange-900 hover:bg-orange-300'}`}
                                onClick={() => setPaginaSesiones(p => Math.min(Math.ceil(sesiones.length/sesionesPorPagina), p+1))}
                                disabled={paginaSesiones >= Math.ceil(sesiones.length/sesionesPorPagina)}
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
    </div>
  );
}
