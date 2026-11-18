// Public holidays (Nager.Date), from a real saved answer for 18–20 November 2026.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');
const state = require('../scripts/lib/state');

const API = /date\.nager\.at\/api\/v3\/NextPublicHolidaysWorldwide/;
const sample = () => JSON.parse(fixture('nager-holidays.json'));

test('holidays: each day off, matched to a country on the map', async t => {
    freezeClock(t, '2026-11-18T22:00:00Z');
    state.write('last-holidays', null);
    mockHttp([[API, sample()]]);
    const d = await loadLayer('holidays').fetchHolidays();
    const latvia = d.holidays.find(h => h.country === 'LVA');
    assert.deepEqual(latvia, {
        country: 'LVA', date: '2026-11-18', name: 'Day of the Proclamation of the Republic of Latvia',
        localName: 'Latvijas Republikas Proklamēšanas diena', regional: false
    });
    // Saxony only
    assert.equal(d.holidays.find(h => h.country === 'DEU').regional, true);
    // English and local names the same: no repeat
    assert.equal(d.holidays.find(h => h.country === 'BLZ').localName, null);
    assert.equal(d.holidays.length, sample().length);
    assert.deepEqual(d.holidays.map(h => h.date), [...d.holidays.map(h => h.date)].sort());
});

test('holidays: observances, unknown countries and broken rows are left out', async t => {
    freezeClock(t, '2026-11-18T22:00:00Z');
    state.write('last-holidays', null);
    const rows = sample();
    rows[0] = { ...rows[0], types: ['Observance'] };
    rows[1] = { ...rows[1], countryCode: 'XX' };
    rows[2] = { ...rows[2], date: '18/11/2026' };
    mockHttp([[API, rows]]);
    const d = await loadLayer('holidays').fetchHolidays();
    assert.equal(d.holidays.length, sample().length - 3);
    assert.ok(!d.holidays.some(h => ['DEU', 'HRV', 'HTI'].includes(h.country)));
});

test('holidays: yesterday and today are kept from the last copy, older ones dropped', async t => {
    freezeClock(t, '2026-11-19T02:00:00Z');
    // The new list has moved on to the 19th; Hawaii is still on the 18th
    const old = { country: 'USA', date: '2026-11-18', name: 'Made-up Day', localName: null, regional: false };
    const stale = { ...old, date: '2026-11-17', name: 'Too old' };
    state.write('last-holidays', { holidays: [old, stale] });
    mockHttp([[API, sample().filter(h => h.date >= '2026-11-19')]]);
    const d = await loadLayer('holidays').fetchHolidays();
    assert.ok(d.holidays.some(h => h.name === 'Made-up Day'));
    assert.ok(!d.holidays.some(h => h.name === 'Too old'));
    assert.equal(d.holidays[0].date, '2026-11-18');
});

test('holidays: an empty or strange answer throws', async () => {
    mockHttp([[API, []]]);
    await assert.rejects(loadLayer('holidays').fetchHolidays(), /unexpected/);
    mockHttp([[API, { status: 500 }]]);
    await assert.rejects(loadLayer('holidays').fetchHolidays(), /unexpected/);
    mockHttp([[API, sample().map(h => ({ ...h, countryCode: 'XX' }))]]);
    await assert.rejects(loadLayer('holidays').fetchHolidays(), /no holidays matched/);
});
