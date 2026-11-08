// Air quality at each country's capital (or biggest town): Open-Meteo's air quality API, which serves the
// Copernicus CAMS global model. A model estimate, not a station measurement. Fetched every 3 hours to stay
// well inside Open-Meteo's free daily allowance alongside the weather.
const http = require('../lib/http');
const { COUNTRIES } = require('../lib/geo');

const SOURCE = {
    name: 'Open-Meteo air quality (Copernicus CAMS)',
    url: 'https://open-meteo.com/en/docs/air-quality-api',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://open-meteo.com/en/licence'
};

const API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const BATCH = 50;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function fetchAirQuality() {
    const countries = {};
    for (let i = 0; i < COUNTRIES.length; i += BATCH) {
        const batch = COUNTRIES.slice(i, i + BATCH);
        const params = new URLSearchParams({
            latitude: batch.map(p => p.lat).join(','),
            longitude: batch.map(p => p.lon).join(','),
            current: 'us_aqi,pm2_5,pm10'
        });
        let answer = await http.getJson(`${API}?${params}`, { timeoutMs: 60000 });
        if (answer && !Array.isArray(answer) && batch.length === 1) answer = [answer];
        if (!Array.isArray(answer) || answer.length !== batch.length) throw new Error('Air quality: Open-Meteo answered for a different number of places');
        batch.forEach((c, k) => {
            const cur = (answer.find(a => a?.location_id === k) || answer[k])?.current;
            const aqi = num(cur?.us_aqi);
            // The US AQI scale runs 0 to 500
            if (aqi == null || aqi < 0 || aqi > 500) return;
            const t = Date.parse(`${cur.time}Z`);   // times are in GMT (no timezone asked for)
            countries[c.id] = { aqi, pm25: num(cur.pm2_5), pm10: num(cur.pm10), time: Number.isFinite(t) ? new Date(t).toISOString() : null };
        });
    }
    const got = Object.keys(countries).length;
    if (got < COUNTRIES.length * 0.8) throw new Error(`Air quality: only ${got} of ${COUNTRIES.length} places had a reading`);
    const times = Object.values(countries).map(c => c.time).filter(Boolean).sort();
    return { updatedAt: new Date().toISOString(), source: SOURCE, sourceTime: times[times.length - 1], countries };
}

module.exports = { fetchAirQuality, SOURCE };
