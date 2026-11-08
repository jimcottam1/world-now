// Exchange rates: the European Central Bank's euro reference rates for about 30 currencies, published around
// 16:00 Central European Time on working days. Reuse is allowed with the ECB credited as the source.
const http = require('../lib/http');
const { COUNTRIES } = require('../lib/geo');
const { CURRENCY_OF, NAMES } = require('../lib/currencies');

const SOURCE = {
    name: 'European Central Bank euro reference rates',
    url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
    licence: 'ECB, reuse with the source credited',
    licenceUrl: 'https://www.ecb.europa.eu/services/disclaimer/html/index.en.html'
};

const FEED = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** Read the reference date and rates out of the ECB's small XML file. */
function parseEcb(xml) {
    const date = (String(xml).match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/) || [])[1];
    const rates = { EUR: 1 };
    for (const [, code, rate] of String(xml).matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
        const n = Number(rate);
        if (Number.isFinite(n) && n > 0) rates[code] = n;
    }
    return { date, rates };
}

async function fetchRates() {
    const { date, rates } = parseEcb(await http.getText(FEED, { timeoutMs: 30000 }));
    if (!date) throw new Error('Rates: no reference date in the ECB file');
    // The euro is always 1 and the US dollar is always published; without both the file is wrong
    if (!rates.USD || Object.keys(rates).length < 20) throw new Error(`Rates: only ${Object.keys(rates).length} currencies in the ECB file`);

    const countries = {};
    for (const c of COUNTRIES) {
        const code = CURRENCY_OF[c.iso2];
        if (!code || !rates[code]) continue;
        countries[c.id] = {
            currency: code,
            name: NAMES[code] || code,
            perEuro: rates[code],
            perDollar: rates[code] / rates.USD
        };
    }
    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        // Rates are set at 14:15 CET and published around 16:00 CET (15:00 UTC in winter)
        sourceTime: `${date}T15:00:00.000Z`,
        date,
        rates,
        countries
    };
}

module.exports = { fetchRates, parseEcb, SOURCE };
