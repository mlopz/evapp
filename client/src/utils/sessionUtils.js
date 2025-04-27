// Calcula los minutos acumulados de un conector específico
export function getConnectorAccumulatedMinutes(sessions, chargerName, connectorId) {
  // Filtrar sesiones de ese conector
  const connectorSessions = sessions.filter(
    s => s.charger_name === chargerName && s.connector_id === connectorId
  );
  let acumulado = connectorSessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  // Sumar minutos en tiempo real si hay sesión activa y duration_minutes es 0
  const activeSession = connectorSessions.find(s => s.active && s.session_start && (!s.duration_minutes || s.duration_minutes === 0));
  if (activeSession && activeSession.session_start) {
    const extra = Math.floor((Date.now() - new Date(activeSession.session_start)) / 60000);
    acumulado += extra;
  }
  return acumulado;
}

// Calcula los minutos acumulados de un cargador sumando todos sus conectores
export function getChargerAccumulatedMinutes(sessions, chargerName, connectorIds) {
  return connectorIds.reduce((sum, connectorId) => {
    return sum + getConnectorAccumulatedMinutes(sessions, chargerName, connectorId);
  }, 0);
}
