// Dark "retro arcade" Google Maps theme: deep purple landmasses, pink/blue
// roads, dark water, yellow road labels. Shared by the in-game guess map, the
// round result map, and the profile "Your Map" so they all match the UI.
export const ARCADE_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1033' }] },
  { elementType: 'geometry.stroke', stylers: [{ color: '#2e2360' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1033' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#ffd23f' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#ff7a9c' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#ff7a9c' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#ff7a9c' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#241a47' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d7dff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ff3b6b' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e0285a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#2d7dff' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#3a2c6e' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2e2360' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d0820' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5a4a8a' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#241a47' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#241a47' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2e2360' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#ff3b6b' }] },
  { featureType: 'administrative.land_parcel', elementType: 'geometry.stroke', stylers: [{ color: '#2e2360' }] },
];