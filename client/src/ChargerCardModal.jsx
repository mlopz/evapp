import React from "react";
import ConnectorStatsCard from "./ConnectorStatsCard";

export default function ChargerCardModal({ charger, onClose }) {
  if (!charger) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-lg w-full relative animate-fade-in">
        <button
          className="absolute top-2 right-2 text-gray-500 hover:text-orange-600 text-2xl"
          onClick={onClose}
          aria-label="Cerrar"
        >
          ×
        </button>
        <h2 className="text-2xl font-bold text-orange-700 mb-4 text-center">{charger.name}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(charger.connectors || []).map(conn => (
            <ConnectorStatsCard key={conn.connectorId} connector={conn} />
          ))}
        </div>
      </div>
    </div>
  );
}
