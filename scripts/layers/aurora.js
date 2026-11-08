// Northern and Southern Lights: NOAA Space Weather Prediction Center's planetary Kp index, observed so far and
// forecast for the next 3 days. The page works out what Kp means for each capital (its geomagnetic latitude).
const http = require('../lib/http');

const SOURCE = {
    name: 'NOAA Space Weather Prediction Center',
    url: 'https://www.swpc.noaa.gov/products/planetary-k-index',
    licence: 'US government public domain'
};

const FEED = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

async function fetchAurora() {
    const rows = await http.getJson(FEED, { timeoutMs: 30000 });
    if (!Array.isArray(rows)) throw new Error('Aurora: unexpected NOAA answer');
    // Times are UTC without a zone; Kp runs 0 to 9 in thirds
    const parsed = rows
        .map(r => ({ time: Date.parse(`${r?.time_tag}Z`), kp: Number(r?.kp), kind: r?.observed }))
        .filter(r => Number.isFinite(r.time) && Number.isFinite(r.kp) && r.kp >= 0 && r.kp <= 9);
    const seen = parsed.filter(r => r.kind === 'observed' || r.kind === 'estimated');
    const latest = seen[seen.length - 1];
    if (!latest) throw new Error('Aurora: NOAA file held no observed values');

    const now = Date.now();
    const ahead = parsed.filter(r => r.kind === 'predicted' && r.time > now - 3 * 3600000 && r.time < now + 24 * 3600000);
    const peak = ahead.reduce((best, r) => (!best || r.kp > best.kp ? r : best), null);
    const iso = t => new Date(t).toISOString();
    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        sourceTime: iso(latest.time),
        kpNow: latest.kp,
        kpNowTime: iso(latest.time),
        // The strongest expected in the next 24 hours (or now, if nothing higher is forecast)
        kpMax: peak && peak.kp > latest.kp ? peak.kp : latest.kp,
        kpMaxTime: peak && peak.kp > latest.kp ? iso(peak.time) : iso(latest.time),
        // Every 3-hour value from the past day to the end of the forecast, for a small chart
        series: parsed.filter(r => r.time > now - 24 * 3600000).map(r => [iso(r.time), r.kp, r.kind === 'predicted'])
    };
}

module.exports = { fetchAurora, SOURCE };
