// Northern Lights (NOAA Kp), exchange rates (ECB) and electricity mix (Our World in Data), from real saved answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer, freezeClock } = require('./helpers');

// ---------- Northern Lights ----------

const KP = /services\.swpc\.noaa\.gov/;
const kpRows = () => JSON.parse(fixture('noaa-kp-forecast.json'));

test('aurora: Kp now is the latest observed or estimated value; the next 24 hours peak', async t => {
    freezeClock(t, '2026-11-08T21:30:00Z');
    // Run in a time zone far from UTC, so reading NOAA's times as local time would show up
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';
    t.after(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });
    mockHttp([[KP, kpRows()]]);
    const d = await loadLayer('aurora').fetchAurora();
    assert.equal(d.kpNow, 4.67);
    assert.equal(d.kpNowTime, '2026-11-08T21:00:00.000Z', 'NOAA times are UTC');
    // Nothing higher than now is forecast for the next day, so the peak is now
    assert.equal(d.kpMax, 4.67);
    assert.equal(d.sourceTime, d.kpNowTime);
    assert.ok(d.series.length >= 8 && d.series.every(([iso, kp]) => iso.endsWith('Z') && kp >= 0 && kp <= 9));
    assert.ok(d.series.some(([, , predicted]) => predicted) && d.series.some(([, , predicted]) => !predicted));
});

test('aurora: a forecast storm is the peak, with its time', async t => {
    freezeClock(t, '2026-11-08T21:30:00Z');
    const rows = kpRows().map(r => r.time_tag === '2026-11-09T06:00:00' ? { ...r, kp: 6.33 } : r);
    mockHttp([[KP, rows]]);
    const d = await loadLayer('aurora').fetchAurora();
    assert.equal(d.kpMax, 6.33);
    assert.equal(d.kpMaxTime, '2026-11-09T06:00:00.000Z');
});

test('aurora: no observed values, or nonsense, throws', async () => {
    mockHttp([[KP, kpRows().filter(r => r.observed === 'predicted')]]);
    await assert.rejects(loadLayer('aurora').fetchAurora(), /no observed values/);
    mockHttp([[KP, { oops: 1 }]]);
    await assert.rejects(loadLayer('aurora').fetchAurora(), /Aurora/);
});

// ---------- Exchange rates ----------

const ECB = /ecb\.europa\.eu\/stats\/eurofxref/;

test('rates: euro reference rates for each country that uses a covered currency', async () => {
    mockHttp([[ECB, fixture('ecb-daily.xml')]]);
    const d = await loadLayer('rates').fetchRates();
    assert.equal(d.date, '2026-11-06');
    assert.equal(d.sourceTime, '2026-11-06T15:00:00.000Z');
    assert.equal(d.rates.USD, 1.1165);
    assert.equal(d.rates.EUR, 1);
    assert.deepEqual(d.countries.GBR, { currency: 'GBP', name: 'pound sterling', perEuro: 0.83415, perDollar: 0.83415 / 1.1165 });
    assert.equal(d.countries.IRL.currency, 'EUR');
    assert.equal(d.countries.IRL.perEuro, 1);
    assert.equal(d.countries.KOS.currency, 'EUR', 'Kosovo uses the euro');
    assert.equal(d.countries.ECU.currency, 'USD');
    assert.equal(d.countries.ECU.perDollar, 1);
    assert.equal(d.countries.NGA, undefined, 'the naira has no ECB rate');
    assert.equal(d.countries.FLK, undefined, 'the Falkland Islands pound is its own currency');
});

test('rates: a file without a date or with too few currencies throws', async () => {
    mockHttp([[ECB, '<html>Maintenance</html>']]);
    await assert.rejects(loadLayer('rates').fetchRates(), /no reference date/);
    mockHttp([[ECB, "<Cube time='2026-11-06'><Cube currency='USD' rate='1.1'/></Cube>"]]);
    await assert.rejects(loadLayer('rates').fetchRates(), /only 2 currencies/);
});

// ---------- Electricity ----------

const OWID = /owid\/energy-data/;

test('electricity: a file with too few countries throws', async () => {
    mockHttp([[OWID, fixture('owid-energy-sample.csv')]]);
    await assert.rejects(loadLayer('electricity').fetchElectricity(), /only 4 countries/);
});

test('electricity: the latest year per country, its mix and carbon intensity', async () => {
    const csv = String(fixture('owid-energy-sample.csv'));
    const [head, ...rows] = csv.trim().split('\n');
    // Copy each real row under 120 made-up-but-valid country codes so the "enough countries" guard passes
    const { COUNTRIES } = require('../scripts/lib/geo');
    const ireland2025 = rows.find(r => r.startsWith('Ireland,2025,'));
    const filler = COUNTRIES.slice(0, 120).filter(c => !['IRL', 'FRA', 'NGA'].includes(c.id))
        .map(c => ireland2025.replace('Ireland,2025,IRL', `${c.name.includes(',') ? `"${c.name}"` : c.name},2025,${c.id}`));
    // Newest years first, so "latest year wins" can't rely on the file's order
    mockHttp([[OWID, [head, ...rows.reverse(), ...filler].join('\n')]]);
    const d = await loadLayer('electricity').fetchElectricity();

    const ie = d.countries.IRL;
    assert.equal(ie.year, 2025, 'the latest year wins');
    assert.equal(ie.lowCarbon, 48.1);
    assert.equal(ie.mix.wind, 38);
    assert.equal(ie.mix.gas, 48.4);
    assert.equal(ie.mix.nuclear, 0);
    assert.equal(ie.carbonIntensity, 257);
    assert.equal(d.countries.FRA.mix.nuclear, 68.8);
    assert.ok(d.countries.KOS, 'Kosovo has no ISO code in OWID, so it is matched by name');
    assert.ok(!d.countries.OWID_WRL && !Object.keys(d.countries).includes(''), 'World is left out');
    assert.equal(d.sourceTime, '2025-12-31T00:00:00.000Z');
});

test('electricity: a renamed column throws', async () => {
    mockHttp([[OWID, String(fixture('owid-energy-sample.csv')).replace('low_carbon_share_elec', 'clean_share')]]);
    await assert.rejects(loadLayer('electricity').fetchElectricity(), /missing low_carbon_share_elec/);
});

test('parseCsv: quoted fields, doubled quotes, Windows line endings', () => {
    const { parseCsv } = loadLayer('electricity');
    assert.deepEqual(parseCsv('a,b\r\n"Korea, South","say ""hi"""\r\n1,\n'), [['a', 'b'], ['Korea, South', 'say "hi"'], ['1', '']]);
});
