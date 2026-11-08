// Natural events happening now: NASA's Earth Observatory Natural Event Tracker (EONET). Open events seen in the
// last 30 days: wildfires, severe storms (with their track), volcanoes, floods, dust and haze, and so on.
// Icebergs (sea and lake ice) are left out.
const http = require('../lib/http');
const { countryAt } = require('../lib/geo');

const SOURCE = {
    name: 'NASA EONET (Earth Observatory Natural Event Tracker)',
    url: 'https://eonet.gsfc.nasa.gov/',
    licence: 'NASA open data (public domain)'
};

const API = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30';
const SKIP = new Set(['seaLakeIce']);
const NEAR_KM = 100;
const TRACK_POINTS = 40;

/** A point for any geometry: the point itself, or the middle of a polygon's outline. */
function pointOf(g) {
    if (g?.type === 'Point') return g.coordinates;
    if (g?.type === 'Polygon') {
        const ring = g.coordinates?.[0] || [];
        if (!ring.length) return null;
        return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
    }
    return null;
}

async function fetchEvents() {
    const answer = await http.getJson(API, { timeoutMs: 60000 });
    if (!Array.isArray(answer?.events)) throw new Error('Events: unexpected EONET answer');

    const events = [];
    for (const e of answer.events) {
        const cat = e?.categories?.[0];
        if (!cat?.id || SKIP.has(cat.id)) continue;
        const geo = (e.geometry || []).filter(g => pointOf(g) && Number.isFinite(Date.parse(g.date)))
            .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
        if (!geo.length) continue;
        const last = geo[geo.length - 1];
        const [lon, lat] = pointOf(last);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const link = (e.sources || []).map(s => s?.url).find(u => /^https:\/\//.test(u || '')) || null;
        events.push({
            id: String(e.id),
            title: String(e.title || '').trim(),
            category: cat.id,
            categoryName: String(cat.title || cat.id),
            date: new Date(last.date).toISOString(),
            lat, lon,
            magnitude: Number.isFinite(last.magnitudeValue) ? last.magnitudeValue : null,
            unit: last.magnitudeUnit ? String(last.magnitudeUnit) : null,
            // Storms move: keep the path so the map can draw it
            track: cat.id === 'severeStorms' && geo.length > 1 ? geo.slice(-TRACK_POINTS).map(g => pointOf(g).map(n => Math.round(n * 100) / 100)) : undefined,
            link,
            country: countryAt(lon, lat, NEAR_KM)
        });
    }
    events.sort((a, b) => b.date.localeCompare(a.date));
    const newest = events[0]?.date;
    return { updatedAt: new Date().toISOString(), source: SOURCE, sourceTime: newest || null, events };
}

module.exports = { fetchEvents, SOURCE };
