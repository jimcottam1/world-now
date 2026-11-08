// Weather now and the next 3 days at each country's capital (or biggest town), from Open-Meteo.
// Free for non-commercial use, no key. Many places go in one request; Open-Meteo counts each place as a call,
// so ~240 places hourly is ~5,800 of the 10,000 calls a day allowed.
const http = require('../lib/http');
const { COUNTRIES } = require('../lib/geo');

const SOURCE = {
    name: 'Open-Meteo weather forecast',
    url: 'https://open-meteo.com/',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://open-meteo.com/en/licence'
};

const API = 'https://api.open-meteo.com/v1/forecast';
const BATCH = 50;
const CURRENT = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,is_day';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset';

/** Open-Meteo gives local times ("2026-11-09T02:45") plus the offset; turn them into UTC ISO strings. */
function toUtc(local, offsetSeconds) {
    const t = Date.parse(`${local}Z`);
    return Number.isFinite(t) ? new Date(t - offsetSeconds * 1000).toISOString() : null;
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parsePlace(p) {
    const c = p?.current;
    const offset = p?.utc_offset_seconds;
    if (!c || !Number.isFinite(offset)) return null;
    const temp = num(c.temperature_2m);
    // Outside anything ever measured: a broken answer, not weather
    if (temp == null || temp < -90 || temp > 60) return null;
    const d = p.daily || {};
    const daily = (d.time || []).map((date, i) => ({
        date,
        code: num(d.weather_code?.[i]),
        max: num(d.temperature_2m_max?.[i]),
        min: num(d.temperature_2m_min?.[i]),
        rain: num(d.precipitation_sum?.[i]),
        // Polar day or night has no sunrise or sunset
        sunrise: d.sunrise?.[i] ? toUtc(d.sunrise[i], offset) : null,
        sunset: d.sunset?.[i] ? toUtc(d.sunset[i], offset) : null
    }));
    return {
        temp,
        feels: num(c.apparent_temperature),
        humidity: num(c.relative_humidity_2m),
        code: num(c.weather_code),
        wind: num(c.wind_speed_10m),
        gust: num(c.wind_gusts_10m),
        rain: num(c.precipitation),
        isDay: c.is_day === 1,
        time: toUtc(c.time, offset),
        offset,
        tz: typeof p.timezone === 'string' ? p.timezone : null,
        daily
    };
}

async function fetchBatch(places) {
    const params = new URLSearchParams({
        latitude: places.map(p => p.lat).join(','),
        longitude: places.map(p => p.lon).join(','),
        current: CURRENT, daily: DAILY, forecast_days: '3', timezone: 'auto'
    });
    let answer = await http.getJson(`${API}?${params}`, { timeoutMs: 60000 });
    if (answer && !Array.isArray(answer) && places.length === 1) answer = [answer];   // one place comes back on its own
    if (!Array.isArray(answer) || answer.length !== places.length) throw new Error('Weather: Open-Meteo answered for a different number of places');
    return answer;
}

async function fetchWeather() {
    const countries = {};
    for (let i = 0; i < COUNTRIES.length; i += BATCH) {
        const batch = COUNTRIES.slice(i, i + BATCH);
        const answer = await fetchBatch(batch);
        batch.forEach((c, k) => {
            // location_id says which requested place an answer is for; fall back to the order
            const p = answer.find(a => a?.location_id === k) || answer[k];
            const parsed = parsePlace(p);
            if (parsed) countries[c.id] = parsed;
        });
    }
    const got = Object.keys(countries).length;
    if (got < COUNTRIES.length * 0.8) throw new Error(`Weather: only ${got} of ${COUNTRIES.length} places had usable weather`);
    const times = Object.values(countries).map(c => c.time).filter(Boolean).sort();
    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        sourceTime: times[times.length - 1],
        countries
    };
}

module.exports = { fetchWeather, toUtc, SOURCE };
