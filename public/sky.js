// World Now: where the sun and moon are, worked out from the clock (no data source needed).
// Low-precision formulas, good to a fraction of a degree: plenty for shading a world map.
// Loaded by the page as window.Sky, and by the tests with require().
(function (root) {
    'use strict';

    const RAD = Math.PI / 180;
    const daysSinceJ2000 = date => date.getTime() / 86400000 - 10957.5;   // 2000-01-01 12:00 UTC
    const wrap180 = x => ((x + 180) % 360 + 360) % 360 - 180;

    /** The point on Earth with the sun straight overhead: { lat, lon } in degrees. */
    function subsolarPoint(date) {
        const d = daysSinceJ2000(date);
        const g = (357.529 + 0.98560028 * d) * RAD;               // mean anomaly
        const q = 280.459 + 0.98564736 * d;                        // mean longitude
        const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
        const e = (23.439 - 0.00000036 * d) * RAD;                  // tilt of the Earth's axis
        const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
        const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
        const gmst = (18.697374558 + 24.06570982441908 * d) * 15;  // sidereal time, degrees
        return { lat: dec, lon: wrap180(ra - gmst) };
    }

    /** How high the sun is (degrees) at a place; below 0 is night. */
    function sunAltitude(lat, lon, date) {
        const s = subsolarPoint(date);
        const sin = Math.sin(lat * RAD) * Math.sin(s.lat * RAD) + Math.cos(lat * RAD) * Math.cos(s.lat * RAD) * Math.cos((lon - s.lon) * RAD);
        return Math.asin(Math.max(-1, Math.min(1, sin))) / RAD;
    }

    /**
     * The night side as one polygon of [lat, lon] points, from fromLon to toLon (it can run past ±180
     * so the map's side-by-side copies of the world are covered), closed off at the dark pole.
     */
    function nightPolygon(date, { fromLon = -540, toLon = 540, step = 2, poleLat = 85.05 } = {}) {
        const s = subsolarPoint(date);
        // At the equinoxes the sun is over the equator and the line runs pole to pole; keep tan() away from 0
        const dec = Math.abs(s.lat) < 0.01 ? (s.lat < 0 ? -0.01 : 0.01) : s.lat;
        const line = [];
        for (let lon = fromLon; lon <= toLon; lon += step) {
            const lat = Math.atan(-Math.cos((lon - s.lon) * RAD) / Math.tan(dec * RAD)) / RAD;
            line.push([Math.max(-poleLat, Math.min(poleLat, lat)), lon]);
        }
        // Sun over the north: the south pole is in the dark, and the other way round
        const pole = dec > 0 ? -poleLat : poleLat;
        return [...line, [pole, toLon], [pole, fromLon]];
    }

    /** Hours and minutes of daylight between two ISO times, e.g. { minutes: 543, text: '9 hr 3 min' }. */
    function dayLength(sunriseIso, sunsetIso) {
        const ms = Date.parse(sunsetIso) - Date.parse(sunriseIso);
        if (!Number.isFinite(ms) || ms <= 0) return null;
        const minutes = Math.round(ms / 60000);
        return { minutes, text: `${Math.floor(minutes / 60)} hr ${minutes % 60} min` };
    }

    // ---------- Moon ----------

    const SYNODIC = 29.530588853;                       // days from one new moon to the next
    const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);      // a known new moon
    const PHASES = [
        [1.85, 'New moon'], [5.54, 'Waxing crescent'], [9.23, 'First quarter'], [12.92, 'Waxing gibbous'],
        [16.61, 'Full moon'], [20.30, 'Waning gibbous'], [23.99, 'Last quarter'], [27.68, 'Waning crescent'], [Infinity, 'New moon']
    ];

    /** The moon's phase: its age in days, how much of it is lit (0–1), its name, and days to the next full and new moon. */
    function moonPhase(date) {
        const age = (((date.getTime() - NEW_MOON) / 86400000) % SYNODIC + SYNODIC) % SYNODIC;
        const lit = (1 - Math.cos(2 * Math.PI * age / SYNODIC)) / 2;
        const half = SYNODIC / 2;
        return {
            age,
            lit,
            name: PHASES.find(([upTo]) => age < upTo)[1],
            waxing: age < half,
            daysToFull: age < half ? half - age : SYNODIC - age + half,
            daysToNew: SYNODIC - age
        };
    }

    const Sky = { subsolarPoint, sunAltitude, nightPolygon, dayLength, moonPhase };
    if (typeof module === 'object' && module.exports) module.exports = Sky;
    else root.Sky = Sky;
})(typeof window !== 'undefined' ? window : globalThis);
