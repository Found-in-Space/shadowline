# `@found-in-space/shadowline-astronomy-engine`

Find eclipses and supply the Sun and Moon positions used by Shadowline.

This is the astronomy helper for
[`@found-in-space/shadowline`](https://www.npmjs.com/package/@found-in-space/shadowline).
Together, the two packages power the open
[Found in Space](https://foundin.space/) eclipse project.

Want to explore before writing code? Open the
[12 August 2026 eclipse tracker](https://foundin.space/shadowline/tracker/202608/).

> [!WARNING]
> **This library is a very early alpha.** These examples work with the current
> release, but names, results, and the way the two packages fit together may
> change. It is intended for learning and experimentation, not yet for a
> project that requires a permanently stable API.

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

Using any plain-text editor, create a file named `find-eclipses.mjs` inside the
new `my-eclipse-project` folder:

```js
import { EclipseEngine } from "@found-in-space/shadowline";
import {
  astronomyEngineCapabilities,
} from "@found-in-space/shadowline-astronomy-engine";

const engine = new EclipseEngine(astronomyEngineCapabilities());
const events = engine.events({
  startUtc: "2026-01-01T00:00:00Z",
  endUtc: "2027-01-01T00:00:00Z",
});

for (const event of events) {
  console.log(`${event.peakUtc}: ${event.kind} solar eclipse`);
}
```

Run it:

```bash
node find-eclipses.mjs
```

You should see the two solar eclipses of 2026. The main Shadowline package can
then calculate their paths and turn them into map data.

## What does this package do?

`astronomyEngineCapabilities()` gives `EclipseEngine` three things it needs:

- positions of the Sun and Moon;
- a way to find solar eclipses between two dates; and
- local eclipse times for a chosen place.

For most projects, that function is the only part of this package you need.
The companion `@found-in-space/shadowline` package uses the supplied astronomy
to calculate shadow paths, visibility areas, GeoJSON, and KML.

## Ask what happens at one place

After the first example, add this code to find eclipses visible from Barcelona:

```js
const visible = engine.localEclipses(
  { latitudeDeg: 41.39, longitudeDeg: 2.17 },
  {
    startUtc: "2026-01-01T00:00:00Z",
    endUtc: "2027-01-01T00:00:00Z",
  },
);

for (const eclipse of visible) {
  console.log(`${eclipse.kind} eclipse`);
  console.log(`Maximum eclipse there: ${eclipse.peak.utc}`);
}
```

Latitude is positive north of the equator. Longitude is positive east of
Greenwich. Replace those two numbers to try another place.

## Reference for larger projects

The rest of this page describes the lower-level interface. You do not need it
to run the examples above.

`AstronomyEngineProvider` is the underlying provider. Advanced applications
can use it directly when they need an individual Sun or Moon position:

```js
import {
  AstronomyEngineProvider,
} from "@found-in-space/shadowline-astronomy-engine";

const provider = new AstronomyEngineProvider();
const sun = provider.stateVector(
  "sun",
  "2026-08-12T17:46:00Z",
  "geocentric-earth-fixed",
);

console.log(sun.frame);
console.log(sun.positionAu);
```

The returned vector records its time, reference frame, and position in
astronomical units. The provider can return geocentric, heliocentric, and
barycentric vectors; Earth-fixed geocentric vectors are the ones used by the
Shadowline geometry.

This package is the only Shadowline workspace package that depends on
[Astronomy Engine](https://github.com/cosinekitty/astronomy). It translates
Astronomy Engine's output into Shadowline's public interfaces. The main
Shadowline package remains responsible for shadow cones, surface paths,
visibility areas, local map data, GeoJSON, KML, and renderer state.

## Licence

MIT
