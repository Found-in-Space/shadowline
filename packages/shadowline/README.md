# `@found-in-space/shadowline`

Find solar eclipses, calculate the Moon's shadow on Earth, and turn the result
into data for a map.

This is the main Shadowline library. It is part of
[Found in Space](https://foundin.space/), an open educational project that
helps people explore scientific views, question how they were made, and build
with the data and code behind them.

Want to explore before writing code? Open the
[12 August 2026 eclipse tracker](https://foundin.space/shadowline/tracker/202608/).

> [!WARNING]
> **This library is a very early alpha.** These examples work with the current
> release, but names, results, and saved-file formats may change. It is a good
> fit for learning and experimentation, but not yet for a project that requires
> a permanently stable API.

## Run a first example

You need [Node.js 22 or later](https://nodejs.org/). A terminal is the app where
you type commands: Terminal on macOS or Linux, or PowerShell on Windows. The
Node.js installer includes `npm`, the tool used below to install the libraries.

Type these commands one at a time:

```bash
mkdir my-eclipse-project
cd my-eclipse-project
npm init -y
npm install @found-in-space/shadowline@alpha @found-in-space/shadowline-astronomy-engine@alpha
```

The `@alpha` part tells npm to install the version used by this documentation.

Using any plain-text editor, create a file named `eclipse.mjs` inside the new
`my-eclipse-project` folder:

```js
import {
  EclipseEngine,
  toGeoJson,
} from "@found-in-space/shadowline";
import {
  astronomyEngineCapabilities,
} from "@found-in-space/shadowline-astronomy-engine";

const engine = new EclipseEngine(astronomyEngineCapabilities());
const event = engine.events({
  startUtc: "2026-08-01T00:00:00Z",
  endUtc: "2026-09-01T00:00:00Z",
})[0];

if (!event) throw new Error("No eclipse found in that date range.");

const scene = engine.calculateEvent(event, {
  centralPath: true,
  globalVisibility: true,
  instantaneousAtUtc: [event.peakUtc],
});
const geoJson = toGeoJson(scene);

console.log(`Found: ${event.id}`);
console.log(`Greatest eclipse: ${event.peakUtc}`);
console.log(`Map features created: ${geoJson.features.length}`);
```

Run it:

```bash
node eclipse.mjs
```

You should see the 12 August 2026 total solar eclipse and a count of the map
features that were calculated.

## What are the two packages for?

Most people should install both:

- `@found-in-space/shadowline` calculates paths, shadows, and map data.
- `@found-in-space/shadowline-astronomy-engine` supplies the positions of the
  Sun and Moon, finds eclipses, and calculates local eclipse times.

Keeping them separate means that a more advanced project can use a different
source of astronomical positions without replacing the geometry or map code.

## Ask about a location

After the first example has found `event`, ask what happens at one place:

```js
const observer = {
  latitudeDeg: 41.8167,
  longitudeDeg: -3.185,
};
const local = engine.localCircumstances(event, observer);

if (local) {
  console.log(`Eclipse begins: ${local.partialBegin.utc}`);
  console.log(`Maximum eclipse: ${local.peak.utc}`);
  console.log(`Eclipse ends: ${local.partialEnd.utc}`);
} else {
  console.log("This eclipse is not visible from that location.");
}
```

Latitude is positive north of the equator. Longitude is positive east of
Greenwich. `elevationMeters` can also be added when it is known.

## Use the result on a map

`toGeoJson(scene)` creates [GeoJSON](https://geojson.org/), a common map-data
format. Leaflet, MapLibre, OpenLayers, QGIS, Folium, and many other tools can
read it.

Most online street maps use a flat map shape called Web Mercator. For one of
those maps, you can ask Shadowline to split shapes at the map edge and clip the
polar area that the map cannot show:

```js
const webMap = toGeoJson(scene, {
  seam: "split",
  latitudeClipDeg: 85.051128,
});
```

The checked-in
[`examples/leaflet-scenes.ts`](examples/leaflet-scenes.ts) shows one central
eclipse and one partial eclipse in Leaflet. Install Leaflet separately when you
want to run it:

```bash
npm install leaflet
npm install --save-dev @types/leaflet
```

The page that uses the example needs a visible, sized element with `id="map"`.

## Main methods

`EclipseEngine` is the main entry point:

| Method | What it answers |
|---|---|
| `events(range)` | Which eclipses happen between two dates? |
| `eventsForYear(year)` | Which eclipses happen in one year? |
| `localEclipses(observer, range)` | Which eclipses are visible from one place? |
| `localCircumstances(event, observer)` | When does one eclipse begin, peak, and end there? |
| `calculateEvent(event, options)` | What is the complete path, visibility area, and selected shadow? |
| `calculateInstantaneousShadow(event, utc)` | Where is the shadow at one instant? |

Advanced applications can also call `calculateCentralPath()`,
`calculateGlobalContacts()`, `calculateGlobalVisibility()`, and
`calculateTimeMarkers()` separately.

## What is an `EclipseScene`?

`calculateEvent()` returns an `EclipseScene`: one renderer-independent result
that a Canvas, SVG, flat map, globe, GIS application, or future XR view can use.
It can contain:

- the centreline and limits of a central eclipse;
- the wider area where a partial eclipse is visible;
- the shadow at caller-selected times;
- global contact points; and
- optional time markers.

The physical surface points are stored as WGS 84 Earth-fixed Cartesian
coordinates in kilometres. Longitude and latitude are also included for
convenience. Partial-only eclipses have no central path, but still include their
complete partial-visibility and shadow data.

## Saving data

Use `toGeoJson(scene, options)`, `GeoJsonExporter`, or `KmlExporter` when data
needs to leave the calculation library. GeoJSON and KML are derived views of
the physical scene; the scene remains the source of truth.

## Using another astronomy provider

This is an advanced extension point; most users can ignore it.

Construct `EclipseEngine` with an `EclipseCapabilities` object. Geometry needs
an `EarthFixedEphemeris`, which supplies Earth-fixed Sun and Moon positions.
Eclipse search and observer circumstances are optional capabilities. A method
that needs a missing capability throws `EclipseCapabilityError`.

This boundary keeps the astronomy model independent from geometry,
serialization, and rendering.

## Scientific boundary

Shadowline calculates smooth-limb, planning-grade eclipse geometry on WGS 84.
It does not include local terrain horizons or the mountains and valleys on the
Moon. Read the root project's
[accuracy and validation notes](https://github.com/Found-in-Space/shadowline#accuracy-and-validation)
before using results where seconds or kilometres matter.

## Licence

MIT
