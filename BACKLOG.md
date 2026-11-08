# Backlog

Ideas waiting to be built, roughly in priority order. Agents pick from here; the owner decides what's next. Move an item to **Done** with the commit when it ships.

## Ready (no key needed, source checked)
- **Northern Lights:** NOAA Kp index and forecast (`services.swpc.noaa.gov`, public domain; already used by Ireland Now).
- **Exchange rates:** ECB reference rates via Frankfurter (`api.frankfurter.app`, no key), daily.
- **Electricity mix by country:** Ember yearly and monthly data (CC BY 4.0).

## Not checked yet
- **Disaster alerts (GDACS):** cyclone, flood and volcano alert levels. Its `robots.txt` only allows visits 04:00–06:45 UTC, one page a minute, so at most a once-a-day fetch in that window. Checked 8 Nov 2026.
- **More cities:** weather for the biggest few cities per large country, if Open-Meteo's daily allowance leaves room.
- **Volcano activity:** Smithsonian Global Volcanism Program weekly report.

## Quality
- Tests for the front end's summary rankings.
- Smaller countries file: simplify shapes rather than only rounding (now about 1.5 MB, 400 KB compressed).
- Check on a real phone: two-finger map moving, popups near the date line.

## Done
- First version: weather, forecast, air quality, earthquakes, natural events, webcams, World Bank facts.
