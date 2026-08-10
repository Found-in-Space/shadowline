import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { feature as topologyFeature } from "topojson-client";
import { polygonGeometry } from "@found-in-space/shadowline";

const require = createRequire(import.meta.url);
const COUNTRIES_PATH = require.resolve("world-atlas/countries-50m.json");

function polygons(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function boundingBox(polygon) {
  const points = polygon.flat();
  return {
    west: Math.min(...points.map((point) => point[0])),
    east: Math.max(...points.map((point) => point[0])),
    south: Math.min(...points.map((point) => point[1])),
    north: Math.max(...points.map((point) => point[1])),
  };
}

function boxesIntersect(left, right) {
  return left.west <= right.east && left.east >= right.west &&
    left.south <= right.north && left.north >= right.south;
}

function orientation(left, middle, right) {
  const value = (middle[1] - left[1]) * (right[0] - middle[0]) -
    (middle[0] - left[0]) * (right[1] - middle[1]);
  if (Math.abs(value) < 1e-10) return 0;
  return value > 0 ? 1 : 2;
}

function pointOnSegment(point, start, end) {
  return point[0] <= Math.max(start[0], end[0]) + 1e-10 &&
    point[0] >= Math.min(start[0], end[0]) - 1e-10 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-10 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-10 &&
    orientation(start, point, end) === 0;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstSecondStart = orientation(firstStart, firstEnd, secondStart);
  const firstSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondFirstStart = orientation(secondStart, secondEnd, firstStart);
  const secondFirstEnd = orientation(secondStart, secondEnd, firstEnd);

  if (firstSecondStart !== firstSecondEnd &&
      secondFirstStart !== secondFirstEnd) {
    return true;
  }
  return (firstSecondStart === 0 &&
      pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (firstSecondEnd === 0 && pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (secondFirstStart === 0 &&
      pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (secondFirstEnd === 0 && pointOnSegment(firstEnd, secondStart, secondEnd));
}

function ringSegments(ring) {
  if (ring.length < 2) return [];
  const closed = ring[0][0] === ring.at(-1)[0] &&
    ring[0][1] === ring.at(-1)[1];
  const segments = [];
  for (let index = 1; index < ring.length; index += 1) {
    segments.push([ring[index - 1], ring[index]]);
  }
  if (!closed) segments.push([ring.at(-1), ring[0]]);
  return segments;
}

function ringsIntersect(left, right) {
  const leftSegments = ringSegments(left);
  const rightSegments = ringSegments(right);
  return leftSegments.some(([leftStart, leftEnd]) =>
    rightSegments.some(([rightStart, rightEnd]) =>
      segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd),
    ),
  );
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    const crossesLatitude = (currentPoint[1] > point[1]) !==
      (previousPoint[1] > point[1]);
    const crossingLongitude = ((previousPoint[0] - currentPoint[0]) *
      (point[1] - currentPoint[1])) /
      (previousPoint[1] - currentPoint[1]) + currentPoint[0];
    if (crossesLatitude && point[0] < crossingLongitude) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function polygonsIntersect(left, right) {
  if (!boxesIntersect(boundingBox(left), boundingBox(right))) return false;
  if (left.some((leftRing) =>
    right.some((rightRing) => ringsIntersect(leftRing, rightRing)))) {
    return true;
  }
  return pointInPolygon(left[0][0], right) ||
    pointInPolygon(right[0][0], left);
}

export function countryNamesForShadow(boundaries, countryFeatures) {
  const shadowPolygons = boundaries.flatMap((boundaryPoints) => {
    const geometry = polygonGeometry(
      boundaryPoints.map((point) => [
        point.geographic.longitudeDeg,
        point.geographic.latitudeDeg,
      ]),
    );
    return polygons(geometry);
  });

  return countryFeatures
    .filter((country) => {
      const countryPolygons = polygons(country.geometry);
      return shadowPolygons.some((shadowPolygon) =>
        countryPolygons.some((countryPolygon) =>
          polygonsIntersect(shadowPolygon, countryPolygon),
        ),
      );
    })
    .map((country) => country.properties?.name)
    .filter((name) => typeof name === "string" && name.length > 0)
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function countryNamesForTrack(boundaryPoints, countryFeatures) {
  return countryNamesForShadow([boundaryPoints], countryFeatures);
}

export async function loadCountryFeatures() {
  const topology = JSON.parse(await readFile(COUNTRIES_PATH, "utf8"));
  const collection = topologyFeature(topology, topology.objects.countries);
  return collection.features;
}

export const countryDataset = {
  package: "world-atlas",
  version: "2.0.2",
  resolution: "1:50m",
};
