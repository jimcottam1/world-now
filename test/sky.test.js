// Sun and moon worked out from the clock, checked against known dates (so nothing depends on today).
const test = require('node:test');
const assert = require('node:assert/strict');
const Sky = require('../public/sky');

const near = (actual, expected, within, what) =>
    assert.ok(Math.abs(actual - expected) <= within, `${what}: ${actual} is not within ${within} of ${expected}`);

test('the sun is over the Tropic of Cancer at the June solstice, and the Tropic of Capricorn in December', () => {
    near(Sky.subsolarPoint(new Date('2024-06-20T20:51:00Z')).lat, 23.44, 0.05, 'June solstice');
    near(Sky.subsolarPoint(new Date('2024-12-21T09:20:00Z')).lat, -23.44, 0.05, 'December solstice');
    near(Sky.subsolarPoint(new Date('2024-03-20T03:06:00Z')).lat, 0, 0.05, 'March equinox');
});

test('the sun is over Greenwich at solar noon, not clock noon', () => {
    // 3 November 2024: solar noon at Greenwich was 11:43:36 UTC (the sun runs 16.4 minutes fast)
    near(Sky.subsolarPoint(new Date('2024-11-03T11:43:36Z')).lon, 0, 0.3, 'solar noon');
    // A quarter of a day later the sun is 90° further west
    near(Sky.subsolarPoint(new Date('2024-11-03T17:43:36Z')).lon, -90, 0.5, 'six hours on');
});

test('day and night at Dublin', () => {
    const dublin = [53.35, -6.26];
    assert.ok(Sky.sunAltitude(...dublin, new Date('2026-11-08T12:00:00Z')) > 10, 'midday is day');
    assert.ok(Sky.sunAltitude(...dublin, new Date('2026-11-08T23:00:00Z')) < -40, 'midnight is night');
    // Sunset in Dublin on 8 November 2026 was 16:39 local (UTC): the sun crosses the horizon then
    near(Sky.sunAltitude(...dublin, new Date('2026-11-08T16:39:00Z')), -0.8, 0.6, 'at sunset (the top edge of the sun, bent by the air)');
});

test('the night polygon follows the line where the sun sets, and closes at the dark pole', () => {
    const date = new Date('2026-11-08T21:15:00Z');
    const poly = Sky.nightPolygon(date, { fromLon: -180, toLon: 180, step: 10 });
    // November: the sun is over the south, so the north pole is in the dark
    assert.equal(poly.at(-1)[0], 85.05);
    assert.equal(poly.at(-2)[0], 85.05);
    // Every point on the line is where the sun is on the horizon
    for (const [lat, lon] of poly.slice(0, -2)) {
        if (Math.abs(lat) < 85) near(Sky.sunAltitude(lat, lon, date), 0, 0.01, `line at ${lon}°`);
    }
    // In June it closes at the south pole
    assert.equal(Sky.nightPolygon(new Date('2026-06-21T12:00:00Z')).at(-1)[0], -85.05);
    // The default covers the map's copies of the world either side
    const wide = Sky.nightPolygon(date);
    assert.equal(wide[0][1], -540);
    assert.equal(wide.at(-3)[1], 540);
});

test('the night polygon still works at an equinox, when the sun is over the equator', () => {
    const poly = Sky.nightPolygon(new Date('2024-03-20T03:06:00Z'));
    assert.ok(poly.every(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)));
});

test('day length', () => {
    assert.deepEqual(Sky.dayLength('2026-11-09T07:38:00.000Z', '2026-11-09T16:38:00.000Z'), { minutes: 540, text: '9 hr 0 min' });
    assert.equal(Sky.dayLength('2026-11-09T01:08:00.000Z', '2026-11-09T12:00:00.000Z').text, '10 hr 52 min');
    assert.equal(Sky.dayLength(null, '2026-11-09T12:00:00.000Z'), null);
    assert.equal(Sky.dayLength('2026-11-09T12:00:00.000Z', '2026-11-09T01:00:00.000Z'), null);
});

test('moon phase on known dates', () => {
    // New moon 8 April 2024 18:21 UTC (the North American eclipse); full moon 23 April 2024 23:49 UTC
    const fresh = Sky.moonPhase(new Date('2024-04-08T18:21:00Z'));
    assert.equal(fresh.name, 'New moon');
    assert.ok(fresh.lit < 0.01);
    const full = Sky.moonPhase(new Date('2024-04-23T23:49:00Z'));
    assert.equal(full.name, 'Full moon');
    assert.ok(full.lit > 0.99);
    // First quarter 15 April 2024 19:13 UTC: half lit, growing
    const quarter = Sky.moonPhase(new Date('2024-04-15T19:13:00Z'));
    assert.equal(quarter.name, 'First quarter');
    // The moon's real speed varies, so the average-speed model can be up to about half a day out
    near(quarter.lit, 0.5, 0.08, 'first quarter lit');
    assert.equal(quarter.waxing, true);
    near(quarter.daysToFull, 8.2, 0.6, 'days to full');
    assert.equal(Sky.moonPhase(new Date('2024-04-27T12:00:00Z')).name, 'Waning gibbous');
});
