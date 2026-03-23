/* ==========================================================================
   CLIMA & FUSO — app.js
   State management, OpenWeatherMap API, rendering, animations, URL sync
   ========================================================================== */

(function () {
  'use strict';

  /* ====================================================================
     0. API CONFIGURATION
     ==================================================================== */
  const API_KEY  = '5ac7f6edd7d8a2c9c707573e5fa1f8c1';
  const API_BASE = 'https://api.openweathermap.org/data/2.5';

  // Simple in-memory cache: { 'CityName': { data, ts } }
  const apiCache = {};
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /* ====================================================================
     1. CITY REGISTRY (timezone data stays local; weather from API)
     ==================================================================== */
  const cityRegistry = {
    'São Paulo':       { timezone: 'America/Sao_Paulo',                utcOffset: -3,   tzAbbrev: 'BRT',  apiName: 'São Paulo,BR' },
    'Rio de Janeiro':  { timezone: 'America/Sao_Paulo',                utcOffset: -3,   tzAbbrev: 'BRT',  apiName: 'Rio de Janeiro,BR' },
    'Tokyo':           { timezone: 'Asia/Tokyo',                       utcOffset: 9,    tzAbbrev: 'JST',  apiName: 'Tokyo,JP' },
    'New York':        { timezone: 'America/New_York',                 utcOffset: -5,   tzAbbrev: 'EST',  apiName: 'New York,US' },
    'Londres':         { timezone: 'Europe/London',                    utcOffset: 0,    tzAbbrev: 'GMT',  apiName: 'London,GB' },
    'Paris':           { timezone: 'Europe/Paris',                     utcOffset: 1,    tzAbbrev: 'CET',  apiName: 'Paris,FR' },
    'Lisboa':          { timezone: 'Europe/Lisbon',                    utcOffset: 0,    tzAbbrev: 'WET',  apiName: 'Lisbon,PT' },
    'Madrid':          { timezone: 'Europe/Madrid',                    utcOffset: 1,    tzAbbrev: 'CET',  apiName: 'Madrid,ES' },
    'Berlin':          { timezone: 'Europe/Berlin',                    utcOffset: 1,    tzAbbrev: 'CET',  apiName: 'Berlin,DE' },
    'Dubai':           { timezone: 'Asia/Dubai',                       utcOffset: 4,    tzAbbrev: 'GST',  apiName: 'Dubai,AE' },
    'Sydney':          { timezone: 'Australia/Sydney',                 utcOffset: 11,   tzAbbrev: 'AEDT', apiName: 'Sydney,AU' },
    'Los Angeles':     { timezone: 'America/Los_Angeles',              utcOffset: -8,   tzAbbrev: 'PST',  apiName: 'Los Angeles,US' },
    'Buenos Aires':    { timezone: 'America/Argentina/Buenos_Aires',   utcOffset: -3,   tzAbbrev: 'ART',  apiName: 'Buenos Aires,AR' },
    'Santiago':        { timezone: 'America/Santiago',                 utcOffset: -3,   tzAbbrev: 'CLT',  apiName: 'Santiago,CL' },
    'Cidade do México':{ timezone: 'America/Mexico_City',              utcOffset: -6,   tzAbbrev: 'CST',  apiName: 'Mexico City,MX' },
    'Moscou':          { timezone: 'Europe/Moscow',                    utcOffset: 3,    tzAbbrev: 'MSK',  apiName: 'Moscow,RU' },
    'Seul':            { timezone: 'Asia/Seoul',                       utcOffset: 9,    tzAbbrev: 'KST',  apiName: 'Seoul,KR' },
    'Mumbai':          { timezone: 'Asia/Kolkata',                     utcOffset: 5.5,  tzAbbrev: 'IST',  apiName: 'Mumbai,IN' },
    'Cairo':           { timezone: 'Africa/Cairo',                     utcOffset: 2,    tzAbbrev: 'EET',  apiName: 'Cairo,EG' },
    'Toronto':         { timezone: 'America/Toronto',                  utcOffset: -5,   tzAbbrev: 'EST',  apiName: 'Toronto,CA' }
  };

  function getCityNames() {
    return Object.keys(cityRegistry);
  }

  function getCityMeta(name) {
    const meta = cityRegistry[name];
    if (!meta) return null;
    return Object.assign({}, meta); // shallow clone
  }

  /* ====================================================================
     2. API PROVIDER — OpenWeatherMap integration
     ==================================================================== */
  const apiProvider = {

    /** Map OWM weather ID → our condition key */
    mapCondition(id) {
      if (id >= 200 && id < 600) return 'rain';        // Thunderstorm, Drizzle, Rain
      if (id >= 600 && id < 700) return 'cloudy';      // Snow
      if (id >= 700 && id < 800) return 'cloudy';      // Atmosphere (fog, mist…)
      if (id === 800)             return 'clear';        // Clear sky
      if (id === 801 || id === 802) return 'partly_cloudy';
      if (id >= 803)              return 'cloudy';      // Broken / overcast
      return 'partly_cloudy';
    },

    /** Fetch current weather from OWM */
    async fetchCurrent(apiName) {
      const url = API_BASE + '/weather?q=' + encodeURIComponent(apiName) +
                  '&appid=' + API_KEY + '&units=metric&lang=pt_br';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Weather fetch failed (' + res.status + ')');
      return res.json();
    },

    /** Fetch 5-day / 3-hour forecast from OWM */
    async fetchForecast(apiName) {
      const url = API_BASE + '/forecast?q=' + encodeURIComponent(apiName) +
                  '&appid=' + API_KEY + '&units=metric&cnt=16';
      // cnt=16 → 16 × 3h = 48h ahead (enough for today + tomorrow)
      const res = await fetch(url);
      if (!res.ok) throw new Error('Forecast fetch failed (' + res.status + ')');
      return res.json();
    },

    /** Extract today + tomorrow min/max from forecast list */
    parseForecast(list) {
      const now   = new Date();
      const todayStr    = now.toISOString().slice(0, 10);
      const tmrDate     = new Date(now); tmrDate.setDate(tmrDate.getDate() + 1);
      const tmrStr      = tmrDate.toISOString().slice(0, 10);

      const todayEntries    = list.filter(e => e.dt_txt.startsWith(todayStr));
      const tmrEntries      = list.filter(e => e.dt_txt.startsWith(tmrStr));

      // Fallback: if todayEntries is empty (late in the day), use first 8 intervals
      const todaySrc  = todayEntries.length  ? todayEntries  : list.slice(0, 8);
      const tmrSrc    = tmrEntries.length    ? tmrEntries    : list.slice(8, 16);

      const minMax = (entries) => ({
        min: Math.round(Math.min(...entries.map(e => e.main.temp_min))),
        max: Math.round(Math.max(...entries.map(e => e.main.temp_max)))
      });

      return {
        today:    minMax(todaySrc),
        tomorrow: minMax(tmrSrc.length ? tmrSrc : todaySrc)
      };
    },

    /** Full weather data for a city (with cache) */
    async getWeatherData(cityName) {
      const meta = getCityMeta(cityName);
      if (!meta) return null;

      // Serve from cache if fresh
      const cached = apiCache[cityName];
      if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
      }

      // Fetch both endpoints in parallel
      const [currentRaw, forecastRaw] = await Promise.all([
        this.fetchCurrent(meta.apiName),
        this.fetchForecast(meta.apiName)
      ]);

      const condition = this.mapCondition(currentRaw.weather[0].id);
      const forecast  = this.parseForecast(forecastRaw.list);

      const data = {
        timezone: meta.timezone,
        utcOffset: meta.utcOffset,
        tzAbbrev: meta.tzAbbrev,
        weather: {
          temp:      Math.round(currentRaw.main.temp),
          feelsLike: Math.round(currentRaw.main.feels_like),
          humidity:  Math.round(currentRaw.main.humidity),
          wind:      Math.round(currentRaw.wind.speed * 3.6),   // m/s → km/h
          condition
        },
        forecast: {
          todayMin:    forecast.today.min,
          todayMax:    forecast.today.max,
          tomorrowMin: forecast.tomorrow.min,
          tomorrowMax: forecast.tomorrow.max
        }
      };

      // Store in cache
      apiCache[cityName] = { data, ts: Date.now() };
      return data;
    }
  };

  /* ====================================================================
     3. FALLBACK MOCK (used while loading or on API error)
     ==================================================================== */
  const fallbackData = {
    'São Paulo':        { weather: { temp: 27, feelsLike: 29, humidity: 65, wind: 12, condition: 'partly_cloudy' }, forecast: { todayMin: 22, todayMax: 30, tomorrowMin: 20, tomorrowMax: 28 } },
    'Rio de Janeiro':   { weather: { temp: 31, feelsLike: 34, humidity: 72, wind: 15, condition: 'clear'         }, forecast: { todayMin: 25, todayMax: 33, tomorrowMin: 24, tomorrowMax: 32 } },
    'Tokyo':            { weather: { temp: 18, feelsLike: 16, humidity: 45, wind:  8, condition: 'clear'         }, forecast: { todayMin: 14, todayMax: 20, tomorrowMin: 13, tomorrowMax: 19 } },
    'New York':         { weather: { temp:  8, feelsLike:  5, humidity: 55, wind: 20, condition: 'cloudy'        }, forecast: { todayMin:  3, todayMax: 10, tomorrowMin:  4, tomorrowMax: 12 } },
    'Londres':          { weather: { temp: 12, feelsLike: 10, humidity: 78, wind: 18, condition: 'rain'          }, forecast: { todayMin:  8, todayMax: 13, tomorrowMin:  7, tomorrowMax: 11 } },
    'Paris':            { weather: { temp: 14, feelsLike: 12, humidity: 68, wind: 14, condition: 'cloudy'        }, forecast: { todayMin:  9, todayMax: 16, tomorrowMin: 10, tomorrowMax: 17 } },
    'Lisboa':           { weather: { temp: 19, feelsLike: 18, humidity: 58, wind: 10, condition: 'partly_cloudy' }, forecast: { todayMin: 14, todayMax: 21, tomorrowMin: 13, tomorrowMax: 20 } },
    'Madrid':           { weather: { temp: 22, feelsLike: 21, humidity: 40, wind:  9, condition: 'clear'         }, forecast: { todayMin: 15, todayMax: 24, tomorrowMin: 14, tomorrowMax: 23 } },
    'Berlin':           { weather: { temp:  7, feelsLike:  4, humidity: 70, wind: 22, condition: 'rain'          }, forecast: { todayMin:  3, todayMax:  9, tomorrowMin:  2, tomorrowMax:  8 } },
    'Dubai':            { weather: { temp: 35, feelsLike: 38, humidity: 30, wind: 11, condition: 'clear'         }, forecast: { todayMin: 28, todayMax: 38, tomorrowMin: 27, tomorrowMax: 37 } },
    'Sydney':           { weather: { temp: 24, feelsLike: 25, humidity: 62, wind: 16, condition: 'partly_cloudy' }, forecast: { todayMin: 19, todayMax: 26, tomorrowMin: 18, tomorrowMax: 25 } },
    'Los Angeles':      { weather: { temp: 22, feelsLike: 21, humidity: 35, wind:  7, condition: 'clear'         }, forecast: { todayMin: 16, todayMax: 25, tomorrowMin: 15, tomorrowMax: 24 } },
    'Buenos Aires':     { weather: { temp: 26, feelsLike: 28, humidity: 60, wind: 13, condition: 'partly_cloudy' }, forecast: { todayMin: 20, todayMax: 28, tomorrowMin: 19, tomorrowMax: 27 } },
    'Santiago':         { weather: { temp: 23, feelsLike: 22, humidity: 42, wind: 10, condition: 'clear'         }, forecast: { todayMin: 15, todayMax: 25, tomorrowMin: 14, tomorrowMax: 24 } },
    'Cidade do México': { weather: { temp: 20, feelsLike: 19, humidity: 50, wind:  8, condition: 'partly_cloudy' }, forecast: { todayMin: 12, todayMax: 22, tomorrowMin: 11, tomorrowMax: 21 } },
    'Moscou':           { weather: { temp: -2, feelsLike: -7, humidity: 80, wind: 25, condition: 'cloudy'        }, forecast: { todayMin: -5, todayMax:  0, tomorrowMin: -6, tomorrowMax:  1 } },
    'Seul':             { weather: { temp: 10, feelsLike:  7, humidity: 50, wind: 14, condition: 'cloudy'        }, forecast: { todayMin:  5, todayMax: 12, tomorrowMin:  4, tomorrowMax: 13 } },
    'Mumbai':           { weather: { temp: 33, feelsLike: 37, humidity: 75, wind: 12, condition: 'partly_cloudy' }, forecast: { todayMin: 27, todayMax: 35, tomorrowMin: 26, tomorrowMax: 34 } },
    'Cairo':            { weather: { temp: 28, feelsLike: 27, humidity: 25, wind: 15, condition: 'clear'         }, forecast: { todayMin: 18, todayMax: 30, tomorrowMin: 17, tomorrowMax: 29 } },
    'Toronto':          { weather: { temp:  5, feelsLike:  1, humidity: 60, wind: 19, condition: 'rain'          }, forecast: { todayMin:  1, todayMax:  7, tomorrowMin:  0, tomorrowMax:  6 } }
  };

  function getFallback(name) {
    const meta = getCityMeta(name);
    const fb   = fallbackData[name] || fallbackData['São Paulo'];
    return Object.assign({}, meta, { weather: { ...fb.weather }, forecast: { ...fb.forecast } });
  }

  /* ====================================================================
     4. WEATHER ICONS (SVG strings)
     ==================================================================== */
  const weatherIcons = {
    clear: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="22" fill="#FBBF24" opacity="0.9"/>
      <circle cx="50" cy="50" r="22" stroke="#FCD34D" stroke-width="2"/>
      <g stroke="#FBBF24" stroke-width="3" stroke-linecap="round" opacity="0.7">
        <line x1="50" y1="10" x2="50" y2="20"/>
        <line x1="50" y1="80" x2="50" y2="90"/>
        <line x1="10" y1="50" x2="20" y2="50"/>
        <line x1="80" y1="50" x2="90" y2="50"/>
        <line x1="21.7" y1="21.7" x2="28.8" y2="28.8"/>
        <line x1="71.2" y1="71.2" x2="78.3" y2="78.3"/>
        <line x1="78.3" y1="21.7" x2="71.2" y2="28.8"/>
        <line x1="28.8" y1="71.2" x2="21.7" y2="78.3"/>
      </g>
    </svg>`,

    partly_cloudy: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="62" cy="35" r="16" fill="#FBBF24" opacity="0.85"/>
      <g stroke="#FBBF24" stroke-width="2.5" stroke-linecap="round" opacity="0.55">
        <line x1="62" y1="8"  x2="62" y2="14"/>
        <line x1="62" y1="56" x2="62" y2="62"/>
        <line x1="35" y1="35" x2="41" y2="35"/>
        <line x1="83" y1="35" x2="89" y2="35"/>
      </g>
      <path d="M25 72 C25 58 35 50 48 50 C52 42 62 38 72 42 C82 38 88 48 86 58 C92 60 94 68 88 72 Z"
            fill="rgba(148,192,255,0.55)" stroke="rgba(74,124,240,0.40)" stroke-width="1.5"/>
    </svg>`,

    cloudy: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 70 C20 54 32 46 46 46 C50 36 62 32 74 36 C84 32 92 42 90 54 C96 56 98 66 92 70 Z"
            fill="rgba(148,192,255,0.48)" stroke="rgba(74,124,240,0.35)" stroke-width="1.5"/>
      <path d="M30 80 C30 66 40 60 52 60 C56 52 65 48 74 52 C82 48 88 56 86 66 C92 68 94 76 88 80 Z"
            fill="rgba(148,192,255,0.62)" stroke="rgba(74,124,240,0.45)" stroke-width="1.5"/>
    </svg>`,

    rain: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22 56 C22 42 33 35 45 35 C49 26 60 22 70 26 C80 22 87 31 85 42 C91 44 93 52 87 56 Z"
            fill="rgba(148,192,255,0.48)" stroke="rgba(74,124,240,0.35)" stroke-width="1.5"/>
      <g stroke="#4a7cf0" stroke-width="2" stroke-linecap="round" opacity="0.75">
        <line x1="35" y1="64" x2="31" y2="78"/>
        <line x1="50" y1="64" x2="46" y2="82"/>
        <line x1="65" y1="64" x2="61" y2="76"/>
        <line x1="42" y1="70" x2="38" y2="84"/>
        <line x1="58" y1="68" x2="54" y2="80"/>
      </g>
    </svg>`
  };

  /** Map OWM description → PT-BR label */
  const conditionNames = {
    clear:         'Céu limpo',
    partly_cloudy: 'Parcialmente nublado',
    cloudy:        'Nublado',
    rain:          'Chuva'
  };

  /* ====================================================================
     5. APPLICATION STATE
     ==================================================================== */
  const state = {
    origin:          'São Paulo',
    destination:     'Tokyo',
    originData:      null,
    destData:        null,
    timeMode:        'now',
    customTime:      '14:00',
    sliderHour:      14,
    theme:           'aurora',
    mode:            'auto',
    lastUpdateTime:  Date.now(),
    updateInterval:  null,
    isSwapping:      false,
    isFetching:      false
  };

  /* ====================================================================
     6. DOM REFERENCES
     ==================================================================== */
  const dom = {};

  function cacheDom() {
    dom.statusText          = document.getElementById('statusText');
    dom.themeToggle         = document.getElementById('themeToggle');
    dom.originCity          = document.getElementById('originCity');
    dom.originTemp          = document.getElementById('originTemp');
    dom.originIcon          = document.getElementById('originIcon');
    dom.originCondition     = document.getElementById('originCondition');
    dom.originFeels         = document.getElementById('originFeels');
    dom.originHumidity      = document.getElementById('originHumidity');
    dom.originWind          = document.getElementById('originWind');
    dom.originTodayMin      = document.getElementById('originTodayMin');
    dom.originTodayMax      = document.getElementById('originTodayMax');
    dom.originTomorrowMin   = document.getElementById('originTomorrowMin');
    dom.originTomorrowMax   = document.getElementById('originTomorrowMax');
    dom.destCity            = document.getElementById('destCity');
    dom.destTemp            = document.getElementById('destTemp');
    dom.destIcon            = document.getElementById('destIcon');
    dom.destCondition       = document.getElementById('destCondition');
    dom.destFeels           = document.getElementById('destFeels');
    dom.destHumidity        = document.getElementById('destHumidity');
    dom.destWind            = document.getElementById('destWind');
    dom.destTodayMin        = document.getElementById('destTodayMin');
    dom.destTodayMax        = document.getElementById('destTodayMax');
    dom.destTomorrowMin     = document.getElementById('destTomorrowMin');
    dom.destTomorrowMax     = document.getElementById('destTomorrowMax');
    dom.converterOriginInput= document.getElementById('converterOriginInput');
    dom.converterDestInput  = document.getElementById('converterDestInput');
    dom.autocompleteOrigin  = document.getElementById('autocompleteOrigin');
    dom.autocompleteDest    = document.getElementById('autocompleteDest');
    dom.originTimeInput     = document.getElementById('originTimeInput');
    dom.originDisplayTime   = document.getElementById('originDisplayTime');
    dom.originDisplayTz     = document.getElementById('originDisplayTz');
    dom.destDisplayTime     = document.getElementById('destDisplayTime');
    dom.destDisplayTz       = document.getElementById('destDisplayTz');
    dom.diffBadge           = document.getElementById('diffBadge');
    dom.swapBtn             = document.getElementById('swapBtn');
    dom.timelineSlider      = document.getElementById('timelineSlider');
    dom.timelineDesc        = document.getElementById('timelineDesc');
    dom.timelineTicks       = document.getElementById('timelineTicks');
    dom.copyLinkBtn         = document.getElementById('copyLinkBtn');
    dom.toastContainer      = document.getElementById('toastContainer');
    dom.skeletonOverlay     = document.getElementById('skeletonOverlay');
  }

  /* ====================================================================
     7. RENDER FUNCTIONS
     ==================================================================== */
  const render = {
    weatherCard(side) {
      const isOrigin = side === 'origin';
      const data     = isOrigin ? state.originData : state.destData;
      const city     = isOrigin ? state.origin     : state.destination;
      if (!data) return;

      const prefix = isOrigin ? 'origin' : 'dest';
      const w = data.weather;
      const f = data.forecast;

      dom[prefix + 'City'].textContent = city;
      animations.countUp(dom[prefix + 'Temp'], w.temp);

      const iconContainer = dom[prefix + 'Icon'];
      iconContainer.innerHTML = weatherIcons[w.condition] || weatherIcons.clear;
      iconContainer.classList.remove('icon-slide-in');
      void iconContainer.offsetWidth;
      iconContainer.classList.add('icon-slide-in');

      dom[prefix + 'Condition'].textContent = conditionNames[w.condition] || w.condition;
      dom[prefix + 'Feels'].textContent     = w.feelsLike + '°';
      dom[prefix + 'Humidity'].textContent  = w.humidity  + '%';
      dom[prefix + 'Wind'].textContent      = w.wind      + ' km/h';
      dom[prefix + 'TodayMin'].textContent  = f.todayMin  + '°';
      dom[prefix + 'TodayMax'].textContent  = f.todayMax  + '°';
      dom[prefix + 'TomorrowMin'].textContent = f.tomorrowMin + '°';
      dom[prefix + 'TomorrowMax'].textContent = f.tomorrowMax + '°';
    },

    converter() {
      const originData = state.originData;
      const destData   = state.destData;
      if (!originData || !destData) return;

      dom.converterOriginInput.value = state.origin;
      dom.converterDestInput.value   = state.destination;

      let originHour, originMinute;
      if (state.timeMode === 'now') {
        const now = new Date();
        try {
          const formatter = new Intl.DateTimeFormat('pt-BR', {
            timeZone: originData.timezone, hour: '2-digit', minute: '2-digit', hour12: false
          });
          const parts = formatter.formatToParts(now);
          originHour   = parseInt(parts.find(p => p.type === 'hour').value,   10);
          originMinute = parseInt(parts.find(p => p.type === 'minute').value, 10);
        } catch (_e) {
          const utcMs    = now.getTime() + now.getTimezoneOffset() * 60000;
          const originMs = utcMs + originData.utcOffset * 3600000;
          const d        = new Date(originMs);
          originHour   = d.getHours();
          originMinute = d.getMinutes();
        }
      } else {
        const parts  = state.customTime.split(':');
        originHour   = parseInt(parts[0], 10) || 0;
        originMinute = parseInt(parts[1], 10) || 0;
      }

      const diffHours        = destData.utcOffset - originData.utcOffset;
      let destTotalMinutes   = originHour * 60 + originMinute + diffHours * 60;
      if (destTotalMinutes >= 1440)  destTotalMinutes -= 1440;
      else if (destTotalMinutes < 0) destTotalMinutes += 1440;

      const destHour   = Math.floor(destTotalMinutes / 60);
      const destMinute = destTotalMinutes % 60;
      const pad        = (n) => String(n).padStart(2, '0');

      dom.originDisplayTime.textContent = pad(originHour)   + ':' + pad(originMinute);
      dom.destDisplayTime.textContent   = pad(destHour)     + ':' + pad(destMinute);
      dom.originDisplayTz.textContent   = originData.tzAbbrev + ' (UTC' + formatOffset(originData.utcOffset) + ')';
      dom.destDisplayTz.textContent     = destData.tzAbbrev   + ' (UTC' + formatOffset(destData.utcOffset)   + ')';

      const sign       = diffHours >= 0 ? '+' : '';
      const diffDisplay= Number.isInteger(diffHours) ? diffHours + 'h' : diffHours.toFixed(1) + 'h';
      dom.diffBadge.textContent = sign + diffDisplay;

      if (state.timeMode === 'now') {
        state.sliderHour = originHour;
        dom.timelineSlider.value = originHour;
        dom.timelineSlider.setAttribute('aria-valuenow', originHour);
      }

      render.timelineDesc(originHour, originMinute, diffHours);
    },

    timelineDesc(originHour, _originMinute, diffHours) {
      const pad    = (n) => String(n).padStart(2, '0');
      const oH     = originHour !== undefined ? originHour : state.sliderHour;
      let   dTotal = oH * 60 + diffHours * 60;
      let   dH     = Math.floor(dTotal / 60);
      let   dayStr = '';
      if (dH >= 24)  { dH -= 24; dayStr = ' (+1 dia)'; }
      else if (dH < 0) { dH += 24; dayStr = ' (-1 dia)'; }

      dom.timelineDesc.innerHTML =
        'Se em <strong>' + state.origin + '</strong> for <strong>' + pad(oH) + ':00</strong>, em <strong>' +
        state.destination + '</strong> será <strong>' + pad(dH) + ':00' + dayStr + '</strong>';
    },

    background() {
      const originData = state.originData;
      if (!originData) return;

      document.documentElement.setAttribute('data-condition', originData.weather.condition);

      if (state.mode === 'auto') {
        let hour;
        try {
          const now       = new Date();
          const formatter = new Intl.DateTimeFormat('pt-BR', {
            timeZone: originData.timezone, hour: '2-digit', hour12: false
          });
          const parts = formatter.formatToParts(now);
          hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
        } catch (_e) {
          const now      = new Date();
          const utcMs    = now.getTime() + now.getTimezoneOffset() * 60000;
          const originMs = utcMs + originData.utcOffset * 3600000;
          hour = new Date(originMs).getHours();
        }
        document.documentElement.setAttribute('data-mode', (hour >= 6 && hour < 18) ? 'day' : 'night');
      }
    },

    statusChip() {
      const elapsed = Math.floor((Date.now() - state.lastUpdateTime) / 1000);
      if (elapsed < 5)      dom.statusText.textContent = 'Atualizado agora';
      else if (elapsed < 60) dom.statusText.textContent = 'Atualizado há ' + elapsed + 's';
      else                  dom.statusText.textContent = 'Atualizado há ' + Math.floor(elapsed / 60) + ' min';
    },

    all() {
      render.weatherCard('origin');
      render.weatherCard('dest');
      render.converter();
      render.background();
      render.statusChip();
    }
  };

  /* ====================================================================
     8. ANIMATIONS
     ==================================================================== */
  const animations = {
    countUp(el, target) {
      const current = parseInt(el.textContent, 10);
      if (isNaN(current) || current === target) { el.textContent = target; return; }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = target; return; }

      const diff     = target - current;
      const steps    = Math.min(Math.abs(diff), 15);
      const stepTime = 400 / steps;
      let   step     = 0;

      el.classList.add('temp-flash');
      const interval = setInterval(() => {
        step++;
        el.textContent = Math.round(current + diff * (step / steps));
        if (step >= steps) {
          clearInterval(interval);
          el.textContent = target;
          setTimeout(() => el.classList.remove('temp-flash'), 400);
        }
      }, stepTime);
    },

    showSkeleton(ms) {
      dom.skeletonOverlay.classList.add('active');
      dom.skeletonOverlay.setAttribute('aria-hidden', 'false');
      return new Promise(resolve => {
        setTimeout(() => {
          dom.skeletonOverlay.classList.remove('active');
          dom.skeletonOverlay.setAttribute('aria-hidden', 'true');
          resolve();
        }, ms || 600);
      });
    },

    async swapPanels() {
      if (state.isSwapping) return;
      state.isSwapping = true;

      const els = [
        document.getElementById('weatherOrigin'),
        document.getElementById('weatherDest'),
        ...document.querySelectorAll('.converter-panel')
      ];

      els.forEach(el => el.classList.add('swap-fade-out'));
      await new Promise(r => setTimeout(r, 260));

      const tempCity  = state.origin;      state.origin      = state.destination; state.destination = tempCity;
      const tempData  = state.originData;  state.originData  = state.destData;    state.destData    = tempData;

      render.all();
      urlSync.push();

      els.forEach(el => { el.classList.remove('swap-fade-out'); el.classList.add('swap-fade-in'); });
      await new Promise(r => setTimeout(r, 260));
      els.forEach(el => el.classList.remove('swap-fade-in'));
      state.isSwapping = false;
    }
  };

  /* ====================================================================
     9. URL SYNC
     ==================================================================== */
  const urlSync = {
    read() {
      const params = new URLSearchParams(window.location.search);
      const from   = params.get('from');
      const to     = params.get('to');
      if (from && cityRegistry[from]) state.origin      = from;
      if (to   && cityRegistry[to])   state.destination = to;
    },
    push() {
      const params = new URLSearchParams();
      params.set('from', state.origin);
      params.set('to',   state.destination);
      window.history.replaceState(null, '', window.location.pathname + '?' + params.toString());
    }
  };

  /* ====================================================================
     10. AUTOCOMPLETE
     ==================================================================== */
  const autocomplete = {
    activeDropdown: null,
    highlightIndex: -1,

    search(query) {
      if (!query) return [];
      const lower = query.toLowerCase();
      return getCityNames().filter(n => n.toLowerCase().includes(lower));
    },

    show(inputEl, dropdownEl, results, side) {
      dropdownEl.innerHTML   = '';
      this.highlightIndex    = -1;
      if (!results.length) { dropdownEl.classList.remove('active'); this.activeDropdown = null; return; }

      results.forEach((city, index) => {
        const meta = getCityMeta(city);
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.setAttribute('role', 'option');
        item.setAttribute('data-city', city);
        item.setAttribute('data-index', index);
        item.innerHTML = '<span>' + city + '</span><span class="autocomplete-item__tz">UTC' + formatOffset(meta.utcOffset) + '</span>';
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.select(city, side);
          dropdownEl.classList.remove('active');
          this.activeDropdown = null;
        });
        dropdownEl.appendChild(item);
      });

      dropdownEl.classList.add('active');
      this.activeDropdown = { inputEl, dropdownEl, results, side };
    },

    hide(dropdownEl) {
      dropdownEl.classList.remove('active');
      if (this.activeDropdown && this.activeDropdown.dropdownEl === dropdownEl) this.activeDropdown = null;
    },

    async select(city, side) {
      // Invalidate cache for fresh fetch
      delete apiCache[city];

      // Show skeleton during fetch
      animations.showSkeleton(0); // instant show

      try {
        const data = await apiProvider.getWeatherData(city);
        const cityData = Object.assign({}, getCityMeta(city), data);

        if (side === 'origin') {
          state.origin     = city;
          state.originData = cityData;
          dom.converterOriginInput.value = city;
        } else {
          state.destination = city;
          state.destData    = cityData;
          dom.converterDestInput.value = city;
        }

        state.lastUpdateTime = Date.now();
        render.all();
        urlSync.push();

      } catch (err) {
        // Fallback to mock on error
        console.warn('API error, usando fallback:', err);
        const cityData = getFallback(city);
        if (side === 'origin') {
          state.origin     = city;
          state.originData = cityData;
          dom.converterOriginInput.value = city;
        } else {
          state.destination = city;
          state.destData    = cityData;
          dom.converterDestInput.value = city;
        }
        state.lastUpdateTime = Date.now();
        render.all();
        urlSync.push();

      } finally {
        dom.skeletonOverlay.classList.remove('active');
        dom.skeletonOverlay.setAttribute('aria-hidden', 'true');
      }
    },

    navigate(direction, dropdownEl) {
      if (!this.activeDropdown) return;
      const items = dropdownEl.querySelectorAll('.autocomplete-item');
      if (!items.length) return;
      items.forEach(i => i.classList.remove('highlighted'));
      this.highlightIndex = direction === 'down'
        ? Math.min(this.highlightIndex + 1, items.length - 1)
        : Math.max(this.highlightIndex - 1, 0);
      items[this.highlightIndex].classList.add('highlighted');
      items[this.highlightIndex].scrollIntoView({ block: 'nearest' });
    },

    selectHighlighted(dropdownEl, side) {
      if (this.highlightIndex < 0 || !this.activeDropdown) return;
      const items = dropdownEl.querySelectorAll('.autocomplete-item');
      if (items[this.highlightIndex]) {
        this.select(items[this.highlightIndex].getAttribute('data-city'), side);
        this.hide(dropdownEl);
      }
    }
  };

  /* ====================================================================
     11. TOAST NOTIFICATIONS
     ==================================================================== */
  function showToast(message, type) {
    type = type || 'success';
    const toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    const iconSvg = type === 'success'
      ? '<svg class="toast__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
      : '<svg class="toast__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    toast.innerHTML = iconSvg + '<span>' + message + '</span>';
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast--exit');
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 3500);
  }

  /* ====================================================================
     12. UTILITY
     ==================================================================== */
  function formatOffset(offset) {
    if (offset === 0) return '+0';
    const sign = offset >= 0 ? '+' : '';
    if (Number.isInteger(offset)) return sign + offset;
    const h = Math.floor(Math.abs(offset));
    const m = Math.round((Math.abs(offset) - h) * 60);
    return (offset < 0 ? '-' : '+') + h + ':' + String(m).padStart(2, '0');
  }

  /* ====================================================================
     13. EVENT HANDLERS
     ==================================================================== */
  function bindEvents() {
    // Theme toggle
    dom.themeToggle.addEventListener('click', () => {
      state.theme = state.theme === 'aurora' ? 'nebula' : 'aurora';
      document.documentElement.setAttribute('data-theme', state.theme);
    });

    // Day/Night mode
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.getAttribute('data-mode');
        if (state.mode !== 'auto') document.documentElement.setAttribute('data-mode', state.mode);
        else render.background();
      });
    });

    // Swap
    dom.swapBtn.addEventListener('click', () => animations.swapPanels());

    // Time mode (Now / Custom)
    document.querySelectorAll('.time-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.time-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.timeMode = btn.getAttribute('data-time-mode');
        if (state.timeMode === 'now') {
          dom.originTimeInput.disabled = true;
        } else {
          dom.originTimeInput.disabled = false;
          dom.originTimeInput.value    = state.customTime;
          dom.originTimeInput.focus();
        }
        render.converter();
      });
    });

    // Custom time input
    dom.originTimeInput.addEventListener('input', () => {
      state.customTime = dom.originTimeInput.value;
      state.sliderHour = parseInt(state.customTime.split(':')[0], 10) || 0;
      dom.timelineSlider.value = state.sliderHour;
      dom.timelineSlider.setAttribute('aria-valuenow', state.sliderHour);
      render.converter();
    });

    // Timeline slider
    dom.timelineSlider.addEventListener('input', () => {
      state.sliderHour = parseInt(dom.timelineSlider.value, 10);
      dom.timelineSlider.setAttribute('aria-valuenow', state.sliderHour);
      if (state.timeMode === 'now') {
        state.timeMode = 'custom';
        document.querySelectorAll('.time-mode-btn').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-time-mode') === 'custom');
        });
        dom.originTimeInput.disabled = false;
      }
      const pad          = (n) => String(n).padStart(2, '0');
      state.customTime   = pad(state.sliderHour) + ':00';
      dom.originTimeInput.value = state.customTime;
      render.converter();
    });

    // Autocomplete — Origin
    dom.converterOriginInput.addEventListener('input', () => {
      autocomplete.show(dom.converterOriginInput, dom.autocompleteOrigin, autocomplete.search(dom.converterOriginInput.value.trim()), 'origin');
    });
    dom.converterOriginInput.addEventListener('focus', () => {
      if (dom.converterOriginInput.value.trim()) {
        autocomplete.show(dom.converterOriginInput, dom.autocompleteOrigin, autocomplete.search(dom.converterOriginInput.value.trim()), 'origin');
      }
    });
    dom.converterOriginInput.addEventListener('blur', () => setTimeout(() => autocomplete.hide(dom.autocompleteOrigin), 150));
    dom.converterOriginInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown')  { e.preventDefault(); autocomplete.navigate('down', dom.autocompleteOrigin); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); autocomplete.navigate('up',   dom.autocompleteOrigin); }
      else if (e.key === 'Enter')     { e.preventDefault(); autocomplete.selectHighlighted(dom.autocompleteOrigin, 'origin'); }
      else if (e.key === 'Escape')    { autocomplete.hide(dom.autocompleteOrigin); }
    });

    // Autocomplete — Destination
    dom.converterDestInput.addEventListener('input', () => {
      autocomplete.show(dom.converterDestInput, dom.autocompleteDest, autocomplete.search(dom.converterDestInput.value.trim()), 'dest');
    });
    dom.converterDestInput.addEventListener('focus', () => {
      if (dom.converterDestInput.value.trim()) {
        autocomplete.show(dom.converterDestInput, dom.autocompleteDest, autocomplete.search(dom.converterDestInput.value.trim()), 'dest');
      }
    });
    dom.converterDestInput.addEventListener('blur', () => setTimeout(() => autocomplete.hide(dom.autocompleteDest), 150));
    dom.converterDestInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown')  { e.preventDefault(); autocomplete.navigate('down', dom.autocompleteDest); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); autocomplete.navigate('up',   dom.autocompleteDest); }
      else if (e.key === 'Enter')     { e.preventDefault(); autocomplete.selectHighlighted(dom.autocompleteDest, 'dest'); }
      else if (e.key === 'Escape')    { autocomplete.hide(dom.autocompleteDest); }
    });

    // Close autocomplete on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.converter-city-wrap')) {
        autocomplete.hide(dom.autocompleteOrigin);
        autocomplete.hide(dom.autocompleteDest);
      }
    });

    // Copy link
    dom.copyLinkBtn.addEventListener('click', () => {
      urlSync.push();
      const url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url)
          .then(() => showToast('Link copiado!', 'success'))
          .catch(() => fallbackCopy(url));
      } else {
        fallbackCopy(url);
      }
    });
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('Link copiado!', 'success'); }
    catch (_) { showToast('Erro ao copiar link', 'error'); }
    document.body.removeChild(ta);
  }

  /* ====================================================================
     14. TIMELINE TICKS
     ==================================================================== */
  function generateTimelineTicks() {
    dom.timelineTicks.innerHTML = '';
    for (let i = 0; i <= 23; i++) {
      const tick = document.createElement('div');
      tick.className = 'timeline-tick' + (i % 6 === 0 ? ' major' : '');
      dom.timelineTicks.appendChild(tick);
    }
  }

  /* ====================================================================
     15. AUTO REFRESH — real API every 5 minutes
     ==================================================================== */
  function startAutoRefresh() {
    // Refresh weather every 5 minutes
    state.updateInterval = setInterval(async () => {
      if (state.isFetching) return;
      state.isFetching = true;
      try {
        // Invalidate cache so we always get fresh data
        delete apiCache[state.origin];
        delete apiCache[state.destination];

        const [origData, destData] = await Promise.all([
          apiProvider.getWeatherData(state.origin),
          apiProvider.getWeatherData(state.destination)
        ]);

        if (origData) state.originData = Object.assign({}, getCityMeta(state.origin), origData);
        if (destData) state.destData   = Object.assign({}, getCityMeta(state.destination), destData);

        state.lastUpdateTime = Date.now();
        render.all();
      } catch (err) {
        console.warn('Auto-refresh error:', err);
      } finally {
        state.isFetching = false;
      }
    }, 5 * 60 * 1000); // 5 min

    // Status chip ticks every second
    setInterval(() => render.statusChip(), 1000);
  }

  /* ====================================================================
     16. USER LOCATION DETECTION
     ==================================================================== */

  /** Retorna UTC offset em horas para um IANA timezone */
  function getUtcOffsetForTz(tz) {
    try {
      const now = new Date();
      const fmt = (zone) => new Intl.DateTimeFormat('en', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(now);
      const parse = (s) => {
        const [date, time] = s.split(', ');
        const [m, d, y]   = date.split('/');
        const [h, min]    = time.split(':');
        return new Date(Date.UTC(+y, +m - 1, +d, +h === 24 ? 0 : +h, +min));
      };
      return (parse(fmt(tz)) - parse(fmt('UTC'))) / 3600000;
    } catch (_) { return 0; }
  }

  /** Retorna abreviação de timezone para exibição (ex: BRT, GMT, JST) */
  function getTzAbbrev(tz) {
    try {
      return new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date())
        .find(p => p.type === 'timeZoneName')?.value || 'UTC';
    } catch (_) { return 'UTC'; }
  }

  async function detectUserLocation() {
    // Passo 1 — timezone do próprio browser (instantâneo, sem permissão)
    const userTz     = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const userOffset = getUtcOffsetForTz(userTz);
    const userAbbrev = getTzAbbrev(userTz);

    // Passo 2 — tenta casar com uma das cidades preset pelo timezone
    const presetMatch = Object.keys(cityRegistry).find(k => cityRegistry[k].timezone === userTz);
    if (presetMatch) {
      state.origin     = presetMatch;
      state.originData = getFallback(presetMatch);
      dom.converterOriginInput.value = presetMatch;
      render.all();
    }

    // Passo 3 — pede geolocalização para nome real da cidade + clima exato
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lon } }) => {
        try {
          const [curRes, fcastRes] = await Promise.all([
            fetch(`${API_BASE}/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=pt_br`),
            fetch(`${API_BASE}/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&cnt=16`)
          ]);
          if (!curRes.ok) return;

          const cur   = await curRes.json();
          const fcast = fcastRes.ok ? await fcastRes.json() : null;

          const cityName  = cur.name;
          const condition = apiProvider.mapCondition(cur.weather[0].id);
          const fc        = fcast
            ? apiProvider.parseForecast(fcast.list)
            : { today: { min: Math.round(cur.main.temp_min), max: Math.round(cur.main.temp_max) },
                tomorrow: { min: Math.round(cur.main.temp_min), max: Math.round(cur.main.temp_max) } };

          const locationData = {
            timezone:  userTz,
            utcOffset: userOffset,
            tzAbbrev:  userAbbrev,
            weather: {
              temp:      Math.round(cur.main.temp),
              feelsLike: Math.round(cur.main.feels_like),
              humidity:  cur.main.humidity,
              wind:      Math.round((cur.wind?.speed || 0) * 3.6),
              condition
            },
            forecast: {
              todayMin:    fc.today.min,
              todayMax:    fc.today.max,
              tomorrowMin: fc.tomorrow.min,
              tomorrowMax: fc.tomorrow.max
            }
          };

          // Registra a cidade dinamicamente para funcionar com autocomplete e cache
          if (!cityRegistry[cityName]) {
            cityRegistry[cityName] = {
              timezone:  userTz,
              utcOffset: userOffset,
              tzAbbrev:  userAbbrev,
              apiName:   `${cityName},${cur.sys.country}`
            };
          }
          apiCache[cityName] = { data: locationData, ts: Date.now() };

          state.origin     = cityName;
          state.originData = locationData;
          dom.converterOriginInput.value = cityName;
          render.all();
          urlSync.push();

        } catch (err) {
          console.warn('Geolocation weather fetch failed:', err);
        }
      },
      (err) => { console.warn('Geolocation denied:', err.message); },
      { timeout: 8000, maximumAge: 300000 } // cache de 5 min
    );
  }

  /* ====================================================================
     17. INITIALIZATION
     ==================================================================== */
  async function init() {
    cacheDom();
    urlSync.read();
    generateTimelineTicks();

    // Show fallback immediately so UI isn't empty
    state.originData = getFallback(state.origin);
    state.destData   = getFallback(state.destination);
    render.all();
    urlSync.push();
    bindEvents();

    // Detecta localização do usuário e define como origem
    detectUserLocation();

    // Fetch real data in background
    try {
      animations.showSkeleton(0);
      const [origData, destData] = await Promise.all([
        apiProvider.getWeatherData(state.origin),
        apiProvider.getWeatherData(state.destination)
      ]);

      if (origData) state.originData = Object.assign({}, getCityMeta(state.origin), origData);
      if (destData) state.destData   = Object.assign({}, getCityMeta(state.destination), destData);

      state.lastUpdateTime = Date.now();
      render.all();

    } catch (err) {
      console.warn('Init API error, using fallback data:', err);
    } finally {
      dom.skeletonOverlay.classList.remove('active');
      dom.skeletonOverlay.setAttribute('aria-hidden', 'true');
    }

    startAutoRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
