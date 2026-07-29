import { describe, expect, it } from "vitest";
import {
  geodeticToEcef,
  haversineDistanceKm,
  normalizeLongitude,
  type CentralPathSurface,
  type Position,
  type SurfacePoint,
  type TimedSurfacePoint,
} from "@found-in-space/shadowline";
import {
  densifyGlobeLine,
  globePathTriangles,
  GLOBE_PATH_FILL_ELEVATION_METRES,
  GLOBE_PATH_MESH_STEP_KM,
  type GlobePathTriangle,
} from "../apps/visualizer/src/globe-path-mesh.js";

const START_MS = Date.parse("2026-08-12T17:00:00Z");

function point(longitudeDeg: number, latitudeDeg: number): SurfacePoint {
  const geographic = { longitudeDeg, latitudeDeg };
  return { geographic, ecefKm: geodeticToEcef(geographic) };
}

function timed(
  longitudeDeg: number,
  latitudeDeg: number,
  seconds: number,
): TimedSurfacePoint {
  return {
    ...point(longitudeDeg, latitudeDeg),
    atUtc: new Date(START_MS + seconds * 1_000).toISOString(),
  };
}

const positive = [
  timed(-150, 78, 0),
  timed(-70, 84, 60),
  timed(20, 86, 120),
  timed(110, 80, 180),
];
const negative = [
  timed(-140, 72, 0),
  timed(-60, 77, 60),
  timed(30, 79, 120),
  timed(120, 74, 180),
];
const boundary = [
  ...positive,
  ...negative.toReversed(),
  positive[0]!,
];
const path: CentralPathSurface = {
  datum: "WGS 84",
  calculationFrame: "geocentric-earth-fixed",
  kind: "total",
  centralBeginUtc: positive[0]!.atUtc,
  centralEndUtc: positive.at(-1)!.atUtc,
  centerline: { points: [] },
  limits: {
    positiveCrossTrack: { points: positive },
    negativeCrossTrack: { points: negative },
  },
  startCap: { edges: [{ points: [] }, { points: [] }] },
  endCap: { edges: [{ points: [] }, { points: [] }] },
  boundary: { points: boundary, closed: true },
};
const triangles = globePathTriangles(path);

function vector([longitudeDeg, latitudeDeg]: Position) {
  const longitude = (longitudeDeg * Math.PI) / 180;
  const latitude = (latitudeDeg * Math.PI) / 180;
  const cosine = Math.cos(latitude);
  return {
    x: cosine * Math.cos(longitude),
    y: cosine * Math.sin(longitude),
    z: Math.sin(latitude),
  };
}

function areaSignal(triangle: GlobePathTriangle): number {
  const [first, second, third] = triangle.map(vector);
  const firstEdge = {
    x: second!.x - first!.x,
    y: second!.y - first!.y,
    z: second!.z - first!.z,
  };
  const secondEdge = {
    x: third!.x - first!.x,
    y: third!.y - first!.y,
    z: third!.z - first!.z,
  };
  return Math.hypot(
    firstEdge.y * secondEdge.z - firstEdge.z * secondEdge.y,
    firstEdge.z * secondEdge.x - firstEdge.x * secondEdge.z,
    firstEdge.x * secondEdge.y - firstEdge.y * secondEdge.x,
  );
}

function pointKey([longitude, latitude]: Position): string {
  const canonicalLongitude =
    Math.abs(Math.abs(longitude) - 180) < 1e-8
      ? 180
      : normalizeLongitude(longitude);
  return `${canonicalLongitude.toFixed(8)},${latitude.toFixed(8)}`;
}

function northPolarPoint(
  [longitudeDeg, latitudeDeg]: Position,
): [number, number] {
  const longitude = (longitudeDeg * Math.PI) / 180;
  const radius = 90 - latitudeDeg;
  return [
    radius * Math.sin(longitude),
    -radius * Math.cos(longitude),
  ];
}

function signedArea(points: Array<[number, number]>): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea / 2;
}

describe("structured globe path mesh", () => {
  it("densifies antimeridian-crossing lines without changing their route", () => {
    const source: Position[] = [
      [170, 75],
      [-170, 80],
    ];
    const dense = densifyGlobeLine(source);

    expect(dense[0]).toEqual(source[0]);
    expect(dense.at(-1)).toEqual(source[1]);
    for (let index = 1; index < dense.length; index += 1) {
      expect(
        haversineDistanceKm(dense[index - 1]!, dense[index]!),
      ).toBeLessThanOrEqual(GLOBE_PATH_MESH_STEP_KM + 1e-6);
    }
  });

  it("uses only bounded, non-degenerate local surface facets", () => {
    expect(triangles.length).toBeGreaterThan(20);
    expect(triangles.length).toBeLessThan(10_000);
    let maximumEdgeKm = 0;
    for (const triangle of triangles) {
      expect(areaSignal(triangle)).toBeGreaterThan(1e-13);
      for (let index = 0; index < 3; index += 1) {
        const edgeKm = haversineDistanceKm(
          triangle[index]!,
          triangle[(index + 1) % 3]!,
        );
        expect(Number.isFinite(edgeKm)).toBe(true);
        maximumEdgeKm = Math.max(maximumEdgeKm, edgeKm);
      }
    }
    expect(maximumEdgeKm).toBeLessThanOrEqual(
      2 * GLOBE_PATH_MESH_STEP_KM + 1e-6,
    );

    const displayRadiusKm = 6_371;
    const maximumAngle = maximumEdgeKm / displayRadiusKm;
    const maximumSagittaKm =
      displayRadiusKm * (1 - Math.cos(maximumAngle / 2));
    expect(GLOBE_PATH_FILL_ELEVATION_METRES / 1_000).toBeGreaterThan(
      4 * maximumSagittaKm,
    );
  });

  it("retains every physical boundary sample", () => {
    const meshVertices = new Set(triangles.flat().map(pointKey));
    for (const boundaryPoint of boundary.slice(0, -1)) {
      expect(
        meshVertices.has(pointKey([
          boundaryPoint.geographic.longitudeDeg,
          boundaryPoint.geographic.latitudeDeg,
        ])),
      ).toBe(true);
    }
  });

  it("covers the polar strip without folds", () => {
    const physicalRing = boundary
      .slice(0, -1)
      .map((sample) =>
        northPolarPoint([
          sample.geographic.longitudeDeg,
          sample.geographic.latitudeDeg,
        ]),
      );
    const physicalArea = Math.abs(signedArea(physicalRing));
    const meshArea = triangles.reduce(
      (sum, triangle) =>
        sum + Math.abs(signedArea(triangle.map(northPolarPoint))),
      0,
    );

    expect(meshArea / physicalArea).toBeGreaterThan(0.98);
    expect(meshArea / physicalArea).toBeLessThan(1.02);
  });
});
