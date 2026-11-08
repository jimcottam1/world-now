// Webcams: the most-watched public webcams on each continent from the Windy.com Webcams API v3 (free key,
// WINDY_API_KEY, sent in a header), at most a few per country. We keep each camera's name, place, position,
// Windy page, Windy's embeddable day player and when its picture last changed. No image links: free-tier ones
// expire after 10 minutes, far sooner than our hourly build. The player link carries no key or token.
const http = require('../lib/http');
const { byIso2, countryAt } = require('../lib/geo');

const SOURCE = {
    name: 'Windy.com Webcams',
    url: 'https://www.windy.com/webcams',
    licence: 'Windy Webcams API terms',
    licenceUrl: 'https://api.windy.com/webcams/terms'
};

const API = 'https://api.windy.com/webcams/api/v3/webcams';
const CONTINENTS = ['AF', 'AS', 'EU', 'NA', 'OC', 'SA'];
const PAGE = 50;           // the API's largest page
const PAGES = 4;           // the top 200 per continent
const PER_COUNTRY = 5;

const DIRECTION = /\s*›\s*((?:north|south)(?:-(?:east|west))?|east|west)\s*$/i;
const tidy = s => String(s || '').replace(/\s*›\s*/g, ', ').replace(/\s+/g, ' ').trim();

/**
 * Windy titles look like "Oslo › South-west: Pipervika - Kavringen" or "St. Gallen › East: Klosterplatz".
 * Name: the last part ("Klosterplatz"); a lone part with a direction becomes "Tramore, looking south".
 * Place: the first part without its direction ("St. Gallen"), unless the name already says it.
 */
function tidyName(title) {
    const parts = String(title || '').split(':').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return { name: 'Webcam', place: null };
    const last = parts[parts.length - 1];
    const dir = last.match(DIRECTION);
    let name = tidy(last.replace(DIRECTION, ''));
    if (dir && name) name += `, looking ${dir[1].toLowerCase()}`;
    let place = parts.length > 1 ? tidy(parts[0].replace(DIRECTION, '')) : null;
    if (!place || name.toLowerCase().includes(place.toLowerCase())) place = null;
    return { name: name || 'Webcam', place };
}

/** Only ever link to Windy itself. */
const windyLink = (url, id) => /^https:\/\/(www\.)?windy\.com\/webcams\/\d+$/.test(url || '') ? url : `https://www.windy.com/webcams/${id}`;

/** Windy's embeddable day player (latest picture plus a timelapse of the day), only for this same camera. */
function playerLink(url, id) {
    const m = String(url || '').match(/^https:\/\/webcams\.windy\.com\/webcams\/public\/embed\/player\/(\d+)\/day$/);
    return m && Number(m[1]) === id ? url : null;
}

async function fetchContinent(key, continent) {
    const all = [];
    for (let page = 0; page < PAGES; page++) {
        const params = new URLSearchParams({
            continents: continent, limit: String(PAGE), offset: String(page * PAGE),
            sortKey: 'popularity', sortDirection: 'desc', include: 'location,urls,player'
        });
        const answer = await http.getJson(`${API}?${params}`, { timeoutMs: 30000, headers: { 'x-windy-api-key': key } });
        if (!answer || !Number.isFinite(answer.total) || !Array.isArray(answer.webcams)) throw new Error('Webcams: unexpected response from Windy');
        all.push(...answer.webcams);
        if ((page + 1) * PAGE >= answer.total) break;
    }
    return all;
}

async function fetchWebcams() {
    const key = process.env.WINDY_API_KEY;
    if (!key) throw new Error('WINDY_API_KEY is not set');

    const raw = (await Promise.all(CONTINENTS.map(c => fetchContinent(key, c)))).flat();
    if (!raw.length) throw new Error('Webcams: Windy returned no webcams');

    const seen = new Set();
    const byCountry = {};
    for (const w of raw) {
        const id = w?.webcamId;
        const lat = w?.location?.latitude;
        const lon = w?.location?.longitude;
        if (!Number.isFinite(id) || seen.has(id) || w.status !== 'active') continue;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const country = byIso2[w.location.country_code] || countryAt(lon, lat, 30);
        if (!country) continue;
        seen.add(id);
        const updated = Date.parse(w.lastUpdatedOn);
        (byCountry[country] ||= []).push({
            id,
            ...tidyName(w.title),
            country,
            lat, lon,
            url: windyLink(w.urls?.detail, id),
            player: playerLink(w.player?.day, id),
            updated: Number.isFinite(updated) ? new Date(updated).toISOString() : null,
            views: Number.isFinite(w.viewCount) ? w.viewCount : 0
        });
    }
    // The most-watched few in each country, so popular places don't crowd out everywhere else
    const webcams = Object.values(byCountry).flatMap(list => list.sort((a, b) => b.views - a.views).slice(0, PER_COUNTRY))
        .map(({ views, ...w }) => w);
    if (!webcams.length) throw new Error('Webcams: none matched a country');
    const times = webcams.map(w => w.updated).filter(Boolean).sort();
    if (!times.length) throw new Error('Webcams: no usable image update time');
    webcams.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
    return { updatedAt: new Date().toISOString(), source: SOURCE, sourceTime: times[times.length - 1], webcams };
}

module.exports = { fetchWebcams, tidyName, SOURCE };
