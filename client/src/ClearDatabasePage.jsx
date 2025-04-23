import React, { useState } from 'react';

export default function ClearDatabasePage() {
  const [status, setStatus] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const handleClear = async () => {
    setStatus(null);
    try {
      const res = await fetch(process.env.REACT_APP_API_URL + '/api/clear-db', {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setStatus('¡Base de datos limpiada correctamente!');
      } else {
        setStatus('Error: ' + (data.message || 'No se pudo limpiar la base.'));
      }
    } catch (err) {
      setStatus('Error de red o servidor.');
    }
    setConfirming(false);
  };

  return (
    <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded shadow border text-center">
      <h2 className="text-xl font-bold mb-4">LIMPIAR BASE DE DATOS</h2>
      <p className="mb-4 text-red-700">Esta acción eliminará TODOS los registros de sesiones y monitoreo. ¡No se puede deshacer!</p>
      {status && <div className="mb-4 font-semibold text-blue-700">{status}</div>}
      {!confirming ? (
        <button
          className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 font-bold"
          onClick={() => setConfirming(true)}
        >
          Limpiar base de datos
        </button>
      ) : (
        <div>
          <p className="mb-2">¿Seguro? Esta acción es irreversible.</p>
          <button
            className="bg-red-700 text-white px-3 py-1 rounded mr-2"
            onClick={handleClear}
          >
            Sí, limpiar
          </button>
          <button
            className="bg-gray-300 px-3 py-1 rounded"
            onClick={() => setConfirming(false)}
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
