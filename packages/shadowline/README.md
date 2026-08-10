# `@found-in-space/shadowline`

Find solar eclipses, calculate the Moon's shadow on Earth, and export the
result as map data. This is the main library behind the
[Found in Space eclipse tracker](https://foundin.space/shadowline/tracker/202608/).

> [!WARNING]
> **Very early alpha.** APIs, results, and file formats are likely to change.
> Use this release for learning and experimentation, not yet as a stable
> production dependency.

## Install

Node.js 22 or later is required.

```bash
npm install @found-in-space/shadowline@alpha @found-in-space/shadowline-astronomy-engine@alpha
```

The astronomy package finds eclipses and supplies the Sun and Moon positions
used by the geometry package.

## Example

```js
import { EclipseEngine, toGeoJson } from "@found-in-space/shadowline";
import { astronomyEngineCapabilities } from "@found-in-space/shadowline-astronomy-engine";

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

console.log(event);
console.log(`Map features: ${geoJson.features.length}`);
```

Save this as `eclipse.mjs` and run `node eclipse.mjs`.

## Common tasks

Ask what happens at one location:

```js
const local = engine.localCircumstances(event, {
  latitudeDeg: 41.8167,
  longitudeDeg: -3.185,
});
```

Prepare the result for a Web Mercator map:

```js
const webMap = toGeoJson(scene, {
  seam: "split",
  latitudeClipDeg: 85.051128,
});
```

See [`examples/leaflet-scenes.ts`](examples/leaflet-scenes.ts) for a Leaflet
example.

## API

| Method | Result |
|---|---|
| `events(range)` | Eclipses between two dates |
| `eventsForYear(year)` | Eclipses in one year |
| `localEclipses(observer, range)` | Eclipses visible from one place |
| `localCircumstances(event, observer)` | Local begin, peak, and end times |
| `calculateEvent(event, options)` | Complete path, visibility area, and selected shadow |
| `calculateInstantaneousShadow(event, utc)` | Shadow at one instant |

`calculateEvent()` returns an `EclipseScene`. Its physical surface positions
are WGS 84 Earth-fixed Cartesian coordinates in kilometres, with longitude and
latitude included for convenience. `toGeoJson`, `GeoJsonExporter`, and
`KmlExporter` create portable output.

Applications can supply another `EclipseCapabilities` implementation instead
of the Astronomy Engine adapter. Geometry requires an `EarthFixedEphemeris`;
eclipse search and observer circumstances are optional.

## Accuracy

Shadowline is a planning-grade, smooth-limb model. It excludes local terrain
horizons and lunar limb topography. See the project's
[accuracy and validation notes](https://github.com/Found-in-Space/shadowline#accuracy-and-validation)
before using results where seconds or kilometres matter.

## Licence

MIT
