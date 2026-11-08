# Backlog

Ideas waiting to be built, roughly in priority order. Agents pick from here; the owner decides what's next. Move an item to **Done** with the commit when it ships.

## Not checked yet
- **Disaster alerts (GDACS):** cyclone, flood and volcano alert levels. Its `robots.txt` only allows visits 04:00–06:45 UTC, one page a minute, so at most a once-a-day fetch in that window. Checked 8 Nov 2026.
- **More cities:** weather for the biggest few cities per large country, if Open-Meteo's daily allowance leaves room (about 7,700 of 10,000 calls a day used now).
- **Volcano activity:** Smithsonian Global Volcanism Program weekly report.
- **Daily rates for more currencies:** a source that allows passing rates on (ExchangeRate-API's free tier doesn't).

## Quality
- Tests for the front end's summary rankings and the aurora rule of thumb.
- Smaller countries file: simplify shapes rather than only rounding (now about 1.5 MB, 400 KB compressed).
- Check on a real phone: two-finger map moving, popups near the date line.

## Done
- First version: weather, forecast, air quality, earthquakes, natural events, webcams, World Bank facts (af6d261).
- Northern and Southern Lights (NOAA Kp), exchange rates (ECB daily, World Bank yearly for the rest), electricity mix (Our World in Data) and a "Clean electricity" map view.
