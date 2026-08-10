# Found in Space — Shadowline

Part of [Found in Space](https://foundin.space/), a project that turns real
astronomical measurements into interactive explorations. See all repositories
at [github.com/Found-in-Space](https://github.com/Found-in-Space).

Shadowline is a renderer-independent solar-eclipse toolkit with a browser-native
planning application. It calculates complete central tracks, reports
circumstances for an observer, and exports portable GeoJSON or KML. The
visualizer discovers events on demand through the selected search provider.

Canonical geometry is global and retains the full WGS 84 track, including
polar coordinates. Projection-specific display changes happen only inside the
visualizer's independent map renderers.

Like the other Found in Space toolkits, Shadowline is package-first: the
reusable geometry and ephemeris integration live in focused
`@found-in-space/*` packages, while the visualizer is an application that
consumes their public APIs.

## Install

Install the renderer-independent geometry package with the companion Astronomy
Engine capability provider:

```bash
npm install @found-in-space/shadowline \
  @found-in-space/shadowline-astronomy-engine
```

Applications with their own Earth-fixed Sun and Moon ephemerides need only
`@found-in-space/shadowline`.

## Architecture

```text
@found-in-space/shadowline
  dependency-free geometry, discovery facade, and GIS exporters
            │
            ├── @found-in-space/shadowline-astronomy-engine
            │     ephemerides, eclipse search, and observer circumstances
            │
            └── apps/visualizer
                  Vanilla TypeScript, Vite, Leaflet, MapLibre,
                  OpenStreetMap, and NASA GIBS
```

`@found-in-space/shadowline` owns the public model and accepts separate
Earth-fixed ephemeris, eclipse-search, and observer-circumstances
capabilities. Geometry requires only the ephemeris capability. Astronomy
Engine is isolated in a separate adapter so a future foundin.space native
provider can replace any capability without changing the geometry, exporter,
or application APIs.

## Development

Node.js 22 or later is the only requirement for package and visualizer
development:

```bash
npm install
npm run dev          # Vite dev server → http://127.0.0.1:5173/
npm run typecheck    # workspace and tool TypeScript contracts
npm test             # fast sandbox-friendly regression tests
npm run test:validation # slower scientific reference/path validation
npm run build        # packages and production visualizer
npm run test:browser # Playwright application scenarios
```

The default Vitest suite resolves workspace packages directly to source and
enforces a two-second ceiling per test and setup hook. Full eclipse-path,
historical, and published-reference checks live in the separately invoked
`test:validation` tier so they cannot make the sandbox-oriented unit command
unreliable.

Open `http://127.0.0.1:5173` for the Shadowline project introduction, or
`http://127.0.0.1:5173/browse/` for the eclipse explorer. The application and
eclipse calculations run locally. Standard OpenStreetMap raster tiles are
requested over the network for the two interactive top views, and the fixed
whole-Earth view requests NASA Blue Marble imagery from GIBS's cacheable
geographic WMTS service.

The 2026 eclipse tracker also has a location-fixed Ground view. Elevation tiles
are requested directly from Mapterhorn. To add MapTiler Satellite photography,
copy `apps/visualizer/.env.example` to `apps/visualizer/.env.local` and set
`VITE_MAPTILER_KEY`. A complete direct XYZ template and attribution can be
configured instead. These requests are made by the browser directly to the
providers; Shadowline does not use a tile proxy.

The GitHub Pages workflow reads the complete production imagery configuration
from repository-level GitHub Actions variables named
`VITE_GROUND_IMAGERY_XYZ_TEMPLATE`, `VITE_GROUND_IMAGERY_ATTRIBUTION`,
`VITE_GROUND_IMAGERY_TILE_SIZE`, and `VITE_GROUND_IMAGERY_MAX_ZOOM`. These are
configuration variables rather than secrets because Vite embeds them in the
public browser bundle. Restrict any provider token contained in the template to
the deployed site's origin and apply an appropriate usage limit at the
provider.

The production output is written to `dist/site`. The equivalent convenience
commands are available through [`just`](https://just.systems/):

```bash
just setup
just validate
```

### Tracker artwork pipeline

Tracker artwork starts with a deterministic, headless PNG rather than a
browser screenshot. For total and annular eclipses, the script renders the
complete central-path boundary and centreline. For partial eclipses, it renders
the penumbral shadow at global peak. It finds the smallest antimeridian-safe
crop with padding and draws that geometry over the bundled Blue Marble.

The pipeline intersects the rendered shadow with a pinned offline
country-boundary dataset, then gives OpenAI's image editor exactly three
creative elements: the authoritative shadow PNG, one transparent Robot PNG,
and the country/territory list. The date and eclipse type are supplied as
facts. The shadow PNG is a locked scientific base plate: projection,
coastlines, islands, crop, and eclipse geometry must remain unchanged. The
model may add one restrained visual joke without obscuring or reinterpreting
that geography.

All dated tracker routes use one shared page template, stylesheet and runtime.
The three total-eclipse trackers for 2026–2028 are defined only by the event
records in `apps/visualizer/tracker/events.json`; their dated HTML pages and web
app manifests are generated automatically before development and production
builds.

Generate and inspect only the reproducible scientific inputs:

```bash
npm run generate:tracker-card -- \
  --event solar-2026-08-12-total \
  --base-only
```

Run the complete pipeline after setting `OPENAI_API_KEY`:

```bash
OPENAI_API_KEY=... npm run generate:tracker-card -- \
  --event solar-2026-08-12-total
```

Use `--robot <path-to-png>` to override the single Robot reference. The model
may still place one or several instances of The Robot in its imagined scene.

Outputs are written beneath `dist/tracker-cards/<event-id>/`: the authoritative
`shadow-base.png`, the normalized Robot reference, exact `prompt.txt`, a
hash-bearing `manifest.json`, and (for a complete run) `card.png`. Run with
`--help` to override the source PNGs, output directory, model, or quality.

## Visualisation testbed

The explorer deliberately presents four complementary views of the same
eclipse:

| Panel | Renderer | View and purpose |
|---|---|---|
| Top left | Leaflet | Web Mercator OpenStreetMap planning view |
| Top right | Three.js | Spacefarer physical Earth–Moon and shadow-cone view |
| Bottom left | Leaflet | Fixed EPSG:4326/equirectangular NASA whole-Earth view |
| Bottom right | Canvas | Local terrain and sky view for the selected observer |

The two surface maps receive the same `EclipseScene`. ECEF WGS 84 points and
their physical curve/region topology are canonical; longitude/latitude is a
derived convenience on each point. Each flat renderer calls `toGeoJson` with
its own seam and latitude policy. The Mercator adapter selects an event-centred
display seam and clips at the Web Mercator latitude limit, while the whole-Earth
view retains the complete equirectangular extent. Clicking either map selects
one observer, updates both markers, and starts one local-circumstances
calculation. Layer visibility is shared between them.

Before a place is selected, Spacefarer evaluates the eclipse at global peak.
Selecting a point on either map moves all four views to that place’s local
maximum. The two maps and Spacefarer then show
the same instantaneous shadow footprint while the ground view shows the Sun at
that exact UTC instant. Earth, Moon, their separation, and both shadow cones
share one physical scale; the Sun is a distant celestial disc. Spacefarer
starts in the same Sun–Earth-plane framing as the tracker and keeps that frame
until the visitor deliberately moves the camera. The focused 2026 tracker
retains an interactive MapLibre globe alongside its map, shadow, and ground
tabs.

## Reproducible pipeline

The JavaScript dependency graph is recorded in `package-lock.json`. Eclipse
discovery is requested on demand through the selected provider.

```bash
just test           # type checks and unit/integration tests
just test-browser   # real-browser SPA tests
just validate       # complete deterministic validation
```

The visualizer queries only requested years and a short window for its next
eclipse list, then caches those results for the current browser session.

## Package API

```ts
import {
  EclipseEngine,
  GeoJsonExporter,
} from "@found-in-space/shadowline";
import {
  astronomyEngineCapabilities,
} from "@found-in-space/shadowline-astronomy-engine";

const engine = new EclipseEngine(astronomyEngineCapabilities());

const event = engine.events({
  startUtc: "2026-08-01T00:00:00Z",
  endUtc: "2026-09-01T00:00:00Z",
})[0];
if (!event) throw new Error("No eclipse found in the requested range.");

const scene = engine.calculateEvent(event, {
  centralPath: true,
  globalVisibility: true,
  instantaneousAtUtc: [event.peakUtc],
});
const download = new GeoJsonExporter().export(scene);

const observer = { latitudeDeg: 41.8167, longitudeDeg: -3.185 };
const localMaximum = engine.localCircumstances(event, observer);
const shadow = localMaximum
  ? engine.calculateInstantaneousShadow(event, localMaximum.peak.utc)
  : null;
```

A central-and-partial Leaflet example is checked in at
[`packages/shadowline/examples/leaflet-scenes.ts`](packages/shadowline/examples/leaflet-scenes.ts);
it is under 50 nonblank lines, uses only published APIs, and clips derived
display geometry at Web Mercator's latitude limit without changing the scene.

The public units are explicit:

- UTC instants are serializable ISO 8601 strings;
- canonical surface positions are Earth-fixed Cartesian kilometres on WGS 84;
- each surface point also includes derived longitude/latitude degrees;
- surface distances are kilometres;
- ephemeris positions are AU and velocities are AU/day;
- every state vector names its origin and reference frame.

Local searches accept an observer and a bounded range:

```ts
const local = engine.localEclipses(
  { latitudeDeg: 41.39, longitudeDeg: 2.17, elevationMeters: 20 },
  {
    startUtc: "2000-01-01T00:00:00Z",
    endUtc: "2100-01-01T00:00:00Z",
  },
);
```

The maximum local-search window is 200 years. When a map point is selected, the
SPA searches 50 years before and after the selected eclipse for nearby visible
events.

## Geometry and GIS

For total, annular and hybrid eclipses the engine:

1. obtains geocentric Sun and Moon state vectors;
2. transforms them into a rotating, geocentric Earth-fixed 3D frame;
3. constructs the umbral/antumbral shadow cone;
4. intersects exact cone generators with the implicit WGS 84 ellipsoid;
5. finds swept limits from `C = 0` and `∂C/∂t = 0` at fixed ECEF points;
6. transports a rotation-minimizing surface frame along the centreline;
7. labels limits by signed cross-track, not geographic north or south;
8. joins cone and solar-limb segments into explicit physical regions;
9. converts ECEF points to geodetic coordinates only for convenience; and
10. derives GeoJSON/KML later, with explicit seam and latitude-clip policy.

No path, contact, limb, or penumbral-limit calculation is performed in a map
projection. The core never sees Web Mercator coordinates. Its canonical
features can therefore retain the 2026 path through the high Arctic and can be
reprojected by a GIS or planar renderer. Central-path and global-visibility
results also expose projection-neutral `surface` models for a globe or future
XR scene. The Mercator Leaflet adapter alone derives a temporary
latitude-clipped display copy, rotates the complete geometry into one
event-centred Leaflet world, and then re-splits lines and polygons at that
display world's seam. The MapLibre globe meshes bounded local facets directly
between physical limit and cap samples and renders its vectors from unsplit,
unclipped geographic coordinates; it never triangulates the long serialized
polygon boundary or reuses a Web-Mercator-clamped display copy.

`toGeoJson(scene)` derives these interchange features:

| `feature_type` | Meaning |
|---|---|
| `central_path` | Total, annular, or hybrid central-eclipse polygon |
| `centerline` | Shadow-axis ground track |
| `positive_cross_track_limit` | Limit on the positive side of the transported frame |
| `negative_cross_track_limit` | Limit on the negative side of the transported frame |
| `time_marker` | Calculated UTC, solar angles, width, and centre duration |
| `instantaneous_umbra` | Umbra footprint at a caller-selected UTC instant |
| `instantaneous_antumbra` | Antumbra footprint at a caller-selected UTC instant |
| `instantaneous_penumbra` | Penumbra footprint at the same UTC instant |
| `penumbral_contact` | P1/P4 external and, when present, P2/P3 internal tangencies |
| `penumbra_horizon` | Eclipse-begins/ends-at-sunrise or sunset curve |
| `penumbra_extent` | Swept outer limit of partial-eclipse visibility |

Partial-only eclipses return `centralPath: null`, a complete penumbral
visibility surface, and instantaneous penumbra regions with `central: null`.
`calculateCentralPath`, `calculateGlobalVisibility`,
`calculateInstantaneousShadow`, and `calculateTimeMarkers` remain available as
granular advanced methods. None depends on Leaflet or another renderer.
Magnitude contours remain future work.

P1 and P4 are the first and last external tangencies of the penumbral cone with
Earth. P2 and P3 are the internal tangencies where the complete penumbral
footprint first fits, and last fits, on Earth; high-gamma and partial eclipses
do not always have them. The associated horizon curves are two closed loops
when both penumbral extent limits exist, or a connected figure-eight-style
curve otherwise.

GeoJSON and KML exporters are deterministic pure JavaScript implementations.
The `EclipseExporter` interface is the extension point for future GeoPackage
and Shapefile packages.

### Folium

Folium can consume the downloaded GeoJSON without an eclipse-specific adapter:

```python
import json
import folium

with open("solar-2026-08-12-total.geojson", encoding="utf-8") as source:
    eclipse = json.load(source)

map_ = folium.Map(location=[50, -10], zoom_start=3, tiles="OpenStreetMap")
folium.GeoJson(eclipse, name="Eclipse track").add_to(map_)
folium.LayerControl().add_to(map_)
map_.save("eclipse.html")
```

Leaflet, MapLibre, OpenLayers, Cesium, QGIS, Google Earth and other GIS clients
can use the same canonical output. A renderer may derive its own projection
view; it must not replace the canonical coordinates.

## Accuracy and validation

This is a **planning-grade, smooth-limb** model. Astronomy Engine uses a compact
VSOP87/NOVAS-derived ephemeris designed for approximately one-arcminute
astronomical accuracy. The path implementation is tested against NASA's WGS 84
table and MapLibre local-circumstances calculator for 12 August 2026:

- interior centre and limit checkpoints within 25 km;
- local C1/C2/maximum/C3/C4 contacts within 12 seconds at representative total
  and partial locations;
- maximum obscuration within 0.1 percentage point at those locations;
- local maximum within 10 seconds;
- central duration within 3 seconds;
- solar altitude and azimuth within 1 degree.

The local percentage is maximum obscuration, not obscuration at an arbitrary
instant. Observer elevation is supported when callers provide it, but the map
application currently selects sea-level locations. Neither an Earth terrain
model, a local terrain horizon, nor lunar limb topography is included. Lunar
mountains and valleys can move practical limits by kilometres and contact times
by several seconds.

Astronomy Engine's default Espenak–Meeus polynomial evaluates to ΔT ≈ 75.43 s
at the August 2026 eclipse. Shadowline does not fetch current IERS Earth
orientation data or override that default. A dated, operational prediction
should supply current Earth-orientation data through a provider when seconds or
kilometres matter; the default remains useful for deterministic planning and
comparison with NASA's published 75.4-second Besselian-element calculator.
Accuracy also degrades over long historical/future timescales as ΔT becomes
uncertain. The results are not suitable for surveying, safety-critical
navigation, or sub-second scientific prediction.

See `NOTICE.md` for source acknowledgements and third-party licences.

## Releases

The public packages use Changesets for versioning. See
[`docs/releasing.md`](docs/releasing.md) for validation, packed-consumer, and
publishing steps.

## Licence

Shadowline is available under the [MIT License](LICENSE). The visualizer's
deployed `THIRD_PARTY_LICENSES.txt` contains the complete notices required by
its bundled dependencies.

## Docs

- [`packages/shadowline/README.md`](packages/shadowline/README.md): core scene,
  geometry, and serialization APIs
- [`packages/shadowline-astronomy-engine/README.md`](packages/shadowline-astronomy-engine/README.md):
  Astronomy Engine capability adapter
- [`docs/releasing.md`](docs/releasing.md): package release procedure
- [`NOTICE.md`](NOTICE.md): data sources and third-party acknowledgements
