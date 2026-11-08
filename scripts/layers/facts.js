// Country facts from the World Bank: population, GDP per person and life expectancy, the most recent year
// each country has a figure for. Changes yearly, so fetched daily.
const http = require('../lib/http');
const { COUNTRIES } = require('../lib/geo');

const SOURCE = {
    name: 'World Bank World Development Indicators',
    url: 'https://data.worldbank.org/',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets'
};

const INDICATORS = {
    population: 'SP.POP.TOTL',
    gdpPerHead: 'NY.GDP.PCAP.CD',
    lifeExpectancy: 'SP.DYN.LE00.IN'
};

async function fetchIndicator(code) {
    const answer = await http.getJson(`https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&mrnev=1&per_page=400`, { timeoutMs: 60000 });
    if (!Array.isArray(answer) || !Array.isArray(answer[1])) throw new Error(`Facts: unexpected World Bank answer for ${code}`);
    return { rows: answer[1], lastUpdated: answer[0]?.lastupdated || null };
}

async function fetchFacts() {
    const byWb = {};
    for (const c of COUNTRIES) (byWb[c.wb] ||= []).push(c.id);

    const countries = {};
    const updated = [];
    for (const [key, code] of Object.entries(INDICATORS)) {
        const { rows, lastUpdated } = await fetchIndicator(code);
        if (lastUpdated) updated.push(lastUpdated);
        let matched = 0;
        for (const r of rows) {
            // Regions and income groups (Africa Eastern and Southern, World) match no country and drop out here
            const ids = byWb[r?.countryiso3code];
            const year = Number(r?.date);
            if (!ids || typeof r.value !== 'number' || !Number.isFinite(r.value) || !Number.isInteger(year)) continue;
            for (const id of ids) (countries[id] ||= {})[key] = { value: r.value, year };
            matched++;
        }
        if (!matched) throw new Error(`Facts: no countries matched in ${code}`);
    }
    updated.sort();
    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        // When the World Bank last revised these tables
        sourceTime: updated.length ? new Date(`${updated[updated.length - 1]}T00:00:00Z`).toISOString() : null,
        countries
    };
}

module.exports = { fetchFacts, INDICATORS, SOURCE };
