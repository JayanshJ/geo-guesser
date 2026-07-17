// App entry point. Imports the module graph (which initializes Firebase as a
// side effect), runs UI/auth init IMMEDIATELY (not gated on Maps), then injects
// the Google Maps script. Maps calls `onMapsReady` once loaded; if the key is
// bad it calls `onMapsAuthFailure` instead.
import { CONFIG } from './config.js';
import { initUI, onMapsReady, onMapsAuthFailure } from './app.js';

// UI + auth init run now, independent of Maps — so login/guest work even if the
// Maps script is slow, blocked, or failing on a missing key.
initUI();

window.initApp = onMapsReady;
window.gm_authFailure = onMapsAuthFailure;

const script = document.createElement('script');
script.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.GOOGLE_MAPS_API_KEY}&callback=initApp&libraries=geometry`;
script.async = true;
script.defer = true;
script.onerror = onMapsAuthFailure;
document.body.appendChild(script);