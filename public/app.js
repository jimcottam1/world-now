// World Now: front end. Loads the hourly data files and draws the world map, dots and country panel.
(function () {
    'use strict';

    const LAYERS = ['weather', 'airquality', 'earthquakes', 'events', 'webcams', 'aurora', 'rates', 'electricity', 'facts'];
    const data = {};
    let status = null;
    let countries = null;   // GeoJSON features
    let countryLayer = null;
    let selected = null;    // country id
    let view = 'temperature';
    const overlays = { quakes: true, events: true, webcams: false };
    const overlayLayers = {};

    // ---------- Helpers ----------

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = n => n == null ? '–' : Number(n).toLocaleString('en-IE');
    const props = id => countries?.find(f => f.properties.id === id)?.properties;
    const nameOf = id => props(id)?.name || id;
    const hoursOld = iso => (Date.now() - new Date(iso).getTime()) / 3600000;

    /** "1.4 billion", "68.7 million", "541,000" */
    function bigNumber(n) {
        if (n == null) return '–';
        if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} billion`;
        if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} million`;
        if (n >= 1e4) return `${fmt(Math.round(n / 1000) * 1000)}`;
        return fmt(Math.round(n));
    }
    const dollars = n => n == null ? '–' : '$' + fmt(Math.round(n));

    function ago(iso) {
        const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (!Number.isFinite(mins)) return '';
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins} min ago`;
        const hours = Math.round(mins / 60);
        return hours < 48 ? `${hours} hr ago` : `${Math.round(hours / 24)} days ago`;
    }

    /** A time in the reader's own time zone: "21:15 today", "yesterday 21:15", "Thu 5 Nov, 21:15". */
    function clock(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const day = x => x.toLocaleDateString('en-CA');
        const time = d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' });
        if (day(d) === day(new Date())) return `${time} today`;
        if (day(d) === day(new Date(Date.now() - 86400000))) return `yesterday ${time}`;
        return `${d.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
    }

    /** A time where the country is (its own time zone), e.g. "06:38". */
    function localTime(iso, w) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '–';
        try {
            if (w?.tz) return d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: w.tz });
        } catch { /* unknown zone: use the offset */ }
        const shifted = new Date(d.getTime() + (w?.offset || 0) * 1000);
        return shifted.toISOString().slice(11, 16);
    }
    function localNow(w) {
        const now = new Date();
        try {
            if (w?.tz) return now.toLocaleString('en-IE', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: w.tz });
        } catch { /* fall through */ }
        return localTime(now.toISOString(), w);
    }
    const utcOffset = s => {
        if (!Number.isFinite(s)) return '';
        const sign = s < 0 ? '−' : '+', a = Math.abs(s), h = Math.floor(a / 3600), m = Math.round((a % 3600) / 60);
        return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
    };

    /** Interpolate between colour stops: stops = [[value, '#rrggbb'], ...] */
    function ramp(stops, value) {
        if (value == null || Number.isNaN(value)) return null;
        if (value <= stops[0][0]) return stops[0][1];
        for (let i = 1; i < stops.length; i++) {
            if (value <= stops[i][0]) {
                const [v0, c0] = stops[i - 1];
                const [v1, c1] = stops[i];
                const t = (value - v0) / (v1 - v0);
                const a = c0.match(/\w\w/g).map(h => parseInt(h, 16));
                const b = c1.match(/\w\w/g).map(h => parseInt(h, 16));
                return '#' + a.map((x, k) => Math.round(x + (b[k] - x) * t).toString(16).padStart(2, '0')).join('');
            }
        }
        return stops[stops.length - 1][1];
    }

    // WMO weather codes (Open-Meteo) in plain words
    const WEATHER = {
        0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing fog',
        51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
        61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
        71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
        80: 'Light showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers',
        95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail'
    };
    const weatherText = code => WEATHER[code] || 'Weather not known';

    // US AQI bands
    const AQI_BANDS = [[50, 'Good'], [100, 'Moderate'], [150, 'Unhealthy for sensitive groups'], [200, 'Unhealthy'], [300, 'Very unhealthy'], [Infinity, 'Hazardous']];
    const aqiText = v => v == null ? 'No reading' : AQI_BANDS.find(([max]) => v <= max)[1];

    // ---------- Views: what colours the countries ----------

    const W = id => data.weather?.countries?.[id];
    const F = (id, key) => data.facts?.countries?.[id]?.[key]?.value;

    const VIEWS = {
        temperature: {
            label: 'Temperature', title: 'Temperature now at the capital',
            value: id => W(id)?.temp,
            stops: [[-30, '313695'], [-15, '4575b4'], [0, '74add1'], [10, 'c6e3ee'], [18, 'fee090'], [25, 'fdae61'], [32, 'f46d43'], [40, 'a50026']],
            ends: ['−30°C', '40°C'],
            describe: v => v == null ? 'No reading' : `${v.toFixed(1)}°C`
        },
        daynight: {
            label: 'Day or night', title: 'Day or night at the capital',
            value: id => W(id) ? W(id).isDay : null,
            colour: v => v == null ? '#d6dbd8' : v ? '#f5d76e' : '#2b3a67',
            legend: () => `<div class="legend-title">Day or night at the capital ${helpFor('daynight')}</div>
                <div class="legend-row"><span class="legend-swatch" style="background:#f5d76e"></span>Daytime</div>
                <div class="legend-row"><span class="legend-swatch" style="background:#2b3a67"></span>Night</div>`,
            describe: v => v == null ? 'No reading' : v ? 'Daytime' : 'Night'
        },
        air: {
            label: 'Air quality', title: 'Air quality index (US AQI), model estimate',
            value: id => data.airquality?.countries?.[id]?.aqi,
            stops: [[0, '1f8a5b'], [50, '9ccc65'], [100, 'f2c418'], [150, 'ef8a1f'], [200, 'd7263d'], [300, '7e2a8c']],
            ends: ['Good', 'Hazardous'],
            describe: v => v == null ? 'No reading' : `AQI ${v}: ${aqiText(v)}`
        },
        population: {
            label: 'Population', title: 'Population',
            value: id => F(id, 'population'), transform: v => v ? Math.log10(v) : null,
            stops: [[4, 'eef6f2'], [6, 'a7d7c0'], [7, '4fb08a'], [8, '1d7a5c'], [9, '0b3d2e']],
            ends: ['10,000', '1 billion+'],
            describe: v => v == null ? 'No figure' : `${bigNumber(v)} people`
        },
        gdp: {
            label: 'Income', title: 'GDP per person (US$)',
            value: id => F(id, 'gdpPerHead'), transform: v => v ? Math.log10(v) : null,
            stops: [[2.5, 'fde0dd'], [3.3, 'fa9fb5'], [4, 'c51b8a'], [4.7, '7a0177']],
            ends: ['$300', '$50,000+'],
            describe: v => v == null ? 'No figure' : `${dollars(v)} per person a year`
        },
        life: {
            label: 'Life expectancy', title: 'Life expectancy at birth',
            value: id => F(id, 'lifeExpectancy'),
            stops: [[50, 'fff5eb'], [60, 'fdbe85'], [70, 'fd8d3c'], [78, 'd94701'], [85, '7f2704']],
            ends: ['50 years', '85 years'],
            describe: v => v == null ? 'No figure' : `${v.toFixed(1)} years`
        },
        clean: {
            label: 'Clean electricity', title: 'Electricity from renewables and nuclear',
            value: id => data.electricity?.countries?.[id]?.lowCarbon,
            stops: [[0, '5b3a29'], [25, 'b07a3b'], [50, 'd9d36b'], [75, '7cc47a'], [100, '1b7f4f']],
            ends: ['0%', '100%'],
            describe: v => v == null ? 'No figure' : `${v}% of electricity from renewables and nuclear`
        }
    };

    // ---------- Northern and Southern Lights ----------

    // The north geomagnetic pole (IGRF dipole, 2025). Aurora reach depends on distance from it, not the geographic pole.
    const GEO_POLE = { lat: 80.8, lon: -72.7 };
    function magneticLatitude(lat, lon) {
        const r = Math.PI / 180;
        const s = Math.sin(lat * r) * Math.sin(GEO_POLE.lat * r) + Math.cos(lat * r) * Math.cos(GEO_POLE.lat * r) * Math.cos((lon - GEO_POLE.lon) * r);
        return Math.asin(Math.max(-1, Math.min(1, s))) / r;
    }
    /** Roughly the Kp at which the lights reach the horizon from a place (a rule of thumb, tuned to Ireland's ~Kp 6). */
    const kpNeeded = mlat => Math.max(0, (66 - Math.abs(mlat)) / 2 + 1);
    // NOAA gives Kp in thirds (4.67); one decimal reads better
    const kpText = v => `Kp ${Number(v).toFixed(1).replace(/\.0$/, '')}`;
    // The ECB's rate is for a working day: show the day, not a time
    const ecbDay = date => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'date unknown';
    function auroraChance(kp, need) {
        if (kp >= need + 1) return { level: 'good', text: 'Good chance on a clear, dark night' };
        if (kp >= need) return { level: 'possible', text: 'Possible, low on the horizon' };
        if (kp >= need - 1) return { level: 'low', text: 'Unlikely to the eye; a camera might catch it' };
        return { level: 'none', text: 'Unlikely' };
    }

    // ---------- Money and electricity ----------

    /** Exchange rates to a sensible number of figures: 0.8342, 20.88, 1,517 */
    const rate = v => v == null ? '–' : v >= 1000 ? fmt(Math.round(v)) : v >= 10 ? v.toFixed(2) : v.toPrecision(4);
    const MIX_PARTS = [
        ['coal', 'Coal', '#3f3f46'], ['gas', 'Gas', '#e07b39'], ['oil', 'Oil', '#8c564b'], ['nuclear', 'Nuclear', '#9467bd'],
        ['hydro', 'Hydro', '#1f77b4'], ['wind', 'Wind', '#17becf'], ['solar', 'Solar', '#f2c418'], ['bio', 'Bioenergy', '#2ca02c'], ['otherRenewables', 'Other renewables', '#98df8a']
    ];

    function colourFor(id) {
        const v = VIEWS[view];
        const raw = v.value(id);
        if (v.colour) return v.colour(raw);
        const value = v.transform ? v.transform(raw) : raw;
        return value == null ? '#d6dbd8' : ramp(v.stops.map(([s, c]) => [s, '#' + c]), value);
    }

    // ---------- Dots ----------

    const EVENT_COLOURS = { wildfires: '#e4572e', severeStorms: '#2f6fd6', volcanoes: '#8b1e3f', floods: '#1aa3a3', drought: '#b8860b', dustHaze: '#a0855b', landslides: '#6d4c41', snow: '#7fb3d5', tempExtremes: '#d7263d', earthquakes: '#c2410c', manmade: '#555', waterColor: '#16a085' };
    const eventColour = c => EVENT_COLOURS[c] || '#7c8b85';
    const quakeColour = q => hoursOld(q.time) < 24 ? '#d7263d' : '#f59e0b';
    const camOld = w => !w.updated || hoursOld(w.updated) > 24;
    const windyLink = w => /^https:\/\/(www\.)?windy\.com\/webcams\/\d+$/.test(w.url || '') ? w.url : null;
    const playerLink = w => /^https:\/\/webcams\.windy\.com\/webcams\/public\/embed\/player\/\d+\/day$/.test(w.player || '') ? w.player : null;
    const httpsLink = u => /^https:\/\//.test(u || '') ? u : null;

    const camAge = w => w.updated
        ? `<span class="popup-meta${camOld(w) ? ' old' : ''}">${camOld(w) ? '⚠ ' : ''}Picture updated ${esc(ago(w.updated))}</span>`
        : '<span class="popup-meta old">⚠ Picture update time unknown</span>';
    const camBlock = w => playerLink(w)
        ? `<div class="cam"><button type="button" class="cam-toggle" data-cam="${esc(w.id)}" aria-expanded="false">Show camera ▾</button><div class="cam-box"></div></div>`
        : '';
    const quakeLine = q => `Magnitude ${esc(q.mag)} · ${esc(q.depth ?? '?')} km deep`;

    const OVERLAYS = {
        quakes: {
            label: 'Earthquakes', colour: '#d7263d', name: 'Earthquake',
            build: () => L.layerGroup((data.earthquakes?.quakes || []).map(q => L.circleMarker([q.lat, q.lon], {
                radius: 2 + Math.max(0, q.mag - 2) * 2.2, weight: 1, color: '#fff', fillColor: quakeColour(q), fillOpacity: 0.8
            }).bindPopup(`<strong>${esc(q.place || 'Earthquake')}</strong><br>${quakeLine(q)}<br>
                <span class="popup-meta">${esc(clock(q.time))} (${esc(ago(q.time))})${q.tsunami ? ' · tsunami message issued' : ''}</span><br>
                ${q.url ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">Details on usgs.gov ↗</a>` : ''}`)))
        },
        events: {
            label: 'Fires and storms', colour: '#e4572e', name: 'Natural event',
            build: () => {
                const group = L.layerGroup();
                for (const e of data.events?.events || []) {
                    // A storm's path so far, drawn under its dot (not clickable)
                    if (e.track?.length > 1) L.polyline(e.track.map(([lon, lat]) => [lat, lon]), { color: eventColour(e.category), weight: 2, opacity: 0.6, dashArray: '4 4', interactive: false }).addTo(group);
                    L.circleMarker([e.lat, e.lon], {
                        radius: e.category === 'severeStorms' ? 8 : 5, weight: 1.5, color: '#fff', fillColor: eventColour(e.category), fillOpacity: 0.9
                    }).bindPopup(`<strong>${esc(e.title)}</strong><br>${esc(e.categoryName)}${e.magnitude != null ? ` · ${esc(e.magnitude)} ${esc(e.unit || '')}` : ''}<br>
                        <span class="popup-meta">Latest position ${esc(clock(e.date))}</span>
                        ${httpsLink(e.link) ? `<br><a href="${esc(e.link)}" target="_blank" rel="noopener">Source ↗</a>` : ''}`).addTo(group);
                }
                return group;
            }
        },
        webcams: {
            label: 'Webcams', colour: '#be185d', name: 'Webcam',
            build: () => L.layerGroup((data.webcams?.webcams || []).map(w => L.circleMarker([w.lat, w.lon], {
                radius: 5, weight: 1.5, color: '#fff', fillColor: camOld(w) ? '#e3a6c4' : '#be185d', fillOpacity: 0.95
            }).bindPopup(`<strong>${esc(w.name)}</strong>${w.place ? ` <span class="popup-meta">${esc(w.place)}</span>` : ''}<br>
                ${camAge(w)}<br>
                ${camBlock(w)}
                ${windyLink(w) ? `<a href="${esc(windyLink(w))}" target="_blank" rel="noopener">Watch on Windy.com ↗</a><br>` : ''}
                <span class="popup-meta">Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener">Windy.com</a></span>`)))
        }
    };

    // What each dot colour means: [colour, label]
    const DOT_KEYS = {
        quakes: [['#d7263d', 'Last 24 hours'], ['#f59e0b', 'Last 7 days'], ['#bbb', 'Bigger circle = bigger quake']],
        events: [['#e4572e', 'Wildfire'], ['#2f6fd6', 'Storm (dashed line: its path)'], ['#8b1e3f', 'Volcano'], ['#7c8b85', 'Other']],
        webcams: [['#be185d', 'Webcam (opens on Windy.com)'], ['#e3a6c4', 'Picture not updated for over a day']]
    };

    // ---------- Map ----------

    // Touch screens: one finger scrolls the page, two fingers move the map. Mouse: the wheel zooms once the map is clicked.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const map = L.map('map', {
        preferCanvas: true, zoomSnap: 0.25, minZoom: 1.5, maxZoom: 10, worldCopyJump: true,
        scrollWheelZoom: false, dragging: !coarse, tap: false,
        maxBounds: [[-85, -Infinity], [85, Infinity]], maxBoundsViscosity: 0.8
    }).setView([25, 10], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    const mapEl = document.getElementById('map');

    // Popups keep clear of the zoom buttons; on phones they fit beside them
    const POPUP = { maxWidth: Math.min(320, window.innerWidth - 150), autoPanPaddingTopLeft: L.point(56, 12), autoPanPaddingBottomRight: L.point(12, 12) };
    const HIT_SLOP = coarse ? 14 : 7;

    function styleCountry(feature) {
        const id = feature.properties.id;
        return { fillColor: colourFor(id), fillOpacity: 0.62, color: id === selected ? '#14211c' : '#ffffff', weight: id === selected ? 2.5 : 0.8 };
    }

    function restyle() {
        countryLayer?.setStyle(styleCountry);
        if (selected) countryLayer?.eachLayer(l => { if (l.feature.properties.id === selected) l.bringToFront(); });
        Object.values(overlayLayers).forEach(g => g.eachLayer?.(m => m.bringToFront?.()));
    }

    function drawCountries() {
        countryLayer = L.geoJSON({ type: 'FeatureCollection', features: countries }, {
            style: styleCountry,
            onEachFeature: (feature, layer) => {
                const id = feature.properties.id;
                layer.bindTooltip(() => `${esc(feature.properties.name)}<br><span class="popup-meta">${esc(VIEWS[view].describe(VIEWS[view].value(id)))}</span>`,
                    { sticky: true, className: 'county-tip', direction: 'top', offset: [0, -6] });
                layer.on({
                    mouseover: e => e.target.setStyle({ weight: 2, color: '#14211c' }),
                    mouseout: () => restyle(),
                    click: e => mapClick(e, id)
                });
            },
            bubblingMouseEvents: false
        }).addTo(map);
    }

    /** Every visible dot near a screen point, nearest first. */
    function pointsNear(containerPoint) {
        const found = [];
        for (const [name, group] of Object.entries(overlayLayers)) {
            if (!overlays[name] || !map.hasLayer(group)) continue;
            group.eachLayer(m => {
                if (!m.info) return;
                const d = map.latLngToContainerPoint(m.getLatLng()).distanceTo(containerPoint);
                if (d <= m.getRadius() + HIT_SLOP) found.push({ m, d });
            });
        }
        return found.sort((a, b) => a.d - b.d);
    }

    const openPoint = m => L.popup(POPUP).setLatLng(m.getLatLng()).setContent(m.info.html).openOn(map);
    let pickList = [];

    /** One dot: open it. Several: a short list to choose from. None: the country underneath (if any). */
    function mapClick(e, countryId) {
        const near = pointsNear(e.containerPoint);
        if (near.length === 1) return openPoint(near[0].m);
        if (near.length > 1) {
            pickList = near.slice(0, 8).map(n => n.m);
            L.popup(POPUP).setLatLng(e.latlng).setContent(`<div class="pick-title">${near.length} here, choose one</div>
                <ul class="pick-list">${pickList.map((m, i) => `<li><button type="button" data-pick="${i}">
                    <span class="dot" style="background:${m.info.colour}"></span><strong>${esc(m.info.title)}</strong>
                    <span class="popup-meta">${esc(m.info.type)}</span></button></li>`).join('')}</ul>
                ${near.length > 8 ? `<p class="popup-meta">and ${near.length - 8} more. Zoom in to separate them.</p>` : ''}`).openOn(map);
            return;
        }
        if (countryId) selectCountry(countryId, { from: 'map' });
    }
    map.on('click', e => mapClick(e, null));
    map.on('popupopen', e => {
        e.popup.getElement()?.addEventListener('click', ev => {
            const b = ev.target.closest('[data-pick]');
            if (b && pickList[b.dataset.pick]) openPoint(pickList[b.dataset.pick]);
            const cam = ev.target.closest('[data-cam]');
            if (cam) {
                // Keep this click to the popup: on the map it would close the popup, and the page would toggle it again
                ev.stopPropagation();
                toggleCam(cam, e.popup);
            }
        });
    });

    /** Route each dot's own clicks through mapClick, keeping its popup HTML, title and colour for the pick list. */
    function wireDots(group, label, fallbackColour) {
        group.eachLayer(m => {
            const popup = m.getPopup?.();
            if (!popup) return;
            const html = popup.getContent();
            m.unbindPopup();
            const strong = (String(html).match(/<strong>([\s\S]*?)<\/strong>/) || [])[1];
            const title = strong ? new DOMParser().parseFromString(strong, 'text/html').body.textContent.trim() : label;
            m.info = { html, title, type: label, colour: m.options.fillColor || fallbackColour };
            m.options.bubblingMouseEvents = false;
            m.on('click', ev => mapClick(ev, null));
        });
    }

    function drawOverlays() {
        for (const [name, def] of Object.entries(OVERLAYS)) {
            overlayLayers[name]?.remove();
            overlayLayers[name] = def.build();
            wireDots(overlayLayers[name], def.name, def.colour);
            if (overlays[name]) overlayLayers[name].addTo(map);
        }
    }

    /** Open or close a camera's Windy player under its button. */
    function toggleCam(button, popup) {
        // Leaflet rebuilds a popup from its HTML text on update(), which would throw the player away;
        // swap the text for a live element first, so update() only re-measures it
        if (popup && typeof popup.getContent() === 'string') {
            const node = document.createElement('div');
            node.innerHTML = popup.getContent();
            popup.setContent(node);
            button = node.querySelector(`[data-cam="${CSS.escape(button.dataset.cam)}"]`);
            if (!button) return;
        }
        const box = button.parentElement.querySelector('.cam-box');
        const open = button.getAttribute('aria-expanded') === 'true';
        if (open) {
            box.innerHTML = '';
        } else {
            const w = (data.webcams?.webcams || []).find(x => String(x.id) === button.dataset.cam);
            const src = w && playerLink(w);
            if (!src) return;
            const width = popup ? `width:${Math.max(200, POPUP.maxWidth - 50)}px` : '';
            box.innerHTML = `<iframe src="${esc(src)}" title="${esc(`Webcam: ${w.name}`)}" style="${width}" loading="lazy" allowfullscreen
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>`;
        }
        button.setAttribute('aria-expanded', String(!open));
        button.textContent = open ? 'Show camera ▾' : 'Hide camera ▴';
        popup?.update();
    }

    // Map buttons: back to the whole world
    const MapButtons = L.Control.extend({
        options: { position: 'topleft' },
        onAdd() {
            const box = L.DomUtil.create('div', 'leaflet-bar map-buttons');
            box.innerHTML = '<a href="#" role="button" data-map="reset" title="Show the whole world" aria-label="Show the whole world">⟲</a>';
            L.DomEvent.disableClickPropagation(box);
            L.DomEvent.on(box, 'click', e => { if (e.target.closest('[data-map]')) { e.preventDefault(); selectCountry(null); resetView(); } });
            return box;
        }
    });
    new MapButtons().addTo(map);
    const resetView = () => map.flyTo([25, 10], window.innerWidth < 560 ? 1.5 : 2, { duration: 0.6 });

    // Scroll-wheel zoom only after the map is clicked
    map.on('click', () => map.scrollWheelZoom.enable());
    mapEl.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());

    // On phones the panel sits below the map: after tapping a country, offer to go there
    const viewBtn = L.DomUtil.create('button', 'map-view-county', mapEl);
    viewBtn.type = 'button';
    viewBtn.addEventListener('click', () => {
        viewBtn.classList.remove('show');
        document.getElementById('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    L.DomEvent.disableClickPropagation(viewBtn);

    /** Fit the map to a country. Countries spanning the date line (Russia, Fiji) zoom to their capital instead. */
    function zoomToCountry(id) {
        countryLayer?.eachLayer(l => {
            if (l.feature.properties.id !== id) return;
            const b = l.getBounds();
            if (b.getEast() - b.getWest() > 180) { const p = l.feature.properties; map.flyTo([p.lat, p.lon], 3, { duration: 0.6 }); }
            else map.flyToBounds(b, { padding: [24, 24], duration: 0.6, maxZoom: 7 });
        });
    }

    // ---------- Controls and legend ----------

    function renderControls() {
        document.getElementById('views').innerHTML = Object.entries(VIEWS).map(([key, v]) =>
            `<button class="chip" role="radio" aria-checked="${key === view}" data-view="${key}">${esc(v.label)}</button>`).join('');
        document.getElementById('overlays').innerHTML = Object.entries(OVERLAYS).map(([key, o]) =>
            `<button class="chip" aria-pressed="${overlays[key]}" data-overlay="${key}"><span class="dot" style="background:${o.colour}"></span>${esc(o.label)}</button>`).join('');
    }

    let legendOpen = null;
    function renderLegend() {
        const v = VIEWS[view];
        let html;
        if (v.legend) html = v.legend();
        else {
            const gradient = v.stops.map(([, c], i) => `#${c} ${Math.round(100 * i / (v.stops.length - 1))}%`).join(', ');
            html = `<div class="legend-title">${esc(v.title)} ${helpFor(VIEW_HELP[view])}</div>
                <div class="legend-ramp" style="background:linear-gradient(90deg, ${gradient})"></div>
                <div class="legend-ends"><span>${esc(v.ends[0])}</span><span>${esc(v.ends[1])}</span></div>`;
        }
        const keys = Object.entries(DOT_KEYS).filter(([name]) => overlays[name]);
        if (keys.length) {
            html += `<details class="legend-dots"${keys.length <= 2 ? ' open' : ''}><summary>Dots on the map</summary>${keys.map(([name, rows]) => `
                <div class="legend-sub">${esc(OVERLAYS[name].label)}</div>
                ${rows.map(([colour, text]) => `<div class="legend-row"><span class="legend-dot" style="background:${colour}"></span>${esc(text)}</div>`).join('')}`).join('')}</details>`;
        }
        if (legendOpen === null) legendOpen = !window.matchMedia('(max-width: 560px)').matches;
        const el = document.getElementById('legend');
        el.innerHTML = `<details class="legend-box"${legendOpen ? ' open' : ''}><summary>Key</summary>${html}</details>`;
        el.querySelector('.legend-box').addEventListener('toggle', e => { legendOpen = e.target.open; });
    }

    document.addEventListener('click', e => {
        const v = e.target.closest('[data-view]');
        if (v) { view = v.dataset.view; renderControls(); renderLegend(); restyle(); updateHash(); }
        const o = e.target.closest('[data-overlay]');
        if (o) {
            const key = o.dataset.overlay;
            overlays[key] = !overlays[key];
            overlays[key] ? overlayLayers[key].addTo(map) : overlayLayers[key].remove();
            renderControls(); renderLegend(); updateHash();
        }
        const cam = e.target.closest('[data-cam]');
        if (cam && !cam.closest('.leaflet-popup')) toggleCam(cam, null);
        if (e.target.closest('[data-cards]')) {
            const open = document.getElementById('national').classList.contains('collapsed');
            try { localStorage.setItem('cards-expanded', open ? '1' : '0'); } catch { /* private mode */ }
            renderNational();
            setTimeout(() => map.invalidateSize(), 50);
        }
        const c = e.target.closest('[data-country]');
        if (c) { e.preventDefault(); selectCountry(c.dataset.country, { zoom: true, from: 'panel' }); }
        if (e.target.closest('[data-back]')) { e.preventDefault(); selectCountry(null); resetView(); }
    });

    // Shareable links: #country=IRL&view=air&show=quakes,events
    function updateHash() {
        const params = new URLSearchParams();
        if (selected) params.set('country', selected);
        if (view !== 'temperature') params.set('view', view);
        params.set('show', Object.keys(overlays).filter(k => overlays[k]).join(','));
        history.replaceState(null, '', '#' + params.toString());
    }

    function readHash() {
        const params = new URLSearchParams(location.hash.slice(1));
        if (params.get('view') && VIEWS[params.get('view')]) view = params.get('view');
        if (params.has('show')) {
            const show = params.get('show').split(',');
            Object.keys(overlays).forEach(k => { overlays[k] = show.includes(k); });
        }
        return params.get('country');
    }

    // ---------- Summary cards ----------

    /** Countries with a value, sorted (highest first unless asc) */
    function ranked(value, asc = false) {
        return (countries || []).map(f => [f.properties.id, value(f.properties.id)]).filter(([, v]) => v != null)
            .sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1]);
    }
    // "Hottest capital" lists count only real capitals, not Antarctica or uninhabited islands
    const capitalTemp = id => props(id)?.capital ? W(id)?.temp : null;

    function renderNational() {
        const quakes = data.earthquakes?.quakes || [];
        const biggest = quakes.reduce((best, q) => (!best || q.mag > best.mag ? q : best), null);
        const events = data.events?.events || [];
        const count = c => events.filter(e => e.category === c).length;
        const hottest = ranked(capitalTemp)[0];
        const coldest = ranked(capitalTemp, true)[0];
        const worstAir = ranked(id => data.airquality?.countries?.[id]?.aqi)[0];
        const at = (iso, maxHours, prefix = 'Data from') => iso ? { text: `${prefix} ${clock(iso)}`, old: hoursOld(iso) > maxHours } : null;

        const cards = [];
        if (hottest) cards.push(['Hottest capital now', `${hottest[1].toFixed(0)}°C`, `${props(hottest[0])?.place || nameOf(hottest[0])}, ${nameOf(hottest[0])}`, at(data.weather.sourceTime, 3)]);
        if (coldest) cards.push(['Coldest capital now', `${coldest[1].toFixed(0)}°C`, `${props(coldest[0])?.place || nameOf(coldest[0])}, ${nameOf(coldest[0])}`, at(data.weather.sourceTime, 3)]);
        if (biggest) cards.push(['Biggest quake this week', `M${biggest.mag}`, biggest.place, at(data.earthquakes.sourceTime, 3, 'Feed from')]);
        if (data.earthquakes) cards.push(['Earthquakes this week', fmt(quakes.length), 'magnitude 2.5 and over', at(data.earthquakes.sourceTime, 3, 'Feed from')]);
        if (data.events) cards.push(['Wildfires tracked', fmt(count('wildfires')), 'open events, NASA', at(data.events.sourceTime, 24 * 7, 'Latest')]);
        if (data.events) cards.push(['Storms tracked', fmt(count('severeStorms')), 'tropical and severe', at(data.events.sourceTime, 24 * 7, 'Latest')]);
        if (worstAir) cards.push(['Worst air now', `AQI ${worstAir[1]}`, `${nameOf(worstAir[0])}: ${aqiText(worstAir[1])}`, at(data.airquality.sourceTime, 6)]);
        const au = data.aurora;
        if (au) cards.push(['Northern Lights', kpText(au.kpNow), au.kpMax > au.kpNow ? `up to ${kpText(au.kpMax)} in the next 24 hours` : 'no stronger in the next 24 hours', at(au.sourceTime, 6, 'Reading for')]);
        // ECB rates are set on working days, so a weekend or holiday leaves them a few days old
        if (data.rates?.rates?.USD) cards.push(['Euro', `$${data.rates.rates.USD.toFixed(4)}`, 'US dollars to 1 euro (ECB)', { text: `Rate for ${ecbDay(data.rates.date)}`, old: hoursOld(data.rates.sourceTime) > 24 * 4 }]);

        const strip = document.getElementById('national');
        let expanded = false;
        try { expanded = localStorage.getItem('cards-expanded') === '1'; } catch { /* private mode */ }
        strip.classList.toggle('collapsed', !expanded);
        strip.innerHTML = cards.map(([label, value, sub, note]) =>
            // The ⓘ stays on the same line as the label's last word
            `<div class="stat"><div class="stat-label">${esc(label).replace(/(\S+)$/, '<span class="nw">$1')} ${helpFor(CARD_HELP[label])}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div>
            ${note ? `<div class="stat-asof${note.old ? ' old' : ''}"${note.old ? ' title="Older than this source is usually updated"' : ''}>${note.old ? '⚠ ' : ''}${esc(note.text)}</div>` : ''}</div>`).join('')
            + (cards.length > 7 ? `<button type="button" class="cards-toggle" data-cards aria-expanded="${expanded}">${expanded ? 'Show fewer ▴' : `Show all ${cards.length} ▾`}</button>` : '');
    }

    // ---------- Info (ⓘ): what each figure means ----------

    /** An ⓘ that shows a small explainer on hover, keyboard focus or tap. rows: a scale, with "Now" marked. */
    function help(title, { intro = '', rows = [], note = '' } = {}) {
        return `<span class="help" tabindex="0" role="button" aria-label="${esc(`About: ${title}`)}">ⓘ
            <span class="help-box" role="tooltip">
                <span class="kp-title">${esc(title)}</span>
                ${intro ? `<span class="help-intro">${esc(intro)}</span>` : ''}
                ${rows.length ? `<span class="kp-guide">${rows.map(r => `
                    <span class="kp-row${r.now ? ' kp-now' : ''}">
                        <span class="kp-num" style="background:${r.colour}">${esc(r.range)}</span>
                        <span><strong>${esc(r.name)}</strong>${r.now ? ' <span class="pill warn">Now</span>' : ''}
                        ${r.text ? `<span class="meta">${esc(r.text)}</span>` : ''}</span>
                    </span>`).join('')}</span>` : ''}
                ${note ? `<span class="help-note">${esc(note)}</span>` : ''}
            </span></span>`;
    }
    /** Mark the row a value falls in: rows carry from (inclusive) and to (exclusive). */
    const placeOn = (rows, value) => rows.map(r => ({ ...r, now: value != null && value >= r.from && value < r.to }));

    const HELP = {
        capitalTemp: () => help('Capital temperatures', {
            intro: 'The temperature right now at each country’s capital, from the Open-Meteo weather model (not a weather station).',
            note: 'Only places with a capital count, so Antarctica and uninhabited islands are left out. Times are when the model reading is for.'
        }),
        temperature: () => help('Temperature map', {
            intro: 'Each country is coloured by the model temperature now at its capital, or its biggest town where it has no capital.',
            note: 'A big country can be much warmer or colder away from its capital.'
        }),
        daynight: () => help('Day or night', {
            intro: 'Whether the sun is up at each capital right now. The line between them moves west about 15° of longitude an hour.'
        }),
        weather: () => help('Weather now', {
            intro: 'The Open-Meteo weather model at the capital (or biggest town), updated every hour. "Feels like" adds the effect of wind chill and humidity.',
            note: 'Model values for one spot: local conditions, hills and coasts can differ.'
        }),
        aqi: () => {
            const v = selected ? data.airquality?.countries?.[selected]?.aqi : null;
            return help('Air quality index (US AQI)', {
                intro: 'How clean the air is, from fine particles, ozone and other pollutants. Lower is better.',
                rows: placeOn([
                    { from: 0, to: 51, range: '0–50', name: 'Good', colour: '#7fc97f', text: 'Air is clean.' },
                    { from: 51, to: 101, range: '51–100', name: 'Moderate', colour: '#c7e9a0', text: 'Fine for most people; very sensitive people may notice.' },
                    { from: 101, to: 151, range: '101–150', name: 'Unhealthy for sensitive groups', colour: '#f2c418', text: 'People with asthma or heart conditions, children and older people should cut down long outdoor effort.' },
                    { from: 151, to: 201, range: '151–200', name: 'Unhealthy', colour: '#ef8a1f', text: 'Everyone may start to feel effects.' },
                    { from: 201, to: 301, range: '201–300', name: 'Very unhealthy', colour: '#e35d6a', text: 'Health alert: everyone should limit time outdoors.' },
                    { from: 301, to: 9999, range: '301+', name: 'Hazardous', colour: '#b07cc6', text: 'Emergency conditions.' }
                ], v),
                note: 'A model estimate (Copernicus CAMS, via Open-Meteo) at the capital, not a measuring station. Desert dust counts too, so dry countries can score high.'
            });
        },
        quakes: () => help('Earthquake magnitude', {
            intro: 'Every quake of magnitude 2.5 or more recorded by the US Geological Survey in the last 7 days. Each step up releases about 32 times more energy.',
            rows: [
                { range: '2.5–3.9', name: 'Minor', colour: '#fde68a', text: 'Often felt nearby; rarely any damage.' },
                { range: '4–4.9', name: 'Light', colour: '#fcd34d', text: 'Felt widely; minor damage possible.' },
                { range: '5–5.9', name: 'Moderate', colour: '#f59e0b', text: 'Can damage weak buildings.' },
                { range: '6–6.9', name: 'Strong', colour: '#ef6c3a', text: 'Serious damage near the centre.' },
                { range: '7+', name: 'Major', colour: '#e35d6a', text: 'Damage over a wide area.' }
            ],
            note: 'Small quakes are mostly recorded in the US; elsewhere the list is complete from about magnitude 4.5. Quakes up to 150 km off a coast count for that country.'
        }),
        wildfires: () => help('Wildfires tracked', {
            intro: 'Open wildfires listed by NASA’s Earth Observatory Natural Event Tracker (EONET) in the last 30 days.',
            note: 'Most reports come from the US and Canada, so fires elsewhere are undercounted. Planned burns appear as "Prescribed Fire".'
        }),
        storms: () => help('Storms tracked', {
            intro: 'Tropical cyclones (hurricanes, typhoons) and other severe storms NASA is following now. Switch on "Fires and storms" to see each one; the dashed line is its path so far.',
            note: 'Wind speeds are in knots (1 knot is about 1.85 km/h).'
        }),
        events: () => help('Fires, storms and other events', {
            intro: 'Natural events NASA’s EONET lists as open, seen in the last 30 days: wildfires, severe storms, volcanoes, floods, dust and more.',
            note: 'Events up to 100 km off a coast count for that country. Wildfire reports come mostly from the US and Canada.'
        }),
        kp: () => {
            const v = data.aurora?.kpNow;
            return help('Kp index: Northern and Southern Lights', {
                intro: 'How disturbed the Earth’s magnetic field is, from 0 to 9, measured every 3 hours by NOAA. The higher it is, the further from the poles the lights reach.',
                rows: placeOn([
                    { from: 0, to: 3, range: '0–2', name: 'Quiet', colour: '#c7e9c0', text: 'Lights stay over the Arctic and Antarctic.' },
                    { from: 3, to: 5, range: '3–4', name: 'Active', colour: '#a1d99b', text: 'Iceland, northern Norway, Alaska, northern Canada.' },
                    { from: 5, to: 6, range: '5', name: 'Minor storm', colour: '#f2c418', text: 'Can reach Scotland, southern Norway, the northern US border.' },
                    { from: 6, to: 7, range: '6', name: 'Moderate storm', colour: '#ef8a1f', text: 'Possible from Ireland, northern England and Denmark.' },
                    { from: 7, to: 8, range: '7', name: 'Strong storm', colour: '#e35d6a', text: 'Can reach central Europe and the northern US states.' },
                    { from: 8, to: 10, range: '8–9', name: 'Severe storm', colour: '#b07cc6', text: 'Rare: seen as far as southern Europe and the southern US.' }
                ], v),
                note: 'You also need a dark, clear sky away from city lights. The chance shown for each capital is a rough guide.'
            });
        },
        euro: () => help('Exchange rates', {
            intro: 'The European Central Bank’s reference rates, set each working day around 14:15 Central European Time for about 30 currencies.',
            note: 'For other currencies the page shows the World Bank’s official rate averaged over a year. Banks and card providers add their own margin, so you’ll get a little less.'
        }),
        population: () => help('Population', {
            intro: 'World Bank estimate of everyone living in the country, for the latest year available.',
            note: 'The map uses a stepped scale (10,000, 1 million, 100 million…) so small and huge countries both show up.'
        }),
        gdp: () => help('Income: GDP per person', {
            intro: 'The value of everything a country produces in a year, divided by its population, in US dollars at market exchange rates (World Bank).',
            note: 'Not adjusted for local prices, so it understates how far money goes in cheaper countries. An average: it doesn’t show how evenly income is shared.'
        }),
        life: () => help('Life expectancy', {
            intro: 'How long a baby born in that year would live on average if today’s death rates stayed the same (World Bank).',
            note: 'Deaths in childhood pull the average down a lot, so adults often live well past it.'
        }),
        facts: () => help('Facts', {
            intro: 'World Bank World Development Indicators: population, GDP per person (US dollars at market rates) and life expectancy at birth.',
            note: 'Each figure is the latest year the World Bank has for that country, shown in brackets.'
        }),
        electricity: () => help('Where electricity comes from', {
            intro: 'Share of the country’s electricity generated from each source in the latest full year (Ember and the Energy Institute, via Our World in Data). "Renewables and nuclear" both produce very little CO₂.',
            rows: [
                { range: '<100', name: 'Very clean', colour: '#7cc47a', text: 'Grams of CO₂ per kWh: mostly hydro, wind, solar or nuclear.' },
                { range: '100–400', name: 'Mixed', colour: '#d9d36b', text: 'Some gas or coal alongside clean sources.' },
                { range: '400–600', name: 'Fossil-heavy', colour: '#e0a35b', text: 'Mostly gas, oil or coal.' },
                { range: '600+', name: 'Coal-heavy', colour: '#a9714b', text: 'Coal makes up most of it.' }
            ],
            note: 'This is electricity only, not all energy: heating and transport often still run on fossil fuels.'
        }),
        webcams: () => help('Webcams', {
            intro: 'The most-watched public webcams on each continent, up to 5 per country, from Windy.com. "Show camera" opens Windy’s player with the latest picture and a timelapse of the day.',
            note: 'A camera whose picture hasn’t changed for a day is marked ⚠: it may be stuck or offline.'
        })
    };
    const SECTION_HELP = {
        'Weather now': 'weather', 'Air quality': 'aqi', 'Worst air right now': 'aqi',
        'Earthquakes this week': 'quakes', 'Biggest earthquakes this week': 'quakes',
        'Northern Lights': 'kp', 'Southern Lights': 'kp', 'Northern and Southern Lights': 'kp',
        'Money': 'euro', 'Exchange rates': 'euro', 'Facts': 'facts', 'Webcams': 'webcams',
        'Electricity': 'electricity', 'Cleanest electricity': 'electricity', 'Most fossil-fuelled electricity': 'electricity',
        'Fires, storms and other events': 'events', 'Hottest capitals right now': 'capitalTemp', 'Coldest capitals right now': 'capitalTemp'
    };
    const CARD_HELP = {
        'Hottest capital now': 'capitalTemp', 'Coldest capital now': 'capitalTemp', 'Biggest quake this week': 'quakes', 'Earthquakes this week': 'quakes',
        'Wildfires tracked': 'wildfires', 'Storms tracked': 'storms', 'Worst air now': 'aqi', 'Northern Lights': 'kp', 'Euro': 'euro'
    };
    const VIEW_HELP = { temperature: 'temperature', daynight: 'daynight', air: 'aqi', population: 'population', gdp: 'gdp', life: 'life', clean: 'electricity' };
    const helpFor = key => (key && HELP[key] ? HELP[key]() : '');

    // Help boxes are position: fixed so scrolling panels can't clip them; place each beside its ⓘ,
    // kept inside the window (phones pin them across the screen in CSS instead)
    function placeHelp(e) {
        const el = e.target.closest?.('.help');
        if (!el || window.innerWidth <= 560) return;
        const box = el.querySelector('.help-box');
        const icon = el.getBoundingClientRect();
        box.style.visibility = 'hidden';
        box.style.display = 'block';
        const w = box.offsetWidth, h = box.offsetHeight;
        box.style.display = '';
        box.style.visibility = '';
        const left = Math.min(Math.max(8, icon.right - w), window.innerWidth - w - 8);
        const below = icon.bottom + 6;
        box.style.left = `${left}px`;
        box.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, icon.top - h - 6) : below}px`;
    }
    document.addEventListener('mouseover', placeHelp);
    document.addEventListener('focusin', placeHelp);

    // ---------- Panel ----------

    function section(title, body, link) {
        return `<section class="section"><h3><span>${esc(title)} ${helpFor(SECTION_HELP[title])}</span>${link ? `<a href="${esc(link[1])}" target="_blank" rel="noopener">${esc(link[0])} ↗</a>` : ''}</h3>${body}</section>`;
    }
    const asOf = (text, old = false) => `<p class="asof${old ? ' old' : ''}"${old ? ' title="Older than this source is usually updated"' : ''}>${old ? '⚠ ' : ''}${esc(text)}</p>`;
    const unavailable = '<p class="empty">Not available right now.</p>';
    const countryLink = id => `<a href="#" data-country="${esc(id)}">${esc(nameOf(id))}</a>`;
    const dayName = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IE', { weekday: 'short', timeZone: 'UTC' });

    function countryPanel(id) {
        const p = props(id);
        const w = W(id);
        let html = `<a href="#" data-back class="muted">← Whole world</a>
            <h2 style="margin-top:6px">${esc(p.name)}</h2>
            <div class="irish">${esc([p.region, p.capital ? `capital ${p.capital}` : null].filter(Boolean).join(' · '))}</div>`;
        if (w) html += `<p class="soft" style="margin-top:6px">Local time at ${esc(p.place || p.name)}: <strong>${esc(localNow(w))}</strong> <span class="muted">(${esc(utcOffset(w.offset))})</span></p>`;

        // Weather now
        const where = p.place ? `at ${p.place}` : 'in the middle of the country';
        html += section('Weather now', w ? `
            <div class="row"><span class="big">${esc(w.temp.toFixed(1))}°C</span><span class="soft">${esc(weatherText(w.code))}${w.isDay ? '' : ', night'}</span></div>
            <p class="muted">Feels like ${esc(w.feels?.toFixed(0) ?? '–')}°C · wind ${esc(w.wind?.toFixed(0) ?? '–')} km/h${w.gust ? `, gusts ${esc(w.gust.toFixed(0))}` : ''} · humidity ${esc(w.humidity ?? '–')}%${w.rain ? ` · ${esc(w.rain)} mm rain` : ''}</p>
            <p class="muted">Model weather ${esc(where)}, not a station reading.</p>
            ${asOf(`Weather for ${clock(w.time)}`, hoursOld(w.time) > 3)}` : unavailable, ['open-meteo.com', 'https://open-meteo.com/']);

        // Next 3 days, and today's daylight
        if (w?.daily?.length) {
            html += section('Next few days', `<div class="forecast">${w.daily.map(d => `
                <div class="fday"><div class="fday-name">${esc(dayName(d.date))}</div>
                <div class="fday-temp">${esc(d.max?.toFixed(0) ?? '–')}°<span> / ${esc(d.min?.toFixed(0) ?? '–')}°</span></div>
                <div class="fday-sum">${esc(weatherText(d.code))}${d.rain ? `, ${esc(d.rain.toFixed(0))} mm` : ''}</div></div>`).join('')}</div>`);
            const today = w.daily[0];
            html += section('Daylight today', today.sunrise && today.sunset ? `
                <div class="row"><span class="big">${esc(localTime(today.sunrise, w))}</span><span class="soft">sunrise</span>
                <span class="big">${esc(localTime(today.sunset, w))}</span><span class="soft">sunset</span></div>
                <p class="muted">Local time ${esc(where)}.</p>`
                : `<p class="soft">${w.isDay ? 'The sun doesn’t set here today (polar day).' : 'The sun doesn’t rise here today (polar night).'}</p>`);
        }

        // Air quality
        const a = data.airquality?.countries?.[id];
        html += section('Air quality', a ? `
            <div class="row"><span class="big">${esc(a.aqi)}</span><span class="soft">${esc(aqiText(a.aqi))}</span></div>
            <p class="muted">US Air Quality Index. Fine particles (PM2.5) ${esc(a.pm25 ?? '–')} µg/m³, PM10 ${esc(a.pm10 ?? '–')} µg/m³.
            A model estimate (Copernicus CAMS) ${esc(where)}, not a measurement.</p>
            ${asOf(`Estimate for ${clock(a.time)}`, hoursOld(a.time) > 6)}` : unavailable, ['open-meteo.com', 'https://open-meteo.com/en/docs/air-quality-api']);

        // Earthquakes in or just off the country
        if (data.earthquakes) {
            const qs = data.earthquakes.quakes.filter(q => q.country === id).sort((x, y) => y.mag - x.mag);
            html += section('Earthquakes this week', qs.length ? `
                <p class="soft"><strong>${esc(qs.length)}</strong> of magnitude 2.5 or more in the last 7 days</p>
                <ul class="list">${qs.slice(0, 6).map(q => `<li>${q.url ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">M${esc(q.mag)}</a>` : `M${esc(q.mag)}`} ${esc(q.place)}
                    <span class="meta">${esc(clock(q.time))}</span></li>`).join('')}</ul>
                ${asOf(`USGS feed from ${clock(data.earthquakes.sourceTime)}`, hoursOld(data.earthquakes.sourceTime) > 3)}`
                : `<p class="soft">None of magnitude 2.5 or more recorded in the last 7 days.</p>
                <p class="muted">Outside the US the feed is complete from about magnitude 4.5.</p>`, ['usgs.gov', 'https://earthquake.usgs.gov/earthquakes/map/']);
        }

        // Natural events
        const evs = (data.events?.events || []).filter(e => e.country === id);
        if (evs.length) {
            html += section('Fires, storms and other events', `
                <ul class="list">${evs.slice(0, 8).map(e => `<li>${httpsLink(e.link) ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}
                    <span class="meta">${esc(e.categoryName)} · ${esc(clock(e.date))}</span></li>`).join('')}</ul>
                ${evs.length > 8 ? `<p class="muted">and ${esc(evs.length - 8)} more on the map.</p>` : ''}
                ${asOf('Open events from NASA EONET, last 30 days')}`, ['NASA EONET', 'https://eonet.gsfc.nasa.gov/']);
        }

        // Webcams
        const cams = (data.webcams?.webcams || []).filter(c => c.country === id && windyLink(c));
        if (cams.length) {
            html += section('Webcams', `
                <ul class="list">${cams.map(c => `<li><a href="${esc(windyLink(c))}" target="_blank" rel="noopener">${esc(c.name)}</a>${c.place ? ` <span class="muted">${esc(c.place)}</span>` : ''}
                    <span class="meta${camOld(c) ? ' old' : ''}">${camOld(c) ? '⚠ ' : ''}${c.updated ? esc(ago(c.updated)) : 'time unknown'}</span>${camBlock(c)}</li>`).join('')}</ul>
                <p class="muted">The most-watched cameras here. Times show when each picture last changed. Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener">Windy.com</a>.</p>`,
                ['windy.com', 'https://www.windy.com/webcams']);
        }

        // Northern or Southern Lights: only where they can reach (about 50° geomagnetic latitude and beyond)
        const au = data.aurora;
        if (au) {
            const m = magneticLatitude(p.lat, p.lon);
            const need = kpNeeded(m);
            if (need <= 9) {
                const lights = m >= 0 ? 'Northern Lights' : 'Southern Lights';
                const c = auroraChance(au.kpMax, need);
                html += section(lights, `
                    <div class="row"><span class="big">${esc(kpText(au.kpNow))}</span><span class="pill ${c.level === 'good' ? 'down' : c.level === 'possible' ? 'warn' : ''}">${esc(c.text)}</span></div>
                    <p class="muted">${au.kpMax > au.kpNow ? `Up to ${esc(kpText(au.kpMax))} expected around ${esc(clock(au.kpMaxTime))}. ` : ''}${need < 2
                        ? `${esc(p.place || p.name)} is near the aurora zone, so the lights can show on most clear, dark nights.`
                        : `From ${esc(p.place || p.name)} the lights usually need about Kp ${esc(Math.round(need))} to show low on the ${m >= 0 ? 'northern' : 'southern'} horizon.`}
                    A rough guide${w?.isDay ? '. It’s daytime there now' : ''}.</p>
                    ${asOf(`NOAA reading for ${clock(au.sourceTime)}`, hoursOld(au.sourceTime) > 6)}`, ['NOAA', 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast']);
            }
        }

        // Money: the ECB's daily rate where it has one, otherwise the World Bank's yearly average
        const r = data.rates?.countries?.[id];
        const usd = data.facts?.countries?.[id]?.usdRate;
        if (r) {
            const usdPerEuro = data.rates.rates.USD;
            const body = r.currency === 'EUR'
                ? `<p class="soft">Uses the <strong>euro</strong>. 1 euro = <strong>${esc(rate(usdPerEuro))}</strong> US dollars.</p>`
                : r.currency === 'USD'
                    ? `<p class="soft">Uses the <strong>US dollar</strong>. 1 euro = <strong>${esc(rate(usdPerEuro))}</strong> US dollars.</p>`
                    : `<p class="soft">Uses the <strong>${esc(r.name)}</strong> (${esc(r.currency)}).</p>
                        <div class="row"><span class="big">${esc(rate(r.perEuro))}</span><span class="soft">to 1 euro</span>
                        <span class="big">${esc(rate(r.perDollar))}</span><span class="soft">to 1 US dollar</span></div>`;
            html += section('Money', body + asOf(`ECB reference rate for ${ecbDay(data.rates.date)}`, hoursOld(data.rates.sourceTime) > 24 * 4), ['ECB', SOURCE_LINK(data.rates)]);
        } else if (usd) {
            html += section('Money', `<div class="row"><span class="big">${esc(rate(usd.value))}</span><span class="soft">in local currency to 1 US dollar</span></div>
                <p class="muted">The official rate averaged over ${esc(usd.year)}. The European Central Bank doesn't publish a daily rate for this currency.</p>`,
                ['World Bank', `https://data.worldbank.org/indicator/PA.NUS.FCRF?locations=${encodeURIComponent(p.iso2 || '')}`]);
        }

        // Electricity mix
        const el = data.electricity?.countries?.[id];
        if (el) {
            const parts = MIX_PARTS.map(([key, label, colour]) => [label, colour, el.mix[key]]).filter(([, , v]) => v > 0);
            const total = parts.reduce((s, [, , v]) => s + v, 0) || 1;
            html += section('Electricity', `
                <div class="row"><span class="big">${esc(el.lowCarbon)}%</span><span class="soft">from renewables and nuclear</span></div>
                <div class="mixbar" role="img" aria-label="${esc(parts.map(([l, , v]) => `${l} ${v}%`).join(', '))}">${parts.map(([l, c, v]) => `<span style="width:${(100 * v / total).toFixed(2)}%;background:${c}" title="${esc(`${l} ${v}%`)}"></span>`).join('')}</div>
                <ul class="mixkey">${parts.filter(([, , v]) => v >= 0.5).sort((a, b) => b[2] - a[2]).map(([l, c, v]) => `<li><i style="background:${c}"></i>${esc(l)} ${esc(v)}%</li>`).join('')}</ul>
                ${el.carbonIntensity != null ? `<p class="muted">${esc(fmt(el.carbonIntensity))} grams of CO₂ for each kWh generated.</p>` : ''}
                ${asOf(`Figures for ${el.year}`, el.year < new Date().getFullYear() - 2)}`, ['Our World in Data', 'https://ourworldindata.org/electricity-mix']);
        }

        // Facts
        const f = data.facts?.countries?.[id];
        if (f) {
            const row = (label, x, show) => x ? `<li>${esc(label)} <span class="meta">${esc(show(x.value))} (${esc(x.year)})</span></li>` : '';
            html += section('Facts', `<ul class="list">
                ${row('Population', f.population, bigNumber)}
                ${row('GDP per person', f.gdpPerHead, v => `${dollars(v)} a year`)}
                ${row('Life expectancy', f.lifeExpectancy, v => `${v.toFixed(1)} years`)}</ul>
                ${asOf('Latest year each figure is available')}`, ['World Bank', `https://data.worldbank.org/country/${encodeURIComponent(p.wb)}`]);
        }
        return html;
    }

    function worldPanel() {
        const list = (rows, show) => `<ul class="list">${rows.map(([id, v]) => `<li>${countryLink(id)} <span class="meta">${esc(show(v, id))}</span></li>`).join('')}</ul>`;
        const place = id => props(id)?.place || nameOf(id);
        let html = `<h2>The world now</h2><p class="panel-intro soft">Click a country for its weather, forecast, air quality, earthquakes, fires and storms, webcams and key figures.
            Colour the map with the buttons above it, and switch dots on and off.</p>`;

        if (data.weather) {
            html += section('Hottest capitals right now', list(ranked(capitalTemp).slice(0, 5), (v, id) => `${v.toFixed(1)}°C in ${place(id)}`))
                + section('Coldest capitals right now', list(ranked(capitalTemp, true).slice(0, 5), (v, id) => `${v.toFixed(1)}°C in ${place(id)}`)
                    + asOf(`Open-Meteo model weather for ${clock(data.weather.sourceTime)}`, hoursOld(data.weather.sourceTime) > 3));
        }
        if (data.earthquakes) {
            const top = [...data.earthquakes.quakes].sort((a, b) => b.mag - a.mag).slice(0, 6);
            html += section('Biggest earthquakes this week', `<ul class="list">${top.map(q => `<li>${q.url ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">M${esc(q.mag)}</a>` : `M${esc(q.mag)}`} ${esc(q.place)}
                <span class="meta">${esc(clock(q.time))}${q.country ? ` · ${countryLink(q.country)}` : ''}</span></li>`).join('')}</ul>
                ${asOf(`USGS feed from ${clock(data.earthquakes.sourceTime)}`, hoursOld(data.earthquakes.sourceTime) > 3)}`, ['usgs.gov', 'https://earthquake.usgs.gov/earthquakes/map/']);
        }
        if (data.events) {
            const evs = data.events.events;
            const byCat = Object.entries(evs.reduce((acc, e) => (acc[e.categoryName] = (acc[e.categoryName] || 0) + 1, acc), {})).sort((a, b) => b[1] - a[1]);
            const storms = evs.filter(e => e.category === 'severeStorms');
            html += section('Fires, storms and other events', `
                <ul class="list">${byCat.map(([name, n]) => `<li>${esc(name)} <span class="meta">${esc(n)} open</span></li>`).join('')}</ul>
                ${storms.length ? `<p class="soft" style="margin-top:6px">Storms: ${storms.map(s => esc(s.title)).join(', ')}</p>` : ''}
                ${asOf('Open events from NASA EONET, last 30 days. Wildfire reports are mostly from the US and Canada')}`, ['NASA EONET', 'https://eonet.gsfc.nasa.gov/']);
        }
        if (data.airquality) {
            html += section('Worst air right now', list(ranked(id => data.airquality.countries[id]?.aqi).slice(0, 5), v => `AQI ${v}: ${aqiText(v)}`)
                + asOf(`Copernicus CAMS model estimate for ${clock(data.airquality.sourceTime)}`, hoursOld(data.airquality.sourceTime) > 6), ['open-meteo.com', 'https://open-meteo.com/en/docs/air-quality-api']);
        }
        if (data.webcams) {
            html += section('Webcams', `<p class="soft">${esc(fmt(data.webcams.webcams.length))} of the most-watched cameras in ${esc(fmt(new Set(data.webcams.webcams.map(w => w.country)).size))} countries.
                Switch on <strong>Webcams</strong> above the map, or open a country to watch its cameras.</p>
                <p class="muted">Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener">Windy.com</a>.</p>`);
        }
        const au = data.aurora;
        if (au) {
            html += section('Northern and Southern Lights', `
                <div class="row"><span class="big">${esc(kpText(au.kpNow))}</span><span class="soft">now${au.kpMax > au.kpNow ? `, up to ${esc(kpText(au.kpMax))} in the next 24 hours` : ''}</span></div>
                <p class="muted">The Kp index runs from 0 to 9. The higher it is, the further from the poles the lights can be seen.
                Open a country near the poles to see the chance from its capital.</p>
                ${asOf(`NOAA reading for ${clock(au.sourceTime)}`, hoursOld(au.sourceTime) > 6)}`, ['NOAA', 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast']);
        }
        if (data.electricity) {
            // Countries of a million people or more, so small islands with one hydro plant don't fill the list
            const big = id => (data.facts?.countries?.[id]?.population?.value || 0) >= 1e6;
            const clean = ranked(id => big(id) ? data.electricity.countries[id]?.lowCarbon : null);
            const note = asOf('Latest year for each country, countries of a million people or more');
            html += section('Cleanest electricity', list(clean.slice(0, 5), v => `${v}% renewables and nuclear`) + note, ['Our World in Data', 'https://ourworldindata.org/electricity-mix'])
                + section('Most fossil-fuelled electricity', list(clean.slice(-5).reverse(), v => `${v}% renewables and nuclear`) + note, ['Our World in Data', 'https://ourworldindata.org/electricity-mix']);
        }
        if (data.rates?.rates) {
            const show = ['USD', 'GBP', 'JPY', 'CNY', 'INR', 'CHF'].filter(c => data.rates.rates[c]);
            html += section('Exchange rates', `<ul class="list">${show.map(c => `<li>${esc(c)} <span class="meta">${esc(rate(data.rates.rates[c]))} to 1 euro</span></li>`).join('')}</ul>
                ${asOf(`ECB reference rates for ${ecbDay(data.rates.date)}`, hoursOld(data.rates.sourceTime) > 24 * 4)}`, ['ECB', SOURCE_LINK(data.rates)]);
        }
        return html;
    }

    const SOURCE_LINK = layer => /^https:\/\//.test(layer?.source?.url || '') ? layer.source.url : '#';

    function renderPanel() {
        const panel = document.getElementById('panel');
        panel.innerHTML = selected ? countryPanel(selected) : worldPanel();
        panel.scrollTop = 0;
    }

    function selectCountry(id, opts = {}) {
        selected = id && props(id) ? id : null;
        renderPanel();
        restyle();
        updateHash();
        if (selected && opts.zoom) zoomToCountry(selected);
        viewBtn.classList.remove('show');
        if (selected && window.matchMedia('(max-width: 860px)').matches) {
            if (opts.from === 'map' || opts.from === 'search') {
                viewBtn.textContent = `View ${nameOf(selected)} ↓`;
                viewBtn.classList.add('show');
            } else if (opts.from === 'panel') {
                document.getElementById('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    // ---------- Search ----------

    const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let searchMatches = [];
    const searchBox = document.getElementById('search');
    const resultsBox = document.getElementById('search-results');

    function searchCountries(query) {
        const q = fold(query.trim());
        if (q.length < 2 || !countries) return [];
        const starts = [], contains = [];
        for (const { properties: p } of countries) {
            const names = [p.name, p.long, p.capital].filter(Boolean).map(fold);
            if (names.some(n => n.startsWith(q))) starts.push(p);
            else if (names.some(n => n.includes(q))) contains.push(p);
        }
        return [...starts, ...contains].slice(0, 10);
    }

    function renderResults() {
        resultsBox.hidden = !searchMatches.length;
        resultsBox.innerHTML = searchMatches.map((p, i) => `
            <li role="option" data-result="${i}"><strong>${esc(p.name)}</strong>
            <span>${esc([p.capital ? `capital ${p.capital}` : null, p.continent].filter(Boolean).join(' · '))}</span></li>`).join('');
    }

    function goTo(p) {
        searchMatches = [];
        renderResults();
        searchBox.value = p.name;
        selectCountry(p.id, { zoom: true, from: 'search' });
    }

    searchBox.addEventListener('input', () => { searchMatches = searchCountries(searchBox.value); renderResults(); });
    searchBox.addEventListener('keydown', e => {
        if (e.key === 'Enter' && searchMatches[0]) { e.preventDefault(); goTo(searchMatches[0]); }
        if (e.key === 'Escape') { searchMatches = []; renderResults(); }
    });
    resultsBox.addEventListener('click', e => {
        const li = e.target.closest('[data-result]');
        if (li) goTo(searchMatches[Number(li.dataset.result)]);
    });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) { searchMatches = []; renderResults(); } });

    // ---------- Header and footer ----------

    function renderMeta() {
        const stale = Object.entries(status?.layers || {}).filter(([, s]) => !s.ok);
        document.getElementById('updated').innerHTML = status
            ? `<span class="upd-ago">Updated ${esc(ago(status.builtAt))}</span><br><span class="muted">${esc(clock(status.builtAt))}</span>`
                + (stale.length ? `<br><span class="stale stale-long">Showing older data for: ${esc(stale.map(([n]) => n).join(', '))}</span>`
                    + `<span class="stale stale-short">⚠ older: ${esc(stale.map(([n]) => n).join(', '))}</span>` : '')
            : 'Update time unknown';

        const sources = LAYERS.map(n => data[n]?.source).filter(Boolean);
        sources.push({ name: 'Natural Earth country boundaries', url: 'https://www.naturalearthdata.com/', licence: 'Public domain' });
        document.getElementById('footer').innerHTML = `<strong>Data sources</strong> · refreshed every hour, slower datasets daily. Times are shown in your own time zone unless marked local.
            <ul>${sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> (${/^https:\/\//.test(s.licenceUrl || '') ? `<a href="${esc(s.licenceUrl)}" target="_blank" rel="noopener">${esc(s.licence)}</a>` : esc(s.licence)})</li>`).join('')}</ul>
            <p style="margin-top:8px">Borders and names follow Natural Earth and don't imply any view on disputed territory.
            World Now is an independent project and isn't affiliated with any of these organisations.</p>`;
    }

    // ---------- Start ----------

    async function load(name) {
        try {
            const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
            if (res.ok) data[name] = await res.json();
        } catch { /* layer stays missing; panels show "not available" */ }
    }

    async function start() {
        const initial = readHash();
        const [countryRes, statusRes] = await Promise.all([
            fetch('data/countries.geojson'),
            fetch('data/status.json', { cache: 'no-cache' }).catch(() => null),
            ...LAYERS.map(load)
        ]);
        countries = (await countryRes.json()).features;
        status = statusRes?.ok ? await statusRes.json() : null;

        renderControls();
        renderLegend();
        drawCountries();
        drawOverlays();
        renderNational();
        renderMeta();
        selectCountry(initial, { zoom: true });
    }

    // ---------- Keep an open page up to date ----------

    const REFRESH_MINUTES = 10;
    async function refresh() {
        try {
            const res = await fetch('data/status.json', { cache: 'no-cache' });
            if (!res.ok) return;
            const next = await res.json();
            if (status && next.builtAt === status.builtAt) { renderMeta(); return; }
            await Promise.all(LAYERS.map(load));
            status = next;
            const panel = document.getElementById('panel');
            const scroll = panel.scrollTop;
            // Keep any open camera playing: only redraw the panel when none is open
            const playing = panel.querySelector('.cam-box iframe');
            drawOverlays();
            restyle();
            renderLegend();
            renderNational();
            renderMeta();
            if (!playing) { renderPanel(); panel.scrollTop = scroll; }
        } catch { /* offline for a moment: try again next time */ }
    }
    setInterval(refresh, REFRESH_MINUTES * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

    window.addEventListener('hashchange', () => {
        if (!countries) return;
        const id = readHash();
        for (const [key, on] of Object.entries(overlays)) {
            if (on && !map.hasLayer(overlayLayers[key])) overlayLayers[key].addTo(map);
            if (!on && map.hasLayer(overlayLayers[key])) overlayLayers[key].remove();
        }
        renderControls(); renderLegend(); restyle();
        if (id !== selected) selectCountry(id, { zoom: true });
    });

    start();
})();
