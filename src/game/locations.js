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
      { lat: 19.4326, lng: -99.1332 }, // Mexico City
      { lat: -34.6037, lng: -58.3816 },// Buenos Aires
      { lat: -23.5505, lng: -46.6333 },// São Paulo
      { lat: 59.9139, lng: 10.7522 },  // Oslo
      { lat: 60.1699, lng: 24.9384 },  // Helsinki
      { lat: 64.1466, lng: -21.9426 }, // Reykjavik
      { lat: 45.4215, lng: -75.6972 }, // Ottawa
      { lat: 49.2827, lng: -123.1207 },// Vancouver
      { lat: -1.2921, lng: 36.8219 },  // Nairobi
      { lat: 6.5244, lng: 3.3792 },    // Lagos
      { lat: 30.0444, lng: 31.2357 },  // Cairo
      { lat: -37.8136, lng: 144.9631 },// Melbourne
      { lat: 4.7110, lng: -74.0721 },  // Bogotá
      { lat: -12.0464, lng: -77.0428 },// Lima
      { lat: 35.6762, lng: 139.6503 }, // Shinjuku, Tokyo
      { lat: -17.9243, lng: 25.8567 }, // Victoria Falls
      { lat: 7.2906, lng: 80.6337 },   // Kandy, Sri Lanka
      { lat: -33.9577, lng: 18.4030 }, // Table Mountain, Cape Town
      { lat: 13.7563, lng: 100.5018 }, // Bangkok
      { lat: 6.9271, lng: 79.8612 },   // Colombo
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
      { lat: 28.5245, lng: 77.1855 },  // Qutub Minar, Delhi
      { lat: 19.0760, lng: 72.8777 },  // Marine Drive, Mumbai
      { lat: 12.6193, lng: 80.0488 },  // Mahabalipuram
      { lat: 26.1445, lng: 92.7336 },  // Guwahati
      { lat: 10.8505, lng: 76.2711 },  // Thrissur
      { lat: 32.0828, lng: 77.5420 },  // Manali
      { lat: 34.1526, lng: 77.5771 },  // Leh
      { lat: 21.1458, lng: 79.0882 },  // Nagpur
      { lat: 22.3077, lng: 73.2850 },  // Vadodara
      { lat: 26.2389, lng: 73.0258 },  // Jodhpur
      { lat: 30.7333, lng: 76.7794 },  // Chandigarh
      { lat: 8.0883, lng: 77.5417 },   // Kanyakumari
      { lat: 19.9975, lng: 73.7898 },  // Nashik
      { lat: 23.1765, lng: 75.7772 },  // Ujjain
      { lat: 25.5941, lng: 85.1376 },  // Patna
      { lat: 22.8045, lng: 86.2029 },  // Jamshedpur
      { lat: 16.7050, lng: 74.2433 },  // Kolhapur
      { lat: 28.4089, lng: 77.3178 },  // Noida
      { lat: 24.5854, lng: 73.7125 },  // Lake Pichola, Udaipur
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
      { lat: 59.9139, lng: 10.7522 },  // Oslo
      { lat: 60.1699, lng: 24.9384 },  // Helsinki
      { lat: 64.1466, lng: -21.9426 }, // Reykjavik
      { lat: 54.5973, lng: -5.9301 },  // Belfast
      { lat: 55.9533, lng: -3.1883 },  // Edinburgh
      { lat: 53.4808, lng: -2.2426 },  // Manchester
      { lat: 44.4268, lng: 26.1025 },  // Bucharest
      { lat: 42.6977, lng: 23.3219 },  // Sofia
      { lat: 45.8150, lng: 15.9819 },  // Zagreb
      { lat: 46.0569, lng: 14.5058 },  // Ljubljana
      { lat: 43.7384, lng: 7.4246 },   // Nice
      { lat: 45.7640, lng: 4.8357 },   // Lyon
      { lat: 53.5511, lng: 9.9937 },   // Hamburg
      { lat: 51.2277, lng: 6.7735 },   // Düsseldorf
      { lat: 41.1579, lng: -8.6291 },  // Porto
      { lat: 39.5804, lng: 2.6557 },   // Palma de Mallorca
      { lat: 40.6401, lng: 22.9444 },  // Thessaloniki
      { lat: 47.2692, lng: 11.4041 },  // Innsbruck
      { lat: 41.9981, lng: 21.4254 },  // Skopje
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
      { lat: 35.7796, lng: -78.6382 }, // Raleigh
      { lat: 39.9612, lng: -82.9982 }, // Columbus
      { lat: 42.3314, lng: -83.0452 }, // Detroit
      { lat: 44.9778, lng: -93.2650 }, // Minneapolis
      { lat: 35.1495, lng: -90.0490 }, // Memphis
      { lat: 33.7490, lng: -84.3880 }, // Atlanta
      { lat: 27.9506, lng: -82.4572 }, // Tampa
      { lat: 28.5383, lng: -81.3792 }, // Orlando
      { lat: 41.8240, lng: -71.4128 }, // Providence
      { lat: 43.6591, lng: -70.2568 }, // Portland, ME
      { lat: 38.5816, lng: -121.4944 },// Sacramento
      { lat: 35.4676, lng: -97.5164 }, // Oklahoma City
      { lat: 29.7604, lng: -95.3698 }, // Houston
      { lat: 35.0844, lng: -106.6504 },// Albuquerque
      { lat: 43.6150, lng: -116.2023 },// Boise
      { lat: 42.8864, lng: -78.8784 }, // Buffalo
      { lat: 40.4406, lng: -79.9959 }, // Pittsburgh
      { lat: 39.7684, lng: -86.1581 }, // Indianapolis
      { lat: 39.0997, lng: -94.5786 }, // Kansas City
      { lat: 32.2226, lng: -110.9747 },// Tucson
      { lat: 32.0809, lng: -81.0912 }, // Savannah
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
      { lat: 22.5431, lng: 114.0579 },// Shenzhen
      { lat: 23.1291, lng: 113.2644 },// Guangzhou
      { lat: 30.5728, lng: 104.0668 },// Chengdu
      { lat: 29.5630, lng: 106.5516 },// Chongqing
      { lat: 23.8103, lng: 90.4125 }, // Dhaka
      { lat: 7.2906, lng: 80.6337 },  // Kandy
      { lat: 35.6892, lng: 51.3890 }, // Tehran
      { lat: 24.7136, lng: 46.6753 }, // Riyadh
      { lat: 24.8607, lng: 67.0011 }, // Karachi
      { lat: 31.5497, lng: 74.3436 }, // Lahore
      { lat: 33.6844, lng: 73.0479 }, // Islamabad
      { lat: 43.2551, lng: 76.9126 }, // Almaty
      { lat: 41.3275, lng: 69.2817 }, // Tashkent
      { lat: 13.3671, lng: 103.8448 },// Siem Reap (Angkor)
      { lat: 33.5904, lng: 130.4017 },// Fukuoka
      { lat: 43.0618, lng: 141.3545 },// Sapporo
      { lat: 35.1815, lng: 136.9066 },// Nagoya
      { lat: 35.1796, lng: 129.0756 },// Busan
      { lat: 10.3157, lng: 123.8854 },// Cebu
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
      { lat: 40.7484, lng: -73.9857 },   // Empire State Building, NYC
      { lat: 43.6426, lng: -79.3871 },   // CN Tower, Toronto
      { lat: -13.1631, lng: -72.5450 },  // Machu Picchu
      { lat: 20.6843, lng: -88.5678 },   // Chichen Itza
      { lat: 38.6270, lng: -90.1994 },   // Gateway Arch, St. Louis
      { lat: 31.7766, lng: 35.2345 },    // Jerusalem
      { lat: 35.0394, lng: 135.7292 },   // Kinkaku-ji, Kyoto
      { lat: 34.9969, lng: 135.7850 },   // Fushimi Inari, Kyoto
      { lat: -33.9577, lng: 18.4030 },   // Table Mountain, Cape Town
      { lat: 34.1341, lng: -118.3215 },  // Hollywood Sign, LA
      { lat: 34.1184, lng: -118.3004 },  // Griffith Observatory, LA
      { lat: 47.6205, lng: -122.3493 },  // Space Needle, Seattle
      { lat: 40.6892, lng: -74.0445 },   // Statue of Liberty, NYC
      { lat: 40.7061, lng: -73.9969 },   // Brooklyn Bridge, NYC
      { lat: 51.5055, lng: -0.0754 },    // Tower Bridge, London
      { lat: 55.9489, lng: -3.1994 },    // Edinburgh Castle
      { lat: 47.5576, lng: 10.7498 },    // Neuschwanstein Castle
      { lat: 48.6360, lng: -1.5115 },    // Mont Saint-Michel
      { lat: 43.7230, lng: 10.3966 },    // Leaning Tower of Pisa
      { lat: 43.7696, lng: 11.2558 },    // Florence (Duomo)
      { lat: 42.6507, lng: 18.0944 },    // Dubrovnik old town
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
  // back to a random coord only if a mode has no curated list. `exclude` is an
  // optional list of {lat,lng} coords to skip (e.g. coords already used this
  // game, so a coverage-failure swap can't repeat a round).
  static curated(mode, count, exclude = []) {
    const def = MODES[mode] || MODES.world;
    const list = def.curated && def.curated.length ? def.curated : null;
    if (!list) {
      const out = [];
      for (let i = 0; i < count; i++) out.push(this.randomForMode(mode));
      return out;
    }
    const isExcluded = (c) =>
      exclude.some(
        (e) => e && Math.abs(e.lat - c.lat) < 1e-6 && Math.abs(e.lng - c.lng) < 1e-6,
      );
    const pool = shuffle([...list]).filter((c) => !isExcluded(c));
    const result = [];
    for (let i = 0; i < count; i++) {
      // Refill from the full list (including excluded) only if the filtered
      // pool is exhausted — avoids an infinite loop if exclude covers everything.
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

  // --- Cross-game variety memory -----------------------------------------
  // Persist the most recently used coords per mode so consecutive games don't
  // keep landing on the same handful of spots. Stored in localStorage as a
  // capped, ordered list. Generation entry points call recentForMode() to get
  // an exclude set, pick from the rest, then markUsed() the picks. The pure
  // game-math functions (computeScore, computeSpeedBonus, …) are unaffected;
  // these are the only localStorage-touching helpers.
  static _recentKey(mode) { return `geoguesser_recent_${mode}`; }

  static recentForMode(mode) {
    try {
      const raw = localStorage.getItem(this._recentKey(mode));
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr)
        ? arr.filter((c) => c && typeof c.lat === 'number' && typeof c.lng === 'number')
        : [];
    } catch { return []; }
  }

  // Append `coords` to the per-mode recent list, dropping the oldest beyond a
  // cap that leaves enough headroom for the next game to always find fresh
  // spots (cap = list.length - 8, min 20).
  static markUsed(mode, coords) {
    if (!Array.isArray(coords) || coords.length === 0) return;
    const def = MODES[mode] || MODES.world;
    const list = def.curated || [];
    const cap = Math.max(20, list.length - 8);
    const key = (c) => `${Number(c.lat).toFixed(4)},${Number(c.lng).toFixed(4)}`;
    const seen = new Set(this.recentForMode(mode).map(key));
    for (const c of coords) {
      if (c && typeof c.lat === 'number' && typeof c.lng === 'number') seen.add(key(c));
    }
    // Set preserves insertion order; slice(-cap) keeps the most recent and
    // drops the oldest so the memory never grows unbounded.
    const stored = [...seen].slice(-cap).map((k) => {
      const [lat, lng] = k.split(',').map(Number);
      return { lat, lng };
    });
    try { localStorage.setItem(this._recentKey(mode), JSON.stringify(stored)); } catch { /* ignore quota */ }
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