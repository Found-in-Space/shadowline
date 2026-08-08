import { describe, expect, it } from "vitest";
import type { SolarDiscGeometry } from "../apps/visualizer/src/tracker-astronomy.js";
import { solarPreviewLayout } from "../apps/visualizer/src/tracker-solar-preview.js";

function geometry(overrides: Partial<SolarDiscGeometry> = {}): SolarDiscGeometry {
  return {
    sunRadiusDeg: 0.266,
    moonRadiusDeg: 0.273,
    eastOffsetDeg: 0,
    northOffsetDeg: 0,
    horizontalOffsetDeg: 0,
    verticalOffsetDeg: 0,
    separationDeg: 0.15,
    obscuration: 0.58,
    sunAltitudeDeg: 12,
    sunAzimuthDeg: 270,
    ...overrides,
  };
}

describe("tracker solar preview composition", () => {
  it("keeps a high Sun centred with the horizon outside the view", () => {
    const layout = solarPreviewLayout(geometry(), 142, 142);

    expect(layout.sunY).toBeCloseTo(142 * 0.46);
    expect(layout.horizonY).toBeGreaterThan(142);
    expect(layout.groundVisible).toBe(false);
    expect(layout.directSunVisible).toBe(true);
  });

  it("clips the direct Sun while retaining atmospheric light at sunset", () => {
    const layout = solarPreviewLayout(
      geometry({ sunAltitudeDeg: -0.3, obscuration: 0.8 }),
      142,
      142,
    );

    expect(layout.groundVisible).toBe(true);
    expect(layout.directSunVisible).toBe(false);
    expect(layout.atmosphericGlowOpacity).toBeGreaterThan(0);
    expect(layout.horizonY).toBeGreaterThan(0);
    expect(layout.horizonY).toBeLessThan(142);
  });

  it("removes twilight glow when the Sun is well below the horizon", () => {
    const layout = solarPreviewLayout(
      geometry({ sunAltitudeDeg: -8 }),
      142,
      142,
    );

    expect(layout.directSunVisible).toBe(false);
    expect(layout.atmosphericGlowOpacity).toBe(0);
    expect(layout.groundVisible).toBe(true);
  });

  it("recognises totality independently from obscuration rounding", () => {
    const layout = solarPreviewLayout(
      geometry({
        moonRadiusDeg: 0.28,
        separationDeg: 0.004,
        obscuration: 1,
      }),
      142,
      142,
    );

    expect(layout.totality).toBeGreaterThan(0.9);
    expect(layout.eclipseDim).toBe(1);
  });

  it("does not add a totality corona to a deep partial eclipse", () => {
    const layout = solarPreviewLayout(
      geometry({
        moonRadiusDeg: 0.28,
        separationDeg: 0.08,
        obscuration: 0.99,
      }),
      142,
      142,
    );

    expect(layout.totality).toBe(0);
  });
});
