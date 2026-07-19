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
      { lat: 50.8503, lng: 4.3517 },   // Brussels
      { lat: 40.4168, lng: -3.7038 },  // Madrid
      { lat: 38.7223, lng: -9.1393 },  // Lisbon
      { lat: 59.3293, lng: 18.0686 },  // Stockholm
      { lat: 55.6761, lng: 12.5683 },  // Copenhagen
      { lat: 53.3498, lng: -6.2603 },  // Dublin
      { lat: 50.0875, lng: 14.4213 },  // Prague
      { lat: 47.4979, lng: 19.0402 },  // Budapest
      { lat: 52.2297, lng: 21.0122 },  // Warsaw
      { lat: 48.1351, lng: 11.5820 },  // Munich
      { lat: 47.3769, lng: 8.5417 },   // Zurich
      { lat: 55.9533, lng: -3.1883 },  // Edinburgh
      { lat: 37.5665, lng: 126.9780 }, // Seoul
      { lat: 39.9042, lng: 116.4074 }, // Beijing
      { lat: 31.2304, lng: 121.4737 }, // Shanghai
      { lat: 22.3193, lng: 114.1694 }, // Hong Kong
      { lat: 3.1390, lng: 101.6869 },  // Kuala Lumpur
      { lat: -6.2088, lng: 106.8456 },// Jakarta
      { lat: 14.5995, lng: 120.9842 },// Manila
      { lat: 25.0330, lng: 121.5654 },// Taipei
      { lat: 21.0285, lng: 105.8542 },// Hanoi
      { lat: 35.0116, lng: 135.7681 },// Kyoto
      { lat: 34.6937, lng: 135.5023 },// Osaka
      { lat: 27.7172, lng: 85.3240 }, // Kathmandu
      { lat: -8.4095, lng: 115.1889 },// Bali
      { lat: 10.8231, lng: 106.6297 },// Ho Chi Minh City
      { lat: 35.6892, lng: 51.3890 }, // Tehran
      { lat: 24.7136, lng: 46.6753 }, // Riyadh
      { lat: 24.8607, lng: 67.0011 }, // Karachi
      { lat: 31.5497, lng: 74.3436 }, // Lahore
      { lat: 43.2551, lng: 76.9126 }, // Almaty
      { lat: 41.3275, lng: 69.2817 }, // Tashkent
      { lat: 13.3671, lng: 103.8448 },// Siem Reap (Angkor)
      { lat: 43.0618, lng: 141.3545 },// Sapporo
      { lat: 35.1815, lng: 136.9066 },// Nagoya
      { lat: 35.1796, lng: 129.0756 },// Busan
      { lat: -26.2041, lng: 28.0473 },// Johannesburg
      { lat: 33.5731, lng: -7.5898 }, // Casablanca
      { lat: 9.0249, lng: 38.7463 },  // Addis Ababa
      { lat: 5.6037, lng: -0.1870 },  // Accra
      { lat: 14.7167, lng: -17.4677 },// Dakar
      { lat: 36.8065, lng: 10.1815 }, // Tunis
      { lat: 36.7372, lng: 3.0865 },  // Algiers
      { lat: 34.0209, lng: -6.8416 }, // Rabat
      { lat: -25.9692, lng: 32.5732 },// Maputo
      { lat: 0.3476, lng: 32.5825 },  // Kampala
      { lat: -1.9706, lng: 30.1044 }, // Kigali
      { lat: -33.4489, lng: -70.6693 },// Santiago
      { lat: 23.1136, lng: -82.3666 },// Havana
      { lat: 9.9281, lng: -84.0907 }, // San José, CR
      { lat: 8.9824, lng: -79.5199 }, // Panama City
      { lat: -0.1807, lng: -78.4676 },// Quito
      { lat: 10.4806, lng: -66.9036 },// Caracas
      { lat: -34.9011, lng: -56.1645 },// Montevideo
      { lat: -25.2637, lng: -57.5759 },// Asunción
      { lat: 18.4861, lng: -69.9312 },// Santo Domingo
      { lat: 14.6349, lng: -90.5069 },// Guatemala City
      { lat: -36.8485, lng: 174.7633 },// Auckland
      { lat: -41.2865, lng: 174.7762 },// Wellington
      { lat: -31.9523, lng: 115.8613 },// Perth
      { lat: -27.4698, lng: 153.0251 },// Brisbane
      { lat: -43.5321, lng: 172.6362 },// Christchurch
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
      { lat: 28.6562, lng: 77.2410 },  // Red Fort, Delhi
      { lat: 28.6127, lng: 77.2773 },  // Akshardham, Delhi
      { lat: 28.6315, lng: 77.2167 },  // Connaught Place, Delhi
      { lat: 28.5933, lng: 77.2507 },  // Humayun's Tomb, Delhi
      { lat: 28.5535, lng: 77.2588 },  // Lotus Temple, Delhi
      { lat: 28.6562, lng: 77.2300 },  // Chandni Chowk, Delhi
      { lat: 18.9398, lng: 72.8355 },  // CST, Mumbai
      { lat: 19.0420, lng: 72.8197 },  // Bandra-Worli Sea Link
      { lat: 18.9830, lng: 72.8295 },  // Haji Ali, Mumbai
      { lat: 26.9855, lng: 75.8513 },  // Amber Fort, Jaipur
      { lat: 26.9244, lng: 75.8263 },  // Jantar Mantar, Jaipur
      { lat: 26.4899, lng: 74.5511 },  // Pushkar
      { lat: 28.0159, lng: 73.3170 },  // Bikaner
      { lat: 24.5925, lng: 72.7156 },  // Mount Abu
      { lat: 15.3350, lng: 76.4600 },  // Hampi
      { lat: 12.4244, lng: 75.7363 },  // Madikeri (Coorg)
      { lat: 11.4106, lng: 76.6955 },  // Ooty
      { lat: 9.4981, lng: 76.3388 },   // Alleppey
      { lat: 8.7379, lng: 76.7163 },   // Varkala
      { lat: 8.5241, lng: 76.9366 },   // Trivandrum
      { lat: 10.7870, lng: 79.1378 },  // Thanjavur
      { lat: 9.9252, lng: 78.1198 },   // Madurai
      { lat: 13.6288, lng: 79.4192 },  // Tirupati
      { lat: 11.0168, lng: 76.9558 },  // Coimbatore
      { lat: 10.7905, lng: 78.7047 },  // Tiruchirappalli
      { lat: 18.5204, lng: 73.8567 },  // Pune
      { lat: 21.1702, lng: 72.8311 },  // Surat
      { lat: 21.8380, lng: 73.7191 },  // Statue of Unity
      { lat: 23.2156, lng: 72.6369 },  // Gandhinagar
      { lat: 22.3039, lng: 70.8022 },  // Rajkot
      { lat: 20.8880, lng: 70.4145 },  // Somnath
      { lat: 18.7546, lng: 73.4062 },  // Lonavala
      { lat: 19.8762, lng: 75.3433 },  // Aurangabad (Ellora base)
      { lat: 20.2961, lng: 85.8245 },  // Bhubaneswar
      { lat: 19.8135, lng: 85.8312 },  // Puri
      { lat: 19.8876, lng: 86.0945 },  // Konark Sun Temple
      { lat: 23.2599, lng: 77.4126 },  // Bhopal
      { lat: 26.2183, lng: 78.1828 },  // Gwalior
      { lat: 24.8318, lng: 79.9199 },  // Khajuraho
      { lat: 25.1906, lng: 78.6430 },  // Orchha
      { lat: 22.7196, lng: 75.8577 },  // Indore
      { lat: 21.2514, lng: 81.6296 },  // Raipur
      { lat: 26.7271, lng: 88.3953 },  // Siliguri
      { lat: 27.3389, lng: 88.6125 },  // Gangtok
      { lat: 25.5788, lng: 91.8933 },  // Shillong
      { lat: 27.5866, lng: 91.8602 },  // Tawang
      { lat: 23.7271, lng: 92.7176 },  // Aizawl
      { lat: 24.8170, lng: 93.9368 },  // Imphal
      { lat: 27.4728, lng: 94.9120 },  // Dibrugarh
      { lat: 30.3165, lng: 78.0322 },  // Dehradun
      { lat: 30.4598, lng: 78.0664 },  // Mussoorie
      { lat: 29.3919, lng: 79.4542 },  // Nainital
      { lat: 32.2190, lng: 76.3234 },  // Dharamshala
      { lat: 34.0837, lng: 74.7973 },  // Srinagar
      { lat: 34.0480, lng: 74.3805 },  // Gulmarg
      { lat: 10.2381, lng: 77.4892 },  // Kodaikanal
      { lat: 22.5880, lng: 88.3358 },  // Howrah Bridge, Kolkata
      { lat: 23.6888, lng: 87.6790 },  // Shantiniketan
      { lat: 21.6230, lng: 87.5010 },  // Digha
      { lat: 17.6868, lng: 83.2185 },  // Visakhapatnam
      { lat: 16.5062, lng: 80.6480 },  // Vijayawada
      { lat: 31.0104, lng: 75.9520 },  // Jalandhar
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
      { lat: 45.4642, lng: 9.1900 },   // Milan
      { lat: 40.8518, lng: 14.2681 },  // Naples
      { lat: 43.7696, lng: 11.2558 },  // Florence
      { lat: 44.4949, lng: 11.3426 },  // Bologna
      { lat: 45.4384, lng: 10.9916 },  // Verona
      { lat: 44.4056, lng: 8.9460 },   // Genoa
      { lat: 38.1157, lng: 13.3615 },  // Palermo
      { lat: 41.1171, lng: 16.8719 },  // Bari
      { lat: 37.5079, lng: 15.0830 },  // Catania
      { lat: 43.2965, lng: 5.3698 },   // Marseille
      { lat: 43.6047, lng: 1.4442 },   // Toulouse
      { lat: 44.8378, lng: -0.5792 },  // Bordeaux
      { lat: 48.5734, lng: 7.7521 },   // Strasbourg
      { lat: 47.2184, lng: -1.5536 },  // Nantes
      { lat: 43.5528, lng: 7.0174 },   // Cannes
      { lat: 39.4699, lng: -0.3763 },  // Valencia
      { lat: 37.3886, lng: -5.9823 },  // Seville
      { lat: 43.2630, lng: -2.9250 },  // Bilbao
      { lat: 36.5210, lng: -4.8820 },  // Málaga
      { lat: 41.6488, lng: -0.8891 },  // Zaragoza
      { lat: 37.1773, lng: -3.5986 },  // Granada
      { lat: 43.3188, lng: -1.9816 },  // San Sebastián
      { lat: 50.1109, lng: 8.6821 },   // Frankfurt
      { lat: 48.7758, lng: 9.1829 },   // Stuttgart
      { lat: 50.9375, lng: 6.9603 },   // Cologne
      { lat: 51.3397, lng: 12.3731 },  // Leipzig
      { lat: 51.0504, lng: 13.7373 },  // Dresden
      { lat: 49.4521, lng: 11.0767 },  // Nuremberg
      { lat: 46.2044, lng: 6.1432 },   // Geneva
      { lat: 47.5596, lng: 7.5886 },   // Basel
      { lat: 46.9480, lng: 7.4474 },   // Bern
      { lat: 46.5197, lng: 6.6323 },   // Lausanne
      { lat: 47.0502, lng: 8.3093 },   // Lucerne
      { lat: 51.2194, lng: 4.4025 },   // Antwerp
      { lat: 51.2093, lng: 3.2247 },   // Bruges
      { lat: 51.0543, lng: 3.7174 },   // Ghent
      { lat: 51.9244, lng: 4.4777 },   // Rotterdam
      { lat: 52.0705, lng: 4.3007 },   // The Hague
      { lat: 52.0907, lng: 5.1214 },   // Utrecht
      { lat: 51.4416, lng: 5.4697 },   // Eindhoven
      { lat: 57.7089, lng: 11.9746 },  // Gothenburg
      { lat: 55.6050, lng: 13.0038 },  // Malmö
      { lat: 60.3913, lng: 5.3221 },   // Bergen
      { lat: 56.1629, lng: 10.2039 },  // Aarhus
      { lat: 61.4978, lng: 23.7610 },  // Tampere
      { lat: 54.3520, lng: 18.6466 },  // Gdańsk
      { lat: 51.1079, lng: 17.0385 },  // Wrocław
      { lat: 52.4064, lng: 16.9252 },  // Poznań
      { lat: 59.4370, lng: 24.7536 },  // Tallinn
      { lat: 56.9496, lng: 24.1052 },  // Riga
      { lat: 54.6872, lng: 25.2797 },  // Vilnius
      { lat: 44.7866, lng: 20.4489 },  // Belgrade
      { lat: 43.8563, lng: 18.4131 },  // Sarajevo
      { lat: 41.3275, lng: 19.8189 },  // Tirana
      { lat: 50.4501, lng: 30.5234 },  // Kyiv
      { lat: 49.8397, lng: 24.0297 },  // Lviv
      { lat: 59.9311, lng: 30.3609 },  // St Petersburg
      { lat: 43.5855, lng: 39.7239 },  // Sochi
      { lat: 38.4192, lng: 27.1287 },  // Izmir
      { lat: 36.8969, lng: 30.7133 },  // Antalya
      { lat: 41.6938, lng: 44.8015 },  // Tbilisi
      { lat: 40.4093, lng: 49.8671 },  // Baku
      { lat: 35.1856, lng: 33.3823 },  // Nicosia
      { lat: 35.8989, lng: 14.5146 },  // Valletta
      { lat: 49.6116, lng: 6.1319 },   // Luxembourg
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
      { lat: 33.4484, lng: -112.0740 },// Phoenix
      { lat: 32.7767, lng: -96.7970 }, // Dallas
      { lat: 29.4241, lng: -98.4936 }, // San Antonio
      { lat: 37.3382, lng: -121.8863 },// San Jose
      { lat: 35.2271, lng: -80.8431 }, // Charlotte
      { lat: 39.2904, lng: -76.6122 }, // Baltimore
      { lat: 43.0389, lng: -87.9065 }, // Milwaukee
      { lat: 39.1031, lng: -84.5120 }, // Cincinnati
      { lat: 41.4993, lng: -81.6944 }, // Cleveland
      { lat: 38.6270, lng: -90.1994 }, // St. Louis
      { lat: 40.7357, lng: -74.1724 }, // Newark
      { lat: 37.8044, lng: -122.2712 },// Oakland
      { lat: 33.7701, lng: -118.1937 },// Long Beach
      { lat: 36.7378, lng: -119.7871 },// Fresno
      { lat: 33.8366, lng: -117.9143 },// Anaheim
      { lat: 39.5296, lng: -119.8138 },// Reno
      { lat: 33.4942, lng: -111.9261 },// Scottsdale
      { lat: 47.6588, lng: -117.4260 },// Spokane
      { lat: 47.2529, lng: -122.4443 },// Tacoma
      { lat: 44.0521, lng: -123.0868 },// Eugene
      { lat: 44.0582, lng: -121.3153 },// Bend
      { lat: 38.8339, lng: -104.8214 },// Colorado Springs
      { lat: 40.0150, lng: -105.2705 },// Boulder
      { lat: 39.6403, lng: -106.3742 },// Vail
      { lat: 39.1911, lng: -106.8175 },// Aspen
      { lat: 43.4752, lng: -110.7576 },// Jackson, WY
      { lat: 45.7833, lng: -108.5007 },// Billings
      { lat: 46.8625, lng: -113.9848 },// Missoula
      { lat: 45.6770, lng: -111.0429 },// Bozeman
      { lat: 42.8666, lng: -106.3131 },// Casper
      { lat: 35.6870, lng: -105.9378 },// Santa Fe
      { lat: 36.4072, lng: -105.5729 },// Taos
      { lat: 35.1983, lng: -111.6513 },// Flagstaff
      { lat: 34.8697, lng: -111.7610 },// Sedona
      { lat: 39.1638, lng: -119.7674 },// Carson City
      { lat: 42.8722, lng: -112.4482 },// Pocatello
      { lat: 43.4917, lng: -112.0408 },// Idaho Falls
      { lat: 47.6777, lng: -116.7805 },// Coeur d'Alene
      { lat: 46.6021, lng: -120.5056 },// Yakima
      { lat: 48.7596, lng: -122.4882 },// Bellingham
      { lat: 26.1224, lng: -80.1370 }, // Fort Lauderdale
      { lat: 24.5551, lng: -81.7800 }, // Key West
      { lat: 30.4382, lng: -84.2807 }, // Tallahassee
      { lat: 30.6954, lng: -88.0399 }, // Mobile
      { lat: 32.3792, lng: -86.3077 }, // Montgomery
      { lat: 33.5186, lng: -86.8104 }, // Birmingham
      { lat: 34.7465, lng: -92.2896 }, // Little Rock
      { lat: 32.5251, lng: -93.7502 }, // Shreveport
      { lat: 30.4515, lng: -91.1871 }, // Baton Rouge
      { lat: 32.2988, lng: -90.1848 }, // Jackson, MS
      { lat: 30.3674, lng: -89.0923 }, // Gulfport
      { lat: 41.0814, lng: -81.5190 }, // Akron
      { lat: 41.6528, lng: -83.5379 }, // Toledo
      { lat: 39.7589, lng: -84.1916 }, // Dayton
      { lat: 41.0793, lng: -85.1194 }, // Fort Wayne
      { lat: 41.5868, lng: -93.6250 }, // Des Moines
      { lat: 37.6872, lng: -97.3301 }, // Wichita
      { lat: 40.8258, lng: -96.6852 }, // Lincoln
      { lat: 41.2565, lng: -95.9345 }, // Omaha
      { lat: 46.8772, lng: -96.7898 }, // Fargo
      { lat: 43.5511, lng: -96.4533 }, // Sioux Falls
      { lat: 20.8783, lng: -156.6822 },// Lahaina
      { lat: 64.8378, lng: -147.7164 },// Fairbanks
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
      { lat: 35.4437, lng: 139.6386 },// Yokohama
      { lat: 34.6901, lng: 135.1955 },// Kobe
      { lat: 34.3853, lng: 132.4553 },// Hiroshima
      { lat: 32.7503, lng: 129.8779 },// Nagasaki
      { lat: 34.6851, lng: 135.8048 },// Nara
      { lat: 35.0910, lng: 139.0255 },// Hakone
      { lat: 26.2125, lng: 127.6791 },// Naha, Okinawa
      { lat: 37.4563, lng: 126.7052 },// Incheon
      { lat: 35.8714, lng: 128.6014 },// Daegu
      { lat: 36.3504, lng: 127.3845 },// Daejeon
      { lat: 33.4996, lng: 126.5312 },// Jeju
      { lat: 39.3434, lng: 117.3616 },// Tianjin
      { lat: 30.5928, lng: 114.3055 },// Wuhan
      { lat: 32.0603, lng: 118.7969 },// Nanjing
      { lat: 30.2741, lng: 120.1551 },// Hangzhou
      { lat: 31.2989, lng: 120.5853 },// Suzhou
      { lat: 36.0671, lng: 120.3826 },// Qingdao
      { lat: 38.9140, lng: 121.6147 },// Dalian
      { lat: 24.4798, lng: 118.0894 },// Xiamen
      { lat: 45.8038, lng: 126.5350 },// Harbin
      { lat: 34.3416, lng: 108.9398 },// Xi'an
      { lat: 25.0389, lng: 102.7183 },// Kunming
      { lat: 29.6518, lng: 91.1721 }, // Lhasa
      { lat: 22.1987, lng: 113.5439 },// Macau
      { lat: 47.8864, lng: 106.9057 },// Ulaanbaatar
      { lat: 51.1605, lng: 71.4704 }, // Astana
      { lat: 39.6270, lng: 66.9750 }, // Samarkand
      { lat: 42.8746, lng: 74.5698 }, // Bishkek
      { lat: 38.5598, lng: 68.7870 }, // Dushanbe
      { lat: 37.9601, lng: 58.3261 }, // Ashgabat
      { lat: 28.2096, lng: 83.9856 }, // Pokhara
      { lat: 27.4728, lng: 89.6390 }, // Thimphu
      { lat: 22.3569, lng: 91.7832 }, // Chittagong
      { lat: 4.1755, lng: 73.5093 },  // Malé
      { lat: 16.8409, lng: 96.1735 }, // Yangon
      { lat: 21.9588, lng: 96.1511 }, // Mandalay
      { lat: 21.1717, lng: 94.8585 }, // Bagan
      { lat: 18.7883, lng: 98.9853 }, // Chiang Mai
      { lat: 7.8804, lng: 98.3923 },  // Phuket
      { lat: 17.9757, lng: 102.6331 },// Vientiane
      { lat: 19.8845, lng: 102.1346 },// Luang Prabang
      { lat: 11.5564, lng: 104.9282 },// Phnom Penh
      { lat: 16.0544, lng: 108.2022 },// Da Nang
      { lat: 15.8801, lng: 108.3380 },// Hoi An
      { lat: 16.4637, lng: 107.5909 },// Hue
      { lat: 5.4141, lng: 100.3288 }, // George Town, Penang
      { lat: 2.1896, lng: 102.2501 },// Malacca
      { lat: 5.9804, lng: 116.0735 },// Kota Kinabalu
      { lat: -6.9175, lng: 107.6191 },// Bandung
      { lat: -7.2575, lng: 112.7521 },// Surabaya
      { lat: -7.7956, lng: 110.3663 },// Yogyakarta
      { lat: 7.1907, lng: 125.4553 },// Davao
      { lat: 11.9674, lng: 121.9248 },// Boracay
      { lat: 9.7392, lng: 118.7353 },// Puerto Princesa
      { lat: 25.2854, lng: 51.5310 },// Doha
      { lat: 23.5880, lng: 58.3829 },// Muscat
      { lat: 24.4539, lng: 54.3773 },// Abu Dhabi
      { lat: 29.3759, lng: 47.9774 },// Kuwait City
      { lat: 26.2285, lng: 50.5860 },// Manama
      { lat: 31.9454, lng: 35.9284 },// Amman
      { lat: 33.8938, lng: 35.5018 },// Beirut
      { lat: 38.6431, lng: 34.8289 },// Cappadocia (Göreme)
      { lat: 34.5553, lng: 69.2075 },// Kabul
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
      { lat: 48.8530, lng: 2.3499 },    // Notre-Dame, Paris
      { lat: 48.8606, lng: 2.3376 },    // Louvre, Paris
      { lat: 48.8738, lng: 2.2950 },    // Arc de Triomphe, Paris
      { lat: 48.8014, lng: 2.1307 },    // Palace of Versailles
      { lat: 48.8867, lng: 2.3430 },    // Sacré-Cœur, Paris
      { lat: 51.5081, lng: -0.0759 },   // Tower of London
      { lat: 51.5014, lng: -0.1419 },   // Buckingham Palace
      { lat: 51.4994, lng: -0.1275 },   // Westminster Abbey
      { lat: 51.5033, lng: -0.1196 },   // London Eye
      { lat: 52.9719, lng: -9.4265 },   // Cliffs of Moher
      { lat: 41.9022, lng: 12.4534 },   // St Peter's Basilica (Vatican)
      { lat: 41.9009, lng: 12.4833 },   // Trevi Fountain, Rome
      { lat: 41.8986, lng: 12.4769 },   // Pantheon, Rome
      { lat: 40.7497, lng: 14.4869 },   // Pompeii
      { lat: 44.1461, lng: 9.6439 },    // Cinque Terre
      { lat: 45.4341, lng: 12.3388 },   // St Mark's Square, Venice
      { lat: 45.4647, lng: 9.1914 },    // Milan Duomo
      { lat: 37.1760, lng: -3.5889 },   // Alhambra, Granada
      { lat: 41.4145, lng: 2.1527 },    // Park Güell, Barcelona
      { lat: 50.9413, lng: 6.9583 },    // Cologne Cathedral
      { lat: 51.8842, lng: 4.7885 },    // Kinderdijk windmills
      { lat: 50.0865, lng: 14.4114 },   // Charles Bridge, Prague
      { lat: 48.1559, lng: 16.3115 },   // Schönbrunn Palace, Vienna
      { lat: 39.7217, lng: 21.6304 },   // Meteora
      { lat: 41.0036, lng: 28.9177 },   // Blue Mosque, Istanbul
      { lat: 37.9203, lng: 29.1207 },   // Pamukkale
      { lat: 37.9395, lng: 27.3417 },   // Ephesus
      { lat: 39.9163, lng: 116.3972 }, // Forbidden City, Beijing
      { lat: 39.8822, lng: 116.4066 }, // Temple of Heaven, Beijing
      { lat: 34.3848, lng: 109.2734 }, // Terracotta Army, Xi'an
      { lat: 29.6557, lng: 91.1173 },   // Potala Palace, Lhasa
      { lat: 30.2419, lng: 120.1487 }, // West Lake, Hangzhou
      { lat: 29.3252, lng: 110.4344 }, // Zhangjiajie
      { lat: 37.5796, lng: 126.9770 }, // Gyeongbokgung, Seoul
      { lat: 35.7148, lng: 139.7967 }, // Sensō-ji, Tokyo
      { lat: 34.2950, lng: 132.3175 }, // Itsukushima floating torii
      { lat: 34.8394, lng: 134.6956 }, // Himeji Castle
      { lat: 34.9949, lng: 135.7850 }, // Kiyomizu-dera, Kyoto
      { lat: -7.6079, lng: 110.2038 }, // Borobudur
      { lat: 16.7970, lng: 96.1600 },  // Shwedagon Pagoda, Yangon
      { lat: 13.7500, lng: 100.4913 }, // Grand Palace, Bangkok
      { lat: 3.1579, lng: 101.7116 },  // Petronas Towers, KL
      { lat: 3.2379, lng: 101.6959 },  // Batu Caves, KL
      { lat: 1.2816, lng: 103.8636 },  // Gardens by the Bay, Singapore
      { lat: -33.8523, lng: 151.2110 },// Sydney Harbour Bridge
      { lat: -16.9203, lng: 145.7710 },// Great Barrier Reef (Cairns)
      { lat: -44.6367, lng: 167.8970 },// Milford Sound
      { lat: 44.4280, lng: -110.5885 },// Yellowstone
      { lat: 37.8651, lng: -119.5383 },// Yosemite Valley
      { lat: 37.2982, lng: -113.0263 },// Zion
      { lat: 37.5930, lng: -112.1870 },// Bryce Canyon
      { lat: 36.9982, lng: -110.1866 },// Monument Valley
      { lat: 39.0968, lng: -120.0324 },// Lake Tahoe
      { lat: 51.4254, lng: -116.1773 },// Lake Louise (Banff)
      { lat: 46.8120, lng: -71.2030 }, // Château Frontenac, Québec
      { lat: -25.6953, lng: -54.4367 },// Iguazu Falls
      { lat: -22.9486, lng: -43.1566 },// Sugarloaf, Rio
      { lat: 19.6925, lng: -98.8438 }, // Teotihuacán pyramids
      { lat: 17.2220, lng: -89.6240 }, // Tikal
      { lat: 10.4236, lng: -75.5378 }, // Cartagena old town
      { lat: 25.6995, lng: 32.6391 },  // Luxor Temple
      { lat: 22.3370, lng: 31.6258 },  // Abu Simbel
      { lat: -3.0674, lng: 37.3556 }, // Mt Kilimanjaro (Moshi)
      { lat: -6.1659, lng: 39.2026 },  // Stone Town, Zanzibar
      { lat: 31.7767, lng: 35.2297 }, // Western Wall, Jerusalem
      { lat: 29.5765, lng: 35.4206 }, // Wadi Rum
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