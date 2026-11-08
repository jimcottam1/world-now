# World Now

A clickable world map of live public data for every country, published as a static site on GitHub Pages. The world-wide sister of [Ireland Now](https://github.com/jimcottam1/ireland-now).

Click a country for its weather now, 3-day forecast, sunrise and sunset, local time, air quality, earthquakes this week, wildfires and storms, webcams (with Windy's player inline), and population, income and life expectancy. Colour the map by temperature, day or night, air quality, population, income or life expectancy, and switch on dots for earthquakes, fires and storms (with storm paths) and webcams. The world view lists the hottest and coldest capitals, the biggest quakes, open natural events and the worst air.

## How it works

```
GitHub Actions (every hour at :17, on push, or run manually)
  scripts/build.js   fetch every layer -> site/data/*.json, copy public/ -> site/
  deploy             site/ -> GitHub Pages
```

There's no server or database. Each layer is a small script in `scripts/layers/`. If a source fails, the build keeps that layer's last good copy (marked as older data on the page) and carries on with the rest. `state/` carries the slower layers between runs in the GitHub Actions cache. If a source fails on every build for more than 24 hours, `scripts/check-sources.js` opens a GitHub issue labelled `data-source`, and closes it when the source recovers. An open page checks for a new build every 10 minutes.

## Data sources

| Layer | Source | Refreshed |
| --- | --- | --- |
| Countries | [Natural Earth](https://www.naturalearthdata.com/) 1:50m countries and populated places (public domain): 242 countries and territories, rounded to about 1 km. Each country's point is its capital, else its biggest town, else its middle | By hand (`npm run countries`) |
| Weather now and 3-day forecast | [Open-Meteo](https://open-meteo.com/) forecast API (CC BY 4.0, free for non-commercial use) at each country's point: temperature, feels like, wind, rain, day or night, sunrise and sunset, time zone | Hourly |
| Air quality | [Open-Meteo air quality](https://open-meteo.com/en/docs/air-quality-api) (Copernicus CAMS model estimate, not station measurements): US AQI, PM2.5, PM10 | Every 3 hours |
| Earthquakes | [USGS](https://earthquake.usgs.gov/earthquakes/feed/) magnitude 2.5+ in the last 7 days (public domain). Quakes up to 150 km off a coast count for that country. Outside the US the feed is complete from about magnitude 4.5 | Hourly |
| Fires, storms and other events | [NASA EONET](https://eonet.gsfc.nasa.gov/) open events seen in the last 30 days (wildfires, severe storms with their path, volcanoes, floods and more; icebergs left out). Events up to 100 km off a coast count for that country. Wildfire reports come mostly from the US and Canada | Hourly |
| Webcams | [Windy.com Webcams API v3](https://api.windy.com/webcams/docs) (needs the `WINDY_API_KEY` repository secret, sent in a header; [terms](https://api.windy.com/webcams/terms)): the 200 most popular cams on each continent, at most 5 per country. Each links to its Windy page and opens Windy's own player inline on request, with the "Webcams provided by Windy.com" credit | Hourly |
| Facts | [World Bank](https://data.worldbank.org/) World Development Indicators (CC BY 4.0): population (SP.POP.TOTL), GDP per person in current US$ (NY.GDP.PCAP.CD), life expectancy (SP.DYN.LE00.IN), latest year available | Daily |
| Map tiles | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Live |

## Run it locally

```
npm install
npm test
WINDY_API_KEY=... npm run build
npx serve site
```
