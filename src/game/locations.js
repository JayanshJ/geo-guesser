// Location generation + mode metadata. Replaces the two duplicated random
// generators (GameController + MultiplayerService) with one source of truth.
//
// Each mode has a curated list of real, Street View-covered coordinates (so
// rounds no longer land in ocean/empty areas) plus scoring/map metadata.
// `LocationGenerator.hasStreetView` pre-validates a coord against the Street
// View Static metadata endpoint before the heavier getPanorama call; the game
// controller uses it as a safety net when a curated spot has lost coverage.

export const MODES = {
  world: {
    label: 'World',
    emoji: '🌍',
    mapCenter: { lat: 20, lng: 0 },
    mapZoom: 2,
    decayFactor: 2000,
    curated: [
      { lat: 48.8584, lng: 2.2945 },   // Eiffel Tower, Paris
      { lat: 40.7580, lng: -73.9855 }, // Times Square, NYC
      { lat: 51.5080, lng: -0.1281 },  // Trafalgar Square, London
      { lat: 35.6595, lng: 139.7004 }, // Shibuya, Tokyo
      { lat: -33.8568, lng: 151.2153 },// Sydney Opera House
      { lat: -22.9711, lng: -43.1822 },// Copacabana, Rio
      { lat: 41.8902, lng: 12.4922 },  // Colosseum, Rome
      { lat: 29.9792, lng: 31.1342 },  // Pyramids of Giza
      { lat: 55.7539, lng: 37.6208 },  // Red Square, Moscow
      { lat: -33.9249, lng: 18.4241 }, // Cape Town
      { lat: 43.6532, lng: -79.3832 }, // Toronto
      { lat: 52.5163, lng: 13.3777 },  // Brandenburg Gate, Berlin
      { lat: 41.4036, lng: 2.1744 },   // Sagrada Familia, Barcelona
      { lat: 25.1972, lng: 55.2744 },  // Burj Khalifa, Dubai
      { lat: 1.2834, lng: 103.8607 },  // Singapore
      { lat: 41.0086, lng: 28.9802 },  // Hagia Sophia, Istanbul
      { lat: 37.8199, lng: -122.4783 },// Golden Gate Bridge, SF
      { lat: 52.3676, lng: 4.9041 },   // Amsterdam
      { lat: 48.2082, lng: 16.3738 },  // Vienna
      { lat: 37.9715, lng: 23.7257 },  // Acropolis, Athens
    ],
  },
  india: {
    label: 'India',
    emoji: '🇮🇳',
    mapCenter: { lat: 22.5937, lng: 78.9629 },
    mapZoom: 5,
    decayFactor: 300,
    curated: [
      { lat: 28.6129, lng: 77.2295 },  // India Gate, Delhi
      { lat: 18.9220, lng: 72.8347 },  // Gateway of India, Mumbai
      { lat: 26.9239, lng: 75.8267 },  // Hawa Mahal, Jaipur
      { lat: 27.1751, lng: 78.0421 },  // Taj Mahal, Agra
      { lat: 25.3176, lng: 83.0064 },  // Varanasi ghats
      { lat: 22.5448, lng: 88.3426 },  // Victoria Memorial, Kolkata
      { lat: 13.0500, lng: 80.2824 },  // Marina Beach, Chennai
      { lat: 12.9716, lng: 77.5946 },  // Bengaluru
      { lat: 24.5712, lng: 73.6817 },  // Udaipur
      { lat: 9.9312, lng: 76.2673 },   // Kochi
      { lat: 17.3616, lng: 78.4747 },  // Charminar, Hyderabad
      { lat: 31.6340, lng: 74.8723 },  // Golden Temple, Amritsar
      { lat: 15.4989, lng: 73.8279 },  // Goa
      { lat: 11.9416, lng: 79.8083 },  // Pondicherry
      { lat: 12.3052, lng: 76.6552 },  // Mysore Palace
      { lat: 26.8467, lng: 80.9462 },  // Lucknow
      { lat: 23.0225, lng: 72.5717 },  // Ahmedabad
      { lat: 31.1048, lng: 77.1734 },  // Shimla
      { lat: 27.0410, lng: 88.2663 },  // Darjeeling
      { lat: 30.1086, lng: 78.2944 },  // Rishikesh
    ],
  },
  europe: {
    label: 'Europe',
    emoji: '🇪🇺',
    mapCenter: { lat: 50, lng: 10 },
    mapZoom: 3,
    decayFactor: 400,
    curated: [
      { lat: 48.8584, lng: 2.2945 },   // Paris
      { lat: 51.5080, lng: -0.1281 },  // London
      { lat: 41.8902, lng: 12.4922 },  // Rome
      { lat: 52.5163, lng: 13.3777 },  // Berlin
      { lat: 40.4168, lng: -3.7038 },  // Madrid
      { lat: 41.4036, lng: 2.1744 },   // Barcelona
      { lat: 52.3676, lng: 4.9041 },   // Amsterdam
      { lat: 48.2082, lng: 16.3738 },  // Vienna
      { lat: 50.0875, lng: 14.4213 },  // Prague
      { lat: 45.4408, lng: 12.3155 },  // Venice
      { lat: 37.9715, lng: 23.7257 },  // Athens
      { lat: 38.7223, lng: -9.1393 },  // Lisbon
      { lat: 53.3498, lng: -6.2603 },  // Dublin
      { lat: 59.3293, lng: 18.0686 },  // Stockholm
      { lat: 55.6761, lng: 12.5683 },  // Copenhagen
      { lat: 47.4979, lng: 19.0402 },  // Budapest
      { lat: 50.0647, lng: 19.9450 },  // Krakow
      { lat: 50.8466, lng: 4.3528 },   // Brussels
      { lat: 48.1351, lng: 11.5820 },  // Munich
      { lat: 47.3769, lng: 8.5417 },   // Zurich
    ],
  },
  us: {
    label: 'United States',
    emoji: '🇺🇸',
    mapCenter: { lat: 39, lng: -98 },
    mapZoom: 3,
    decayFactor: 500,
    curated: [
      { lat: 40.7580, lng: -73.9855 }, // Times Square, NYC
      { lat: 37.8199, lng: -122.4783 },// Golden Gate, SF
      { lat: 34.0522, lng: -118.2437 },// Los Angeles
      { lat: 41.8827, lng: -87.6233 }, // Chicago
      { lat: 25.7907, lng: -80.1300 }, // Miami
      { lat: 47.6062, lng: -122.3321 },// Seattle
      { lat: 42.3601, lng: -71.0589 }, // Boston
      { lat: 36.1147, lng: -115.1728 },// Las Vegas
      { lat: 38.8977, lng: -77.0365 }, // Washington DC
      { lat: 29.9511, lng: -90.0715 }, // New Orleans
      { lat: 30.2672, lng: -97.7431 },// Austin
      { lat: 39.7392, lng: -104.9903 },// Denver
      { lat: 45.5152, lng: -122.6784 },// Portland
      { lat: 32.7157, lng: -117.1611 },// San Diego
      { lat: 39.9526, lng: -75.1652 }, // Philadelphia
      { lat: 36.1627, lng: -86.7816 }, // Nashville
      { lat: 21.3156, lng: -157.8581 },// Honolulu
      { lat: 61.2181, lng: -149.9003 },// Anchorage
      { lat: 40.7683, lng: -111.8678 },// Salt Lake City
      { lat: 32.7765, lng: -79.9311 }, // Charleston
    ],
  },
  asia: {
    label: 'Asia',
    emoji: '🌏',
    mapCenter: { lat: 30, lng: 100 },
    mapZoom: 3,
    decayFactor: 600,
    curated: [
      { lat: 35.6595, lng: 139.7004 }, // Shibuya, Tokyo
      { lat: 35.0116, lng: 135.7681 },// Kyoto
      { lat: 37.5665, lng: 126.9780 },// Seoul
      { lat: 39.9042, lng: 116.4074 },// Beijing
      { lat: 31.2304, lng: 121.4737 },// Shanghai
      { lat: 22.3193, lng: 114.1694 },// Hong Kong
      { lat: 1.2834, lng: 103.8607 }, // Singapore
      { lat: 13.7563, lng: 100.5018 },// Bangkok
      { lat: 3.1390, lng: 101.6869 }, // Kuala Lumpur
      { lat: 25.0330, lng: 121.5654 },// Taipei
      { lat: -6.2088, lng: 106.8456 },// Jakarta
      { lat: 14.5995, lng: 120.9842 },// Manila
      { lat: 21.0285, lng: 105.8542 },// Hanoi
      { lat: 25.1972, lng: 55.2744 }, // Dubai
      { lat: 41.0086, lng: 28.9802 }, // Istanbul
      { lat: 27.7172, lng: 85.3240 }, // Kathmandu
      { lat: 6.9271, lng: 79.8612 },  // Colombo
      { lat: 34.6937, lng: 135.5023 },// Osaka
      { lat: -8.4095, lng: 115.1889 },// Bali
      { lat: 10.8231, lng: 106.6297 },// Ho Chi Minh City
    ],
  },
  landmarks: {
    label: 'Famous Landmarks',
    emoji: '🏛️',
    mapCenter: { lat: 20, lng: 0 },
    mapZoom: 2,
    decayFactor: 2000,
    curated: [
      { lat: 48.8584, lng: 2.2945 },   // Eiffel Tower
      { lat: 40.7580, lng: -73.9855 }, // Times Square
      { lat: 41.8902, lng: 12.4922 },   // Colosseum
      { lat: 27.1751, lng: 78.0421 },   // Taj Mahal
      { lat: 40.4319, lng: 116.5704 },  // Great Wall (Badaling)
      { lat: -33.8568, lng: 151.2153 }, // Sydney Opera House
      { lat: 29.9792, lng: 31.1342 },   // Pyramids of Giza
      { lat: 51.1789, lng: -1.8262 },   // Stonehenge
      { lat: 36.0544, lng: -112.1401 },// Grand Canyon
      { lat: 43.0828, lng: -79.0742 }, // Niagara Falls
      { lat: 35.3606, lng: 138.7274 },  // Mount Fuji area
      { lat: 25.1972, lng: 55.2744 },   // Burj Khalifa
      { lat: 13.4125, lng: 103.8670 },  // Angkor Wat
      { lat: 36.3932, lng: 25.4615 },   // Santorini
      { lat: 43.8791, lng: -103.4591 }, // Mount Rushmore
      { lat: 37.8199, lng: -122.4783 }, // Golden Gate Bridge
      { lat: 51.5007, lng: -0.1246 },   // Big Ben, London
      { lat: -22.9519, lng: -43.2105 }, // Christ the Redeemer, Rio
      { lat: 37.9715, lng: 23.7257 },   // Acropolis
      { lat: 30.3285, lng: 35.4444 },    // Petra area
    ],
  },
};

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export class LocationGenerator {
  // Synchronous curated pick. Samples `count` coords for the mode, shuffling
  // and refilling (with replacement) if the list is smaller than count. Falls
  // back to a random coord only if a mode has no curated list.
  static curated(mode, count) {
    const def = MODES[mode] || MODES.world;
    const list = def.curated && def.curated.length ? def.curated : null;
    if (!list) {
      const out = [];
      for (let i = 0; i < count; i++) out.push(this.randomForMode(mode));
      return out;
    }
    const pool = shuffle([...list]);
    const result = [];
    for (let i = 0; i < count; i++) {
      if (pool.length === 0) pool.push(...shuffle([...list]));
      result.push(pool.pop());
    }
    return result;
  }

  // Random coord fallback (used only when a mode lacks a curated list, or as a
  // last-resort retry candidate).
  static randomForMode(mode) {
    if (mode === 'india') return { lat: 8 + Math.random() * 29, lng: 68 + Math.random() * 29 };
    return { lat: Math.random() * 160 - 80, lng: Math.random() * 360 - 180 };
  }

  // Pre-validate a coord against the Street View Static metadata endpoint.
  // Returns true if an outdoor panorama exists within 50km. Mirrors the
  // getPanorama(radius:50000, source:OUTDOOR) call used at runtime.
  static async hasStreetView(coord, apiKey) {
    if (!apiKey) return true; // can't validate without a key; trust getPanorama
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${coord.lat},${coord.lng}&radius=50000&source=outdoor&key=${apiKey}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      return data.status === 'OK';
    } catch (e) {
      console.warn('Street View metadata check failed:', e);
      return true; // don't block the game on a network hiccup
    }
  }

  // Pick `count` coords confirmed (via metadata) to have Street View. Used as a
  // safety net when a curated spot may have lost coverage. Falls back to
  // unvalidated curated picks if validation exhausts its attempt budget.
  static async validated(mode, count, apiKey, maxAttempts = 40) {
    const def = MODES[mode] || MODES.world;
    const list = def.curated && def.curated.length ? def.curated : null;
    const picked = [];
    let attempts = 0;
    while (picked.length < count && attempts < maxAttempts) {
      attempts++;
      const cand = list ? list[Math.floor(Math.random() * list.length)] : this.randomForMode(mode);
      if (await this.hasStreetView(cand, apiKey)) picked.push(cand);
    }
    while (picked.length < count) {
      picked.push(list ? list[Math.floor(Math.random() * list.length)] : this.randomForMode(mode));
    }
    return picked;
  }
}

