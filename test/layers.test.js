// Air quality, earthquakes, natural events, country facts and webcams, each read from a trimmed real answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, mockHttp, loadLayer } = require('./helpers');
const { COUNTRIES } = require('../scripts/lib/geo');

const json = name => JSON.parse(fixture(name));

// ---------- Air quality ----------

const AQ = /air-quality-api\.open-meteo\.com/;
const aqServer = (edit = x => x) => [[AQ, url => {
    const n = new URL(url).searchParams.get('latitude').split(',').length;
    const [dublin, delhi] = json('openmeteo-airquality.json');
    return Array.from({ length: n }, (_, i) => edit({ ...(i % 2 ? delhi : dublin), location_id: i }, i));
}]];

test('air quality: US AQI and particles for every country, times in UTC', async () => {
    mockHttp(aqServer());
    const d = await loadLayer('airquality').fetchAirQuality();
    assert.equal(Object.keys(d.countries).length, COUNTRIES.length);
    const second = d.countries[COUNTRIES[1].id];   // odd places get the New Delhi answer
    assert.deepEqual(second, { aqi: 178, pm25: 91, pm10: 132.2, time: '2026-11-08T21:00:00.000Z' });
    assert.equal(d.sourceTime, '2026-11-08T21:00:00.000Z');
});

test('air quality: readings off the scale are dropped; mostly missing throws', async () => {
    mockHttp(aqServer((p, i) => i === 0 ? { ...p, current: { ...p.current, us_aqi: -4 } } : p));
    const d = await loadLayer('airquality').fetchAirQuality();
    assert.ok(!d.countries[COUNTRIES[0].id]);
    mockHttp(aqServer(p => ({ ...p, current: {} })));
    await assert.rejects(loadLayer('airquality').fetchAirQuality(), /Air quality/);
});

// ---------- Earthquakes ----------

const USGS = /earthquake\.usgs\.gov\/earthquakes\/feed/;

