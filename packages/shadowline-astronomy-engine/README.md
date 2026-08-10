# `@found-in-space/shadowline-astronomy-engine`

Astronomy Engine integration for
[`@found-in-space/shadowline`](https://www.npmjs.com/package/@found-in-space/shadowline).
It finds eclipses, supplies Sun and Moon positions, and calculates local
eclipse times.

> [!WARNING]
> **Very early alpha.** APIs and results are likely to change. Use this release
> for learning and experimentation, not yet as a stable production dependency.

## Install

```bash
npm install @found-in-space/shadowline@alpha @found-in-space/shadowline-astronomy-engine@alpha
```

## Example

```js
import { EclipseEngine } from "@found-in-space/shadowline";
import { astronomyEngineCapabilities } from "@found-in-space/shadowline-astronomy-engine";

const engine = new EclipseEngine(astronomyEngineCapabilities());
const events = engine.events({
  startUtc: "2026-01-01T00:00:00Z",
  endUtc: "2027-01-01T00:00:00Z",
});

for (const event of events) {
  console.log(`${event.peakUtc}: ${event.kind} solar eclipse`);
}
```

For most applications, `astronomyEngineCapabilities()` is the only export from
this package that you need. It gives `EclipseEngine` eclipse search, Sun and
Moon positions, and local circumstances.

## Direct provider access

Advanced applications can use `AstronomyEngineProvider` directly:

```js
import { AstronomyEngineProvider } from "@found-in-space/shadowline-astronomy-engine";

const provider = new AstronomyEngineProvider();
const sun = provider.stateVector(
  "sun",
  "2026-08-12T17:46:00Z",
  "geocentric-earth-fixed",
);

console.log(sun.positionAu);
```

The main Shadowline package remains responsible for shadow paths, visibility
areas, GeoJSON, and KML.

## Licence

MIT