export function getModeMeta(mode) {
  return MODES[mode] || MODES.world;
}

// Distance-based round score. Perfect (0 km) = 5000; decays exponentially so
// the score halves roughly every `decayFactor` km. Smaller regions use a
// tighter decay so a 50 km miss is costly locally but trivial globally.
export function computeScore(distanceKm, decayFactor) {
  return Math.round(5000 * Math.exp(-distanceKm / decayFactor));
}

// Speed bonus: extra ARCADE points for fast guesses, decaying linearly from
// MAX_SPEED_BONUS (instant guess) to 0 (time ran out). No bonus under
// unlimited time (no speed pressure) or when the timer was never started.
// This is arcade-only — it never feeds into ranked ELO (see GameController:
// ELO is computed from the distance-only baseScore). Pure & unit-tested.
export const MAX_SPEED_BONUS = 500;
export function computeSpeedBonus(timeUsedSec, timeLimitSec) {
  if (!timeLimitSec || timeLimitSec === 'unlimited') return 0;
  const limit = Number(timeLimitSec);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  if (timeUsedSec == null || !Number.isFinite(Number(timeUsedSec))) return 0;
  const used = Math.max(0, Math.min(Number(timeUsedSec), limit));
  const fraction = 1 - used / limit; // 1 at instant guess, 0 at time-up
  const raw = MAX_SPEED_BONUS * fraction;
  return Math.round(raw / 10) * 10; // snap to nearest 10 for arcade feel
}

// Streak multiplier: consecutive sub-500m guesses build a combo. x1 at 0–1
// good guesses, then +1 per consecutive good guess, capped at x5. The
// multiplier amplifies the (arcade-only) speed bonus and is shown on-screen
// as the x2/x3 arcade counter. Pure & unit-tested.
export const STREAK_THRESHOLD_KM = 0.5;
export const MAX_STREAK_MULTIPLIER = 5;
export function computeStreakMultiplier(consecutiveSub500mCount) {
  const n = Math.max(0, Math.floor(Number(consecutiveSub500mCount) || 0));
  return Math.max(1, Math.min(n, MAX_STREAK_MULTIPLIER));
}