test('earthquakes: every quake with its country, or none out at sea', async () => {
    mockHttp([[USGS, json('usgs-quakes.json')]]);
    const d = await loadLayer('earthquakes').fetchEarthquakes();
    assert.equal(d.quakes.length, 13);
    const by = place => d.quakes.find(q => q.place.includes(place));
    assert.equal(by('Onagawa').country, 'JPN', 'an offshore quake counts for the nearby coast');
    assert.equal(by('Eureka, Nevada').country, 'USA');
    assert.equal(by('Hamakita, Japan').country, 'JPN');
    // Tonga's northern islands are too small for the 1:50m map, so this one is out at sea (over 300 km from the rest)
    assert.equal(by('Hihifo, Tonga').country, null);
    assert.equal(d.quakes.filter(q => q.place === 'central Mid-Atlantic Ridge').every(q => q.country === null), true, 'mid-ocean quakes belong to nobody');
    const q = by('Onagawa');
    assert.equal(q.mag, 4.5);
    assert.match(q.url, /^https:\/\/earthquake\.usgs\.gov\//);
    assert.ok(d.quakes[0].time >= d.quakes[d.quakes.length - 1].time, 'newest first');
    assert.equal(d.sourceTime, new Date(json('usgs-quakes.json').metadata.generated).toISOString());
});

test('earthquakes: a strange answer throws; links off USGS are dropped', async () => {
    mockHttp([[USGS, { hello: 1 }]]);
    await assert.rejects(loadLayer('earthquakes').fetchEarthquakes(), /Earthquakes/);
    const feed = json('usgs-quakes.json');
    feed.features[0].properties.url = 'https://evil.example/';
    mockHttp([[USGS, feed]]);
    const d = await loadLayer('earthquakes').fetchEarthquakes();
    assert.equal(d.quakes.find(q => q.id === feed.features[0].id).url, null);
});

// ---------- Natural events ----------

const EONET = /eonet\.gsfc\.nasa\.gov/;

test('events: storms keep their track, icebergs are left out, places get a country', async () => {
    mockHttp([[EONET, json('eonet-events.json')]]);
    const d = await loadLayer('events').fetchEvents();
    assert.equal(d.events.length, 5, 'the iceberg is skipped');
    const storm = d.events.find(e => e.category === 'severeStorms');
    assert.equal(storm.title, 'Super Typhoon In-fa');
    assert.equal(storm.track.length, 6);
    assert.equal(storm.unit, 'kts');
    const fire = d.events.find(e => e.title.includes('New Hampshire'));
    assert.equal(fire.country, 'USA');
    assert.equal(fire.track, undefined);
    assert.equal(d.sourceTime, d.events[0].date);
});

test('events: polygons become their middle point; a strange answer throws', async () => {
    const a = json('eonet-events.json');
    a.events[1].geometry = [{ date: '2026-11-01T00:00:00Z', type: 'Polygon', coordinates: [[[-72, 44], [-71, 44], [-71, 45], [-72, 45]]] }];
    mockHttp([[EONET, a]]);
    const d = await loadLayer('events').fetchEvents();
    const e = d.events.find(x => x.id === a.events[1].id);
    assert.deepEqual([e.lon, e.lat], [-71.5, 44.5]);
    mockHttp([[EONET, { events: 'nope' }]]);
    await assert.rejects(loadLayer('events').fetchEvents(), /Events/);
});

// ---------- Country facts ----------

const WB = /api\.worldbank\.org\/v2\/country\/all\/indicator\/([A-Z0-9.]+)\?/;
const wbServer = (edit = x => x) => [[WB, url => edit(json(`worldbank-${url.match(WB)[1]}.json`))]];

test('facts: the latest figure and year for each country; regions are ignored', async () => {
    mockHttp(wbServer());
    const d = await loadLayer('facts').fetchFacts();
    assert.deepEqual(d.countries.IRL.population, { value: 5484367, year: 2025 });
    assert.equal(Math.round(d.countries.IRL.gdpPerHead.value), 131592);
    assert.deepEqual(d.countries.IRL.lifeExpectancy, { value: 83.009756097561, year: 2024 });
    assert.equal(d.countries.KOS.population.value, 1576876, "Kosovo is XKX at the World Bank");
    assert.ok(!Object.keys(d.countries).some(id => ['AFE', 'WLD'].includes(id)));
    assert.equal(d.sourceTime, '2026-10-08T00:00:00.000Z');
});

test('facts: an indicator with no countries throws', async () => {
    mockHttp(wbServer(a => [a[0], a[1].filter(r => r.countryiso3code === 'WLD')]));
    await assert.rejects(loadLayer('facts').fetchFacts(), /no countries matched/);
    mockHttp([[WB, { message: 'error' }]]);
    await assert.rejects(loadLayer('facts').fetchFacts(), /Facts/);
});

// ---------- Webcams ----------

const WINDY = /api\.windy\.com\/webcams\/api\/v3\/webcams/;
const withKey = fn => async t => {
    const old = process.env.WINDY_API_KEY;
    process.env.WINDY_API_KEY = 'test-windy-key';
    try { await fn(t); } finally { if (old === undefined) delete process.env.WINDY_API_KEY; else process.env.WINDY_API_KEY = old; }
};

test('webcams: one request per continent, the key only in a header, countries from ISO codes', withKey(async () => {
    const urls = [];
    mockHttp([[WINDY, url => { urls.push(url); return json('windy-africa.json'); }]]);
    const d = await loadLayer('webcams').fetchWebcams();
    assert.equal(urls.length, 6);
    assert.deepEqual(urls.map(u => new URL(u).searchParams.get('continents')).sort(), ['AF', 'AS', 'EU', 'NA', 'OC', 'SA']);
    assert.ok(urls.every(u => /sortKey=popularity/.test(u) && !u.includes('test-windy-key')));
    assert.equal(d.webcams.length, 8, 'the same camera on every continent page is kept once');
    const table = d.webcams.find(w => w.id === json('windy-africa.json').webcams[0].webcamId);
    assert.equal(table.country, 'ZAF');
    assert.equal(table.name, 'Table mountain - Cape Town');
    assert.equal(table.place, 'Milnerton');
    assert.match(table.player, /^https:\/\/webcams\.windy\.com\/webcams\/public\/embed\/player\/\d+\/day$/);
    assert.ok(!('views' in table));
}));

test('webcams: at most five per country, the most watched', withKey(async () => {
    const a = json('windy-africa.json');
    const za = a.webcams[0];
    a.webcams = Array.from({ length: 7 }, (_, i) => ({ ...za, webcamId: 100 + i, viewCount: i, player: { day: `https://webcams.windy.com/webcams/public/embed/player/${100 + i}/day` } }));
    mockHttp([[WINDY, a]]);
    const d = await loadLayer('webcams').fetchWebcams();
    assert.deepEqual(d.webcams.map(w => w.id).sort(), [102, 103, 104, 105, 106]);
}));

test('webcams: tidy names', () => {
    const { tidyName } = loadLayer('webcams');
    assert.deepEqual(tidyName('St. Gallen › East: Klosterplatz'), { name: 'Klosterplatz', place: 'St. Gallen' });
    assert.deepEqual(tidyName('Tramore › South'), { name: 'Tramore, looking south', place: null });
    assert.deepEqual(tidyName('Écroignard › South-west: Grand Baie › South-West'), { name: 'Grand Baie, looking south-west', place: 'Écroignard' });
    assert.deepEqual(tidyName(''), { name: 'Webcam', place: null });
});

test('webcams: no key, or a strange answer, throws', async () => {
    const old = process.env.WINDY_API_KEY;
    delete process.env.WINDY_API_KEY;
    try {
        mockHttp([]);
        await assert.rejects(loadLayer('webcams').fetchWebcams(), /WINDY_API_KEY is not set/);
    } finally { if (old !== undefined) process.env.WINDY_API_KEY = old; }
    await withKey(async () => {
        mockHttp([[WINDY, { nope: 1 }]]);
        await assert.rejects(loadLayer('webcams').fetchWebcams(), /Webcams/);
    })();
});
