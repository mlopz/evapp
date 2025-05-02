import { MapContainer, TileLayer, Circle, CircleMarker, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import React from 'react';

// Icono custom para los cargadores (mejor visibilidad)
const chargerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  shadowSize: [41, 41]
});

// Utilidad para calcular color según volumen usando el máximo del TOP 10
function getColor(vol, maxTop10) {
  if (maxTop10 === 0) return '#ccc';
  const ratio = vol / maxTop10;
  if (ratio > 0.66) return '#e53e3e'; // rojo
  if (ratio > 0.33) return '#f6ad55'; // naranja
  return '#38a169'; // verde
}

// Utilidad para extraer lat/lng desde cualquier formato (lat/lon o latitude/longitude), con logs de depuración
function toLatLng(c, i) {
  // Prioridad: lat/lon > latitude/longitude > location.lat/lon
  const lat =
    typeof c.lat === 'number' ? c.lat :
    typeof c.latitude === 'number' ? c.latitude :
    c.lat !== undefined ? parseFloat(c.lat) :
    c.latitude !== undefined ? parseFloat(c.latitude) :
    c.location && (typeof c.location.lat === 'number' ? c.location.lat : parseFloat(c.location.lat));

  const lng =
    typeof c.lng === 'number' ? c.lng :
    typeof c.lon === 'number' ? c.lon :
    typeof c.longitude === 'number' ? c.longitude :
    c.lng !== undefined ? parseFloat(c.lng) :
    c.lon !== undefined ? parseFloat(c.lon) :
    c.longitude !== undefined ? parseFloat(c.longitude) :
    c.location && (typeof c.location.lng === 'number' ? c.location.lng :
                   typeof c.location.lon === 'number' ? c.location.lon :
                   parseFloat(c.location.lng || c.location.lon));

  if (i < 3) {
    // Loggear los primeros 3 cargadores para inspección
    console.log(`Cargador[${i}]`, {
      latField: c.lat, lonField: c.lon, latitude: c.latitude, longitude: c.longitude,
      parsedLat: lat, parsedLng: lng,
      typeofLat: typeof lat, typeofLng: typeof lng
    });
  }
  return {
    lat,
    lng,
    ...c
  };
}

export function MapaZonasInfluencia({ cargadores }) {
  // Mapear a lat/lng
  const cargadoresLatLng = cargadores.map(toLatLng);
  // Filtrar cargadores válidos
  const cargadoresValidos = cargadoresLatLng.filter(c =>
    typeof c.lat === 'number' && typeof c.lng === 'number' && !isNaN(c.lat) && !isNaN(c.lng)
  );
  if (cargadores.length !== cargadoresValidos.length) {
    console.warn('Cargadores ignorados por falta de lat/lng:', cargadores.filter((_,i) => !cargadoresValidos.includes(cargadoresLatLng[i])));
  }
  const center = cargadoresValidos.length
    ? [
        cargadoresValidos.reduce((a, c) => a + c.lat, 0) / cargadoresValidos.length,
        cargadoresValidos.reduce((a, c) => a + c.lng, 0) / cargadoresValidos.length
      ]
    : [-34.6, -58.4];

  // Gradiente radial más transparente
  const gradiente = [
    { r: 15000, color: '#f6ad55', opacity: 0.18 }, // centro, más intenso
    { r: 30000, color: '#f6ad55', opacity: 0.10 },
    { r: 50000, color: '#f6ad55', opacity: 0.06 },
    { r: 70000, color: '#f6ad55', opacity: 0.03 } // exterior, más suave
  ];

  return (
    <MapContainer center={center} zoom={7} style={{ height: 320, width: '100%' }} scrollWheelZoom={false}>
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
      />
      {cargadoresValidos.map((c, i) => (
        <React.Fragment key={c.id || i}>
          {gradiente.map((g, j) => (
            <Circle
              key={j}
              center={[c.lat, c.lng]}
              radius={g.r}
              pathOptions={{ color: 'none', fillColor: g.color, fillOpacity: g.opacity, weight: 0 }}
              interactive={false}
            />
          ))}
        </React.Fragment>
      ))}
    </MapContainer>
  );
}

export function MapaVolumenUso({ cargadores, volumenes, maxTop10 }) {
  // Log de diagnóstico para ver los valores de volumen y los IDs
  console.log('Cargadores para el mapa:', cargadores.map(c => ({id: c.id, connector_id: c.connector_id, charger_name: c.charger_name, name: c.name})));
  console.log('Volumenes por cargador:', volumenes);
  console.log('Volumen máximo TOP 10:', maxTop10);
  const cargadoresLatLng = cargadores.map(toLatLng);
  const cargadoresValidos = cargadoresLatLng.filter(c =>
    typeof c.lat === 'number' && typeof c.lng === 'number' && !isNaN(c.lat) && !isNaN(c.lng)
  );
  cargadoresValidos.forEach((c, i) => {
    // Log para ver cómo se busca el volumen
    console.log(`Cargador[${i}] id=${c.id} connector_id=${c.connector_id} charger_name=${c.charger_name} name=${c.name}`);
  });
  const center = cargadoresValidos.length
    ? [
        cargadoresValidos.reduce((a, c) => a + c.lat, 0) / cargadoresValidos.length,
        cargadoresValidos.reduce((a, c) => a + c.lng, 0) / cargadoresValidos.length
      ]
    : [-34.6, -58.4];
  return (
    <MapContainer center={center} zoom={7} style={{ height: 320, width: '100%' }} scrollWheelZoom={false}>
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
      />
      {cargadoresValidos.map((c, i) => {
        // Buscar volumen usando todos los IDs posibles
        const vol = volumenes[c.id] || volumenes[c.connector_id] || volumenes[c.charger_name] || volumenes[c.name] || 0;
        return (
          <CircleMarker
            key={c.id || i}
            center={[c.lat, c.lng]}
            radius={16}
            pathOptions={{ color: getColor(vol, maxTop10), fillColor: getColor(vol, maxTop10), fillOpacity: 0.7, weight: 2 }}
          >
            <Popup>
              <strong>{c.name || c.charger_name}</strong><br/>
              Minutos: {vol}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
