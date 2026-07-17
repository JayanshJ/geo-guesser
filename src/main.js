// App entry point. Imports the module graph (which initializes Firebase as a
// side effect), exposes `initApp` on window for the Google Maps callback, then
// injects the Maps script. Maps calls `initApp` once loaded.
import { CONFIG } from './config.js';
import { initApp } from './app.js';

window.initApp = initApp;

const script = document.createElement('script');
script.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.GOOGLE_MAPS_API_KEY}&callback=initApp&libraries=geometry`;
script.async = true;
script.defer = true;
document.body.appendChild(script);