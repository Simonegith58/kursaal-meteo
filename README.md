# kursaal-meteo
Interactive weather map for Crotone, Italy, featuring weather, wind and marine forecasts, animated wind visualization and local alerts. Built with Leaflet, JavaScript and PHP, with a modular architecture for expansion to locations worldwide.
kursaal-meteo
An interactive Leaflet module for weather forecasts, animated wind, marine conditions and coastal fishing indicators, originally developed for the Crotone Local Guide at Lido Kursaal, Crotone, Italy.
The project combines a JavaScript and CSS interface with PHP endpoints that retrieve and cache weather data and Italian Civil Protection bulletins.
Current coverage: Crotone and its surrounding area. The code is organized for adaptation to other regions, but worldwide location support requires changes to the geographic filters, time zone and alert sources described below. Interface labels are currently in Italian.
Features
- Animated wind particles on a dynamic 5 × 5 grid around the selected location.
- Weather conditions, temperature, apparent temperature, humidity, precipitation, pressure, wind direction and gusts.
- Forecast controls for today and the following two days, including a night-time selection mode. The weather endpoint requests an additional day to support overnight selections.
- Marine forecasts covering waves, swell, sea-surface temperature, currents and modeled sea level, subject to upstream availability.
- A marine grid-distance check that marks data unavailable when the returned sea cell is more than 18 km from the requested location.
- An indicative coastal fishing score based on weather, marine conditions and lunar phase.
- Location search filtered to the province of Crotone.
- Civil Protection alerts for Cala-6 — Versante Jonico Centro-settentrionale, using bulletin metadata and structured GeoJSON data.
- Responsive panels, layer-control integration, server-side caching and stale-data fallbacks.
The fishing score is a heuristic indicator, not a prediction of catches. Marine forecasts and reproduced alert information should be checked against the relevant official sources for operational decisions.
Repository contents
Path	Purpose
api/wind-crotone.php	Weather and wind-grid endpoint
api/marine-crotone.php	Marine forecast endpoint
api/search-crotone.php	Locality search endpoint
api/alerts-crotone.php	Civil Protection bulletin and GeoJSON parser
JS/wind-crotone.js	Leaflet overlay, panels, animation and API requests
css/wind-crotone.css	Interface styles and responsive rules
LICENSE	Apache License 2.0
NOTICE	Project-origin attribution


Preserve the uppercase JS directory name. Paths are case-sensitive on many hosting systems.
Requirements
- A web server with a supported PHP 8.x release. The code uses PHP 8 syntax.
- PHP cURL, JSON support and DOM/libxml for the alert parser. mbstring is optional; the search endpoint includes fallbacks.
- Outbound HTTPS access to Open-Meteo, the Civil Protection bulletin website and the DPC GeoJSON repository.
- A writable PHP temporary directory for weather, marine and geocoding caches.
- A writable, web-protected alert-cache directory, configured as described below.
- Leaflet 1.x with the global L API; the integration example pins version 1.9.4.
- A browser supporting Canvas, Fetch and AbortController.
No Composer, npm or build step is required for the application files.
GitHub hosts the source repository. GitHub Pages does not execute PHP: a working deployment requires a PHP-capable server for the API endpoints. Each installation can use its own server.
Installation
1. Get the source and deploy the files
bash
2. git clone https://github.com/Simonegith58/kursaal-meteo.git
cd kursaal-meteo
Alternatively, download the repository ZIP from GitHub.
Upload the api, JS and css directories to your website, preserving their names. The default JavaScript configuration expects the endpoints at /api/ on the same origin as the page.
For a deployment in a subdirectory, edit CONFIG in JS/wind-crotone.js so all four endpoint paths include the correct prefix. Adjust the stylesheet and script paths in your page as well.
2. Configure the alert cache
At the web server's document root, create:
_private/weather-alerts/
Grant the PHP process write access to this directory. The alert endpoint currently uses $_SERVER['DOCUMENT_ROOT'] to locate it and does not create it automatically. A missing or unwritable directory produces server_cache_unavailable.
Configure the web server to deny HTTP access to /_private/. On Apache 2.4 with .htaccess support, create _private/.htaccess containing:
Require all denied
3. Choose the appropriate Open-Meteo access mode
The weather, marine and search PHP files read an optional server environment variable named:
OPEN_METEO_API_KEY
When it is set, those files select their configured Open-Meteo customer endpoints. Configure the value through your hosting environment; keep it out of JavaScript and version control.
The current files set ALLOW_FREE_EVALUATION = true. With no key, they use the public endpoints. Open-Meteo's free service is intended for non-commercial use and evaluation. For commercial deployments, use an appropriate commercial arrangement and set ALLOW_FREE_EVALUATION = false in all three files to prevent accidental fallback to free access.
The repository's Apache license covers the project code. It does not grant access rights to third-party services. Review Open-Meteo's current plans and terms and preserve its required data attribution.
Leaflet integration
The module extends an existing map. Before loading it, expose these objects:
window.map = map;
window.layerControl = layerControl;
Load the project stylesheet after Leaflet's stylesheet and load the project script after Leaflet, the map and the layer control are initialized.
For a standalone example, save the following as index.html alongside the deployed directories:
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>kursaal-meteo</title>
  <link rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="css/wind-crotone.css">
  <style>
    body { margin: 0; }
    #map { width: 100%; height: 100vh; height: 100dvh; }
  </style>
</head>
<body>
  <div id="map" aria-label="Crotone weather map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map').setView([39.080884, 17.129137], 13);
    const streets = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    ).addTo(map);

    const layerControl = L.control.layers(
      { OpenStreetMap: streets }, {}, { collapsed: true }
    ).addTo(map);

    window.map = map;
    window.layerControl = layerControl;
  </script>
  <script src="JS/wind-crotone.js"></script>
</body>
</html>
Open the layer control and enable “Meteo, mare e vento” to start the module.
For an existing Leaflet or Website X5 page, reuse the existing map and layer control, add the two global assignments and include the project CSS and JavaScript in the order above. Preserve existing map-provider attribution.
The sample uses OpenStreetMap tiles. For production, follow the OpenStreetMap tile usage policy or use a provider suited to your traffic.
Local testing
With PHP and the required extensions installed, complete the cache setup and create the example index.html, then run this from the project root:
php -S 127.0.0.1:8000 -t .
Open http://127.0.0.1:8000/index.html. PHP's built-in server is for local development and does not enforce .htaccess; use the appropriate server access rules for a public deployment.
You can check the JSON endpoints separately:
curl "http://127.0.0.1:8000/api/wind-crotone.php?lat=39.080884&lng=17.129137"
curl "http://127.0.0.1:8000/api/marine-crotone.php?lat=39.080884&lng=17.129137"
curl "http://127.0.0.1:8000/api/search-crotone.php?q=Crotone"
curl "http://127.0.0.1:8000/api/alerts-crotone.php"
Check the HTTP status and the JSON ok field. Marine responses also expose an available flag. Weather, marine and alert responses may be marked stale when cached data is used after an upstream failure; inspect freshness as well as success.
API endpoints and current coverage
All four endpoints accept GET requests and return JSON.
| Endpoint | Parameters | Current behavior |
| --- | --- | --- |
| `/api/wind-crotone.php` | Optional `lat`, `lng` | Defaults to Crotone; returns weather and wind-grid forecast data |
| `/api/marine-crotone.php` | Optional `lat`, `lng` | Defaults to Crotone; returns marine data and the coverage-distance check |
| `/api/search-crotone.php` | Required `q`, 2–80 characters | Returns up to 12 localities matching the Crotone province filter |
| `/api/alerts-crotone.php` | None | Returns alerts for the fixed Cala-6 zone; rejects query parameters |
The weather and marine endpoints currently allow latitude 38.75–39.55 and longitude 16.60–17.40. Coordinates outside this area return HTTP 403 with location_outside_crotone_area. Forecasts use the Europe/Rome time zone.
Fresh-cache lifetimes are 10 minutes for weather, marine and alerts, and one hour for locality searches. Fallback data should be treated according to its stale flag and timestamps.
The alert zone is fixed: selecting another locality does not automatically select a different Civil Protection zone.
JavaScript controls
After the overlay has been enabled, the module exposes window.WindCrotone:
WindCrotone.setLocation('Crotone', 39.080884, 17.129137);
WindCrotone.setView('marine'); // 'weather', 'marine' or 'fishing'
WindCrotone.reload();        // Refresh weather and marine data
WindCrotone.hidePanel();
WindCrotone.showPanel();
console.log(WindCrotone.getState());
The registered Leaflet overlay is also available as window.windCrotoneLayer.
Adapting the project to other locations
Worldwide support is an extension goal, not an enabled feature of the current defaults. A regional adaptation should address:
1. The default location in JavaScript and both forecast endpoints.
2. The allowed-coordinate bounds and wind-grid spans in PHP, preserving request validation.
3. The Italian country restriction and belongsToCrotoneProvince() filter in the search endpoint.
4. Forecast time zones and browser date/time handling.
5. Marine model coverage and distance thresholds appropriate to the new coast.
6. A suitable official alert source and geographic-zone mapping. Cala-6 alerts must not be presented as alerts for unrelated locations.
7. Interface translations, provider limits and cache behavior under the expected traffic.
Troubleshooting
Symptom	Check
The overlay is missing	Load Leaflet first and expose window.map and window.layerControl before loading the module
CSS or JavaScript returns 404	Check deployment paths and the uppercase JS directory name
PHP source appears instead of JSON	Configure PHP execution on the server
server_dependency_missing	Enable PHP cURL and DOM/libxml for the alert endpoint
server_cache_unavailable	Create the alert-cache directory at the document root and grant PHP write access
location_outside_crotone_area	Use permitted coordinates or deliberately configure a different regional deployment
Search returns no results	Check the query and the province/country filter; the current search is regional
Marine data is unavailable	Inspect the available flag, grid distance and upstream model coverage
Upstream errors or stale data	Check outbound HTTPS, provider availability, access mode and cache timestamps


Data sources and attribution
- Open-Meteo Weather API, Marine API and Geocoding API.
- Dipartimento della Protezione Civile bulletin and DPC structured bulletin data.
- Leaflet for the map interface.
- OpenStreetMap for the tiles in the integration example.
Keep the relevant provider credits and comply with each service's terms and data licenses. Third-party libraries, map tiles and upstream data retain their respective licenses.
License and project origin
Licensed under the Apache License, Version 2.0. See LICENSE and the project-origin attribution in NOTICE.
When redistributing the software or derivative works, preserve the applicable license, copyright and attribution notices as required by Apache 2.0. Visible credit in a site's interface is appreciated; it is not an additional requirement of this license.
Original project: kursaal-meteo, developed for the Crotone Local Guide at Lido Kursaal.
Issues and improvements can be proposed through the repository. Include the relevant file, reproduction steps and runtime details; redact credentials and personal information from reports.
