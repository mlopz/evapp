// cron-rebuild.js
const pool = require('./db'); // Ajusta la ruta si tu pool está en otro archivo
const rebuildConnectorSessions = require('./lib/rebuildConnectorSessions');

(async () => {
  try {
    const result = await rebuildConnectorSessions(pool, { cleanDebugLogs: false });
    console.log(`[REBUILD] Ejecutado por cron. Sesiones insertadas: ${result.inserted}`);
    process.exit(0);
  } catch (err) {
    console.error('[REBUILD] Error en cron:', err);
    process.exit(1);
  }
})();
