// Build public/data/countries.geojson from Natural Earth (public domain): 1:50m country shapes, rounded to
// two decimal places (about 1 km) to keep the file small, each with its capital as the point we fetch weather for.
// Run rarely: `npm run countries`.
const fs = require('fs');
const path = require('path');
const { getJson } = require('./lib/http');

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const OUT = path.join(__dirname, '..', 'public', 'data', 'countries.geojson');

// World Bank codes that differ from Natural Earth's
const WB_CODES = { KOS: 'XKX' };
// Where Natural Earth lists several capitals, the seat of government
const CAPITALS = { ZAF: 'Pretoria' };
// Capitals missing from Natural Earth's 1:50m places file
const MISSING_CAPITALS = { SSD: { name: 'Juba', latitude: 4.85, longitude: 31.58, pop_max: 0 } };

const round = n => Math.round(n * 100) / 100;

function cleanRing(ring) {
    const out = [];
    for (const [x, y] of ring) {
        const p = [round(x), round(y)];
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
    // A ring needs at least four points (the last repeating the first)
    return out.length >= 4 ? out : null;
}

function cleanGeometry(g) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const kept = polys.map(rings => {
        const outer = cleanRing(rings[0]);
        if (!outer) return null;
        return [outer, ...rings.slice(1).map(cleanRing).filter(Boolean)];
    }).filter(Boolean);
    return kept.length ? { type: 'MultiPolygon', coordinates: kept } : null;
}

/** Area-weighted centroid of the largest polygon: a fallback point when there's no capital. */
function centroid(geometry) {
    let best = null;
    for (const rings of geometry.coordinates) {
        const ring = rings[0];
        let area = 0, cx = 0, cy = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
            area += f;
            cx += (ring[j][0] + ring[i][0]) * f;
            cy += (ring[j][1] + ring[i][1]) * f;
        }
        if (area && (!best || Math.abs(area) > Math.abs(best.area))) best = { area, lon: cx / (3 * area), lat: cy / (3 * area) };
    }
    return best ? { lat: round(best.lat), lon: round(best.lon) } : null;
}

async function main() {
    const [countries, places] = await Promise.all([
        getJson(`${BASE}/ne_50m_admin_0_countries.geojson`, { timeoutMs: 120000 }),
        getJson(`${BASE}/ne_50m_populated_places_simple.geojson`, { timeoutMs: 120000 })
    ]);

    // Capitals keyed by Natural Earth code and by two-letter ISO code (the places file sometimes uses
    // other three-letter codes, e.g. SDS for South Sudan)
    const capitals = {}, capitalsByIso2 = {};
    // The biggest town of each country or territory: the weather point where no capital is listed
    const biggest = {}, biggestByIso2 = {};
    for (const f of places.features) {
        const p = f.properties;
        if (!biggest[p.adm0_a3] || p.pop_max > biggest[p.adm0_a3].pop_max) biggest[p.adm0_a3] = p;
        if (p.iso_a2 && p.iso_a2 !== '-99' && (!biggestByIso2[p.iso_a2] || p.pop_max > biggestByIso2[p.iso_a2].pop_max)) biggestByIso2[p.iso_a2] = p;
        if (p.adm0cap !== 1) continue;
        const better = (old, p) => !old || CAPITALS[p.adm0_a3] === p.name || (old.capalt && !p.capalt && CAPITALS[p.adm0_a3] !== old.name);
        // Some countries list more than one capital; prefer the main one
        if (better(capitals[p.adm0_a3], p)) capitals[p.adm0_a3] = p;
        if (p.iso_a2 && p.iso_a2 !== '-99' && better(capitalsByIso2[p.iso_a2], p)) capitalsByIso2[p.iso_a2] = p;
    }

    // Ids are ISO 3166 codes where there is one. A few small territories share their country's ISO code
    // (Indian Ocean Territories and Ashmore and Cartier have AUS); those keep Natural Earth's own code.
    const iso = p => (p.ISO_A3_EH && p.ISO_A3_EH !== '-99' ? p.ISO_A3_EH : null);
    const owner = {};
    for (const f of countries.features) {
        const p = f.properties, code = iso(p);
        if (code && (!owner[code] || p.ADM0_A3 === code)) owner[code] = p.ADM0_A3;
    }

    const features = [];
    for (const f of countries.features) {
        const p = f.properties;
        const id = iso(p) && owner[iso(p)] === p.ADM0_A3 ? iso(p) : p.ADM0_A3;
        const geometry = cleanGeometry(f.geometry);
        if (!geometry) continue;
        const iso2 = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : null;
        // The ISO fallback only for a country's own feature, not territories sharing its code
        const ownIso = iso2 && id === iso(p);
        const cap = capitals[p.ADM0_A3] || (ownIso ? capitalsByIso2[iso2] : null) || MISSING_CAPITALS[id];
        const town = cap || biggest[p.ADM0_A3] || (ownIso ? biggestByIso2[iso2] : null);
        const point = town ? { lat: round(town.latitude), lon: round(town.longitude) } : centroid(geometry);
        const wb = WB_CODES[id] || (p.WB_A3 && p.WB_A3 !== '-99' ? p.WB_A3 : id);
        features.push({
            type: 'Feature',
            properties: {
                id,
                iso2,
                wb,
                name: p.NAME_EN || p.NAME,
                long: p.NAME_LONG !== (p.NAME_EN || p.NAME) ? p.NAME_LONG : undefined,
                continent: p.CONTINENT,
                region: p.SUBREGION,
                capital: cap ? cap.name.replace(/\s+/g, ' ') : null,
                // Where the weather and local time are for: the capital, else the biggest town, else the middle
                place: town ? town.name.replace(/\s+/g, ' ') : null,
                lat: point.lat,
                lon: point.lon
            },
            geometry
        });
    }
    // Ids must be unique: the map and every data file key on them
    const seen = new Set();
    for (const f of features) {
        if (seen.has(f.properties.id)) throw new Error(`Duplicate country id ${f.properties.id}`);
        seen.add(f.properties.id);
    }
    features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
    const withCapital = features.filter(f => f.properties.capital).length;
    console.log(`Wrote ${features.length} countries (${withCapital} with a capital) to ${path.relative(process.cwd(), OUT)}: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}

main().catch(e => { console.error(e); process.exit(1); });
