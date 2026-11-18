// Public holidays in the next week, worldwide, from Nager.Date (free for private and non-profit projects; no key).
// One request covers every country. The page picks out the ones for each country's own date today.
const http = require('../lib/http');
const state = require('../lib/state');
const { byIso2 } = require('../lib/geo');

const SOURCE = {
    name: 'Nager.Date public holidays',
    url: 'https://date.nager.at/',
    licence: 'free for non-profit use',
    licenceUrl: 'https://nagerholidays.com/TermsOfService'
};

const API = 'https://date.nager.at/api/v3/NextPublicHolidaysWorldwide';
// Days most people have off; "Observance" days (Mother's Day and the like) are left out
const DAY_OFF = new Set(['Public', 'Bank']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseHoliday(h) {
    const country = byIso2[h?.countryCode];
    if (!country || !DATE.test(h.date || '') || typeof h.name !== 'string' || !h.name.trim()) return null;
    if (!Array.isArray(h.types) || !h.types.some(t => DAY_OFF.has(t))) return null;
    return {
        country,
        date: h.date,
        name: h.name.trim(),
        localName: typeof h.localName === 'string' && h.localName.trim() !== h.name.trim() ? h.localName.trim() : null,
        // Only some states or regions have the day off (e.g. Saxony in Germany)
        regional: h.global === false
    };
}

async function fetchHolidays() {
    const rows = await http.getJson(API, { timeoutMs: 30000 });
    if (!Array.isArray(rows) || !rows.length) throw new Error('Holidays: unexpected Nager.Date answer');
    const fresh = rows.map(parseHoliday).filter(Boolean);
    if (!fresh.length) throw new Error('Holidays: no holidays matched a country on the map');

    // The list starts from the server's own today, which is already tomorrow for some of the world;
    // keep yesterday's and today's (UTC) from the last copy so places behind it still see theirs
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const key = h => `${h.country}|${h.date}|${h.name}`;
    const seen = new Set(fresh.map(key));
    const kept = (state.read('last-holidays')?.holidays || []).filter(h => h.date >= yesterday && !seen.has(key(h)));

    const holidays = [...kept, ...fresh].sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
    return {
        updatedAt: new Date().toISOString(),
        source: SOURCE,
        // The list is for the coming week from now
        sourceTime: new Date().toISOString(),
        holidays
    };
}

module.exports = { fetchHolidays, SOURCE };
