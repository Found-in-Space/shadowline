import { describe, expect, it } from "vitest";
import {
  calculateTrackViewport,
  minimumLongitudeArc,
  projectGeographicPoint,
} from "../scripts/tracker-card-geometry.mjs";

describe("tracker card geometry", () => {
  it("uses the short longitude arc across the antimeridian", () => {
    const arc = minimumLongitudeArc([170, 178, -179, -174]);
    expect(arc.span).toBeCloseTo(16);
  });

  it("adds useful absolute padding around a very short polar track", () => {
    const viewport = calculateTrackViewport([
      { longitudeDeg: 12, latitudeDeg: -82 },
      { longitudeDeg: 14, latitudeDeg: -80 },
    ]);
    expect(viewport.east - viewport.west).toBeGreaterThanOrEqual(30);
    expect(viewport.north - viewport.south).toBeGreaterThanOrEqual(24);
    expect(viewport.south).toBeGreaterThanOrEqual(-90);
    expect(viewport.north).toBeLessThanOrEqual(90);
  });

  it("projects every input point inside the padded output", () => {
    const points = [
      { longitudeDeg: 168, latitudeDeg: 72 },
      { longitudeDeg: -176, latitudeDeg: 78 },
      { longitudeDeg: -158, latitudeDeg: 69 },
    ];
    const viewport = calculateTrackViewport(points);
    for (const point of points) {
      const projected = projectGeographicPoint(point, viewport, 1200, 630);
      expect(projected.x).toBeGreaterThan(0);
      expect(projected.x).toBeLessThan(1200);
      expect(projected.y).toBeGreaterThan(0);
      expect(projected.y).toBeLessThan(630);
    }
  });
});
