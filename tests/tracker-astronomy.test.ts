import * as Astronomy from "astronomy-engine";
import { afterEach, describe, expect, it } from "vitest";
import { EclipseEngine } from "@found-in-space/shadowline";
import {
  AstronomyEngineProvider,
  astronomyEngineCapabilities,
} from "@found-in-space/shadowline-astronomy-engine";
import {
  circleOverlapFraction,
  configureOperationalDeltaT202608,
  solarDiscGeometry,
  solarHorizonGeometry,
} from "../apps/visualizer/src/tracker-astronomy.js";

const astronomyNamespace = Astronomy as unknown as Record<string, unknown>;
const AstronomyRuntime = (
  typeof astronomyNamespace["SetDeltaTFunction"] === "function"
    ? astronomyNamespace
    : astronomyNamespace["default"]
) as typeof Astronomy;

afterEach(() => {
  AstronomyRuntime.SetDeltaTFunction(AstronomyRuntime.DeltaT_EspenakMeeus);
});

describe("tracker solar-disc geometry", () => {
  it("calculates the limiting circle-overlap cases", () => {
    expect(circleOverlapFraction(1, 1, 2)).toBe(0);
    expect(circleOverlapFraction(2, 1, 0)).toBe(1);
    expect(circleOverlapFraction(0.5, 1, 0)).toBeCloseTo(0.25, 12);
    expect(circleOverlapFraction(1, 1, 1)).toBeCloseTo(
      0.3910022189557707,
      12,
    );
  });

  it("moves the horizon edge progressively across the solar disc", () => {
    expect(solarHorizonGeometry(0.5, 0.25)).toEqual({
      state: "above",
      edgePositionPercent: 100,
    });
    expect(solarHorizonGeometry(0.125, 0.25)).toEqual({
      state: "crossing",
      edgePositionPercent: 75,
    });
    expect(solarHorizonGeometry(0, 0.25)).toEqual({
      state: "crossing",
      edgePositionPercent: 50,
    });
    expect(solarHorizonGeometry(-0.125, 0.25)).toEqual({
      state: "crossing",
      edgePositionPercent: 25,
    });
    expect(solarHorizonGeometry(-0.5, 0.25)).toEqual({
      state: "below",
      edgePositionPercent: 0,
    });
  });

  it("shows totality near the 2026 centre line", () => {
    const result = solarDiscGeometry(
      {
        latitudeDeg: 65.1411,
        longitudeDeg: -25.3272,
        elevationMeters: 0,
      },
      new Date("2026-08-12T17:46:00Z"),
    );

    expect(result.obscuration).toBeGreaterThan(0.99);
    expect(result.separationDeg).toBeLessThan(
      result.moonRadiusDeg - result.sunRadiusDeg,
    );
    expect(result.sunAltitudeDeg).toBeGreaterThan(10);
  });

  it("keeps operational local contacts close to the published NASA checkpoint", () => {
    configureOperationalDeltaT202608();
    const provider = new AstronomyEngineProvider();
    const engine = new EclipseEngine(astronomyEngineCapabilities(provider));
    const event = engine
      .events({
        startUtc: "2026-08-12T00:00:00Z",
        endUtc: "2026-08-13T00:00:00Z",
      })
      .find((candidate) => candidate.id === "solar-2026-08-12-total");
    if (!event) throw new Error("The August 2026 eclipse was not found.");

    const local = engine.localCircumstances(event, {
      latitudeDeg: 65.225,
      longitudeDeg: -25.228333,
      elevationMeters: 0,
    });
    if (!local?.centralBegin || !local.centralEnd) {
      throw new Error("Expected totality at the NASA greatest-eclipse checkpoint.");
    }

    // NASA GSFC's published calculator uses its 75.4 s Besselian ΔT, while
    // the tracker uses the current IERS-derived 69.1734 s value. Even with
    // that intentional difference, every smooth-limb contact remains close.
    // https://eclipse.gsfc.nasa.gov/SEsearch/SEsearchmap.php?Ecl=20260812
    const checkpoints = [
      [local.partialBegin.utc, "2026-08-12T16:43:45.0Z"],
      [local.centralBegin.utc, "2026-08-12T17:44:40.8Z"],
      [local.peak.utc, "2026-08-12T17:45:50.0Z"],
      [local.centralEnd.utc, "2026-08-12T17:46:59.0Z"],
      [local.partialEnd.utc, "2026-08-12T18:45:18.4Z"],
    ] as const;
    for (const [actual, expected] of checkpoints) {
      expect(Math.abs(Date.parse(actual) - Date.parse(expected)) / 1000).toBeLessThan(5);
    }
  });
});
