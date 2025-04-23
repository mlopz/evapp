// monitoringRepository.js
const pool = require('./db');

/**
 * Inserta un registro de monitoreo en la base de datos
 * @param {Object} data
 * @param {string} data.charger_name - Nombre del cargador
 * @param {string} data.connector_type - Tipo de conector
 * @param {string} data.connector_id - Identificador único del conector
 * @param {number} data.power - Potencia del conector
 * @param {string} data.status - Estado del conector
 * @param {number} data.timestamp - Timestamp en milisegundos
 */
async function insertMonitoringRecord({ charger_name, connector_type, connector_id, power, status, timestamp }) {
  await pool.query(
    'INSERT INTO charger_monitoring (charger_name, connector_type, connector_id, power, status, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
    [charger_name, connector_type, connector_id, power, status, timestamp]
  );
}

module.exports = {
  insertMonitoringRecord
};

// Ejemplo de uso:
// (async () => {
//   await insertMonitoringRecord({
//     charger_name: 'Auxicar',
//     connector_type: 'CCS 2',
//     connector_id: 'Auxicar-CCS 2-0',
//     power: 60,
//     status: 'Charging',
//     timestamp: Date.now()
//   });
// })();
