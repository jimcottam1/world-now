// Where each country's electricity comes from: the share of coal, gas, oil, nuclear, hydro, wind, solar and
// bioenergy, and grams of CO2 per kWh, for the latest year. Our World in Data's energy dataset, which takes
// its electricity figures from Ember and the Energy Institute. One ~9 MB file, refetched daily.
const http = require('../lib/http');
const { byId } = require('../lib/geo');

const SOURCE = {
    name: 'Our World in Data energy dataset (Ember, Energy Institute)',
    url: 'https://github.com/owid/energy-data',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/'
};

const FEED = 'https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv';
// OWID leaves some places without an ISO code
const BY_NAME = { Kosovo: 'KOS' };
// Our key -> OWID column (percent of electricity generated)
const MIX = {
    coal: 'coal_share_elec', gas: 'gas_share_elec', oil: 'oil_share_elec', nuclear: 'nuclear_share_elec',
    hydro: 'hydro_share_elec', wind: 'wind_share_elec', solar: 'solar_share_elec', bio: 'biofuel_share_elec',
    otherRenewables: 'other_renewables_share_elec_exc_biofuel'
};

/** A small CSV reader: handles quoted fields with commas and doubled quotes. */
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
        } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

const pct = v => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100.5 ? Math.round(n * 10) / 10 : null;
};

async function fetchElectricity() {
    const rows = parseCsv(await http.getText(FEED, { timeoutMs: 120000 }));
    const head = rows[0] || [];
    const col = name => head.indexOf(name);
    const needed = ['country', 'year', 'iso_code', 'low_carbon_share_elec', 'carbon_intensity_elec', ...Object.values(MIX)];
    const missing = needed.filter(n => col(n) < 0);
    if (missing.length) throw new Error(`Electricity: OWID file is missing ${missing.join(', ')}`);

    const latest = {};
    for (const r of rows.slice(1)) {
        const id = r[col('iso_code')] || BY_NAME[r[col('country')]];
        if (!id || !byId[id]) continue;   // regions and "World" have no country code
        const year = Number(r[col('year')]);
        const lowCarbon = pct(r[col('low_carbon_share_elec')]);
        if (!Number.isInteger(year) || lowCarbon == null) continue;
        if (latest[id] && latest[id].year >= year) continue;
        const mix = {};
        for (const [key, src] of Object.entries(MIX)) mix[key] = pct(r[col(src)]);
        const ci = Number(r[col('carbon_intensity_elec')]);
        latest[id] = { year, lowCarbon, mix, carbonIntensity: r[col('carbon_intensity_elec')] !== '' && Number.isFinite(ci) ? Math.round(ci) : null };
    }
    const n = Object.keys(latest).length;
    if (n < 100) throw new Error(`Electricity: only ${n} countries had figures`);
    const years = Object.values(latest).map(c => c.year).sort((a, b) => a - b);
    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        // The most recent year in the file: a whole year's figures, so "as of" the end of that year
        sourceTime: `${years[years.length - 1]}-12-31T00:00:00.000Z`,
        countries: latest
    };
}

module.exports = { fetchElectricity, parseCsv, SOURCE };
