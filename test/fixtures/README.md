# Test fixtures

Saved answers from the real sources, saved 8 November 2026, so tests never touch the network.

| File | Source | How it was made |
| --- | --- | --- |
| `openmeteo-weather.json` | `https://api.open-meteo.com/v1/forecast?latitude=53.34,28.6&longitude=-6.25,77.2&current=...&daily=...&forecast_days=3&timezone=auto` | Whole answer (Dublin, New Delhi); the test repeats them for every place asked for |
| `openmeteo-airquality.json` | `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=53.35,28.61,-33.87&longitude=-6.26,77.21,151.21&current=us_aqi,pm2_5,pm10` | Whole answer (Dublin, New Delhi, Sydney) |
| `usgs-quakes.json` | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson` | The 10 newest quakes plus 3 of magnitude 5+ (Japan, Tonga, Mid-Atlantic Ridge) |
| `eonet-events.json` | `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30` | The one storm (last 6 track points), 4 wildfires and 1 iceberg |
| `worldbank-*.json` | `https://api.worldbank.org/v2/country/all/indicator/<code>?format=json&mrnev=1&per_page=400` | Two regional groups (AFE, WLD) and 6 countries including Kosovo (XKX) |
| `windy-africa.json` | `https://api.windy.com/webcams/api/v3/webcams?limit=50&continents=AF&sortKey=popularity&sortDirection=desc&include=location,urls,player` | The 8 most popular; `images` and `categories` dropped |
