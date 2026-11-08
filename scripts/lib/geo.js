// Country lookups: which country a point is in, and countries by their codes.
const fs = require('fs');
const path = require('path');

const features = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'data', 'countries.geojson'), 'utf8')).features;
const COUNTRIES = features.map(f => f.properties);
const byId = Object.fromEntries(COUNTRIES.map(c => [c.id, c]));

// Bounding boxes first: most points are ruled out without walking a coastline
const boxes = features.map(f => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const rings of f.geometry.coordinates) for (const [x, y] of rings[0]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { f, minX, minY, maxX, maxY };
});

function ringContains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

const polygonContains = (rings, x, y) => ringContains(rings[0], x, y) && !rings.slice(1).some(hole => ringContains(hole, x, y));

/** Rough distance in km between two points (equirectangular: fine for "is it near the coast"). */
function km(lon1, lat1, lon2, lat2) {
    const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    return Math.hypot(x, lat2 - lat1) * 111.32;
}

/**
 * Country id for a point, or null. Points just off a coast (offshore quakes, harbour webcams) count for the
 * nearest country within nearKm; further out at sea they belong to nobody.
 */
function countryAt(lon, lat, nearKm = 0) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    for (const b of boxes) {
        if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) continue;
        if (b.f.geometry.coordinates.some(rings => polygonContains(rings, lon, lat))) return b.f.properties.id;
    }
    if (!nearKm) return null;
    const pad = nearKm / 111.32 / Math.max(0.2, Math.cos(lat * Math.PI / 180));
    let nearest = null, best = nearKm;
    for (const b of boxes) {
        if (lon < b.minX - pad || lon > b.maxX + pad || lat < b.minY - nearKm / 111.32 || lat > b.maxY + nearKm / 111.32) continue;
        for (const rings of b.f.geometry.coordinates) for (const [x, y] of rings[0]) {
            const d = km(lon, lat, x, y);
            if (d < best) { best = d; nearest = b.f.properties.id; }
        }
    }
    return nearest;
}

/** Two-letter ISO code to our country id (the country's own feature, not a territory sharing its code). */
const byIso2 = {};
// Territories sharing a code (AU: Australia, its Indian Ocean Territories, Ashmore and Cartier) give way to the one with a capital
for (const c of COUNTRIES) if (c.iso2 && (!byIso2[c.iso2] || (!byId[byIso2[c.iso2]].capital && c.capital))) byIso2[c.iso2] = c.id;

module.exports = { COUNTRIES, byId, byIso2, countryAt, km };
