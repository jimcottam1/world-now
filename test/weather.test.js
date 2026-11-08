// Weather: Open-Meteo answers for many places at once. The saved answer is real (Dublin and New Delhi);
// the fake server repeats them for however many places a request asks for.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { COUNTRIES } = require('../scripts/lib/geo');

const API = /api\.open-meteo\.com\/v1\/forecast/;
const sample = () => JSON.parse(fixture('openmeteo-weather.json'));

/** Answer each request with one entry per requested place: Delhi for India, Dublin for everything else. */
function server({ edit = x => x, seen = [] } = {}) {
    return [[API, url => {
        seen.push(url);
        const lats = new URL(url).searchParams.get('latitude').split(',');
        const [dublin, delhi] = sample();
        return lats.map((lat, i) => edit({ ...(lat === '28.6' ? delhi : dublin), location_id: i }, i));
    }]];
}

test('every country gets weather, in batches, with times in UTC', async () => {
    const seen = [];
    mockHttp(server({ seen }));
    const d = await loadLayer('weather').fetchWeather();
    assert.equal(seen.length, Math.ceil(COUNTRIES.length / 50));
    assert.match(seen[0], /timezone=auto/);
    assert.match(decodeURIComponent(seen[0]), /current=[^&]*is_day/);
    assert.equal(Object.keys(d.countries).length, COUNTRIES.length);

    const india = d.countries.IND;
    assert.equal(india.temp, 19.5);
    assert.equal(india.isDay, false);
    assert.equal(india.offset, 19800);
    assert.equal(india.tz, 'Asia/Kolkata');
    // 02:45 in India (UTC+5:30) is 21:15 UTC the day before
    assert.equal(india.time, '2026-11-08T21:15:00.000Z');
    assert.equal(india.daily.length, 3);
    assert.deepEqual(india.daily[0], { date: '2026-11-09', code: 3, max: 27.9, min: 18.1, rain: 0, sunrise: '2026-11-09T01:08:00.000Z', sunset: '2026-11-09T12:00:00.000Z' });
    assert.ok(d.sourceTime);
});

test('answers are matched by location_id, not just their order', async () => {
    mockHttp([[API, url => {
        const lats = new URL(url).searchParams.get('latitude').split(',');
        const [dublin, delhi] = sample();
        return lats.map((lat, i) => ({ ...(lat === '28.6' ? delhi : dublin), location_id: i })).reverse();
    }]]);
    const d = await loadLayer('weather').fetchWeather();
    assert.equal(d.countries.IND.tz, 'Asia/Kolkata');
    assert.equal(d.countries.IRL.tz, 'Europe/Dublin');
});

test('impossible temperatures are dropped, and too many gaps throw', async () => {
    mockHttp(server({ edit: (p, i) => i === 0 ? { ...p, current: { ...p.current, temperature_2m: 999 } } : p }));
    const d = await loadLayer('weather').fetchWeather();
    assert.equal(Object.keys(d.countries).length, COUNTRIES.length - Math.ceil(COUNTRIES.length / 50));

    mockHttp(server({ edit: p => ({ ...p, current: null }) }));
    await assert.rejects(loadLayer('weather').fetchWeather(), /usable weather/);
});

test('an answer for the wrong number of places throws', async () => {
    mockHttp([[API, () => sample()]]);
    await assert.rejects(loadLayer('weather').fetchWeather(), /different number/);
    mockHttp([[API, { error: true, reason: 'nope' }]]);
    await assert.rejects(loadLayer('weather').fetchWeather(), /Weather/);
});

test('toUtc', () => {
    const { toUtc } = loadLayer('weather');
    assert.equal(toUtc('2026-11-08T21:00', 0), '2026-11-08T21:00:00.000Z');
    assert.equal(toUtc('2026-11-09T06:00', -18000), '2026-11-09T11:00:00.000Z');
    assert.equal(toUtc('nonsense', 0), null);
});
