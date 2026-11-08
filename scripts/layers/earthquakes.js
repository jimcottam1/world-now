// Earthquakes of magnitude 2.5 and over anywhere in the world in the last 7 days: the USGS summary feed.
// Small quakes are mostly recorded in the US (dense local networks); elsewhere the feed is complete from about 4.5.
const http = require('../lib/http');
const { countryAt } = require('../lib/geo');

const SOURCE = {
    name: 'USGS Earthquake Hazards Program',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/',
    licence: 'US government public domain'
};

const FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
const NEAR_KM = 150;   // offshore quakes count for a country this close to its coast

async function fetchEarthquakes() {
    const feed = await http.getJson(FEED, { timeoutMs: 60000 });
    if (feed?.type !== 'FeatureCollection' || !Array.isArray(feed.features)) throw new Error('Earthquakes: unexpected USGS answer');
    const generated = feed.metadata?.generated;
    if (!Number.isFinite(generated)) throw new Error('Earthquakes: no feed time');

    const quakes = [];
    for (const f of feed.features) {
        const p = f?.properties || {};
        const [lon, lat, depth] = f?.geometry?.coordinates || [];
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(p.mag) || !Number.isFinite(p.time)) continue;
        quakes.push({
            id: String(f.id),
            mag: Math.round(p.mag * 10) / 10,
            place: String(p.place || '').trim(),
            time: new Date(p.time).toISOString(),
            lat, lon,
            depth: Number.isFinite(depth) ? Math.round(depth) : null,
            // Only ever link to the USGS event page
            url: /^https:\/\/earthquake\.usgs\.gov\//.test(p.url || '') ? p.url : null,
            tsunami: p.tsunami === 1,
            alert: ['green', 'yellow', 'orange', 'red'].includes(p.alert) ? p.alert : null,
            country: countryAt(lon, lat, NEAR_KM)
        });
    }
    if (feed.features.length && !quakes.length) throw new Error('Earthquakes: no usable quakes in the feed');
    quakes.sort((a, b) => b.time.localeCompare(a.time));
    return { updatedAt: new Date().toISOString(), source: SOURCE, sourceTime: new Date(generated).toISOString(), quakes };
}

module.exports = { fetchEarthquakes, SOURCE };
