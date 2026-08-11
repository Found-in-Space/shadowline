import type { Observer } from "@found-in-space/shadowline";
import { solarDiscGeometry } from "./tracker-astronomy.js";

const EARTH_RADIUS_METRES = 6_371_008.8;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const MIN_TILE_ZOOM = 7;
const DEFAULT_MAX_TILE_ZOOM = 12;

export interface GroundTrackPosition {
  altitudeDeg: number;
  azimuthDeg: number;
}

export interface GroundCameraPlan {
  bearingDeg: number;
  pitchDeg: number;
  verticalFovDeg: number;
  horizontalFovDeg: number;
  farMetres: number;
}

export interface GroundTerrainTile {
  z: number;
  x: number;
  y: number;
  worldX: number;
  westDeg: number;
  eastDeg: number;
  northDeg: number;
  southDeg: number;
}

export interface GroundTerrainPlanOptions {
  maxZoom?: number;
  focalLengthPixels?: number;
  sourceTilePixels?: number;
}

export interface GroundTerrainVisibilityOptions {
  groundElevationMetres: number;
  elevationAt(latitudeDeg: number, longitudeDeg: number): number | null;
  maxTiles?: number;
  cameraHeightMetres?: number;
  horizonAngularStepDeg?: number;
  horizonDistanceSamples?: number;
  occlusionMarginDeg?: number;
}

export interface GroundTerrainRefinementPlan {
  tiles: GroundTerrainTile[];
  frustumCulled: number;
  occlusionCulled: number;
  budgetCulled: number;
}

interface GroundSurfacePoint {
  altitudeDeg: number;
  bearingDeg: number;
  distanceMetres: number;
}

interface GroundHorizonBin {
  distances: Float64Array;
  maximumAltitudeDeg: Float64Array;
}

interface GroundHorizonModel {
  bins: GroundHorizonBin[];
  halfFovDeg: number;
  bearingDeg: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

function degrees(value: number): number {
  return value * 180 / Math.PI;
}

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function signedAngularDifferenceDegrees(
  value: number,
  reference: number,
): number {
  return ((value - reference + 540) % 360) - 180;
}

export function groundTrackPositions(
  observer: Observer,
  startMs: number,
  endMs: number,
  sampleCount = 25,
): GroundTrackPosition[] {
  const count = Math.max(2, Math.floor(sampleCount));
  const duration = Math.max(1, endMs - startMs);
  return Array.from({ length: count }, (_, index) => {
    const atMs = startMs + duration * index / (count - 1);
    const geometry = solarDiscGeometry(observer, new Date(atMs));
    return {
      altitudeDeg: geometry.sunAltitudeDeg,
      azimuthDeg: geometry.sunAzimuthDeg,
    };
  });
}

export function groundCameraPlan(
  track: readonly GroundTrackPosition[],
  aspect: number,
): GroundCameraPlan {
  if (track.length === 0) {
    throw new RangeError("A ground camera needs at least one solar position.");
  }
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError("A ground camera needs a positive finite aspect ratio.");
  }

  const unwrappedAzimuths: number[] = [track[0]!.azimuthDeg];
  for (let index = 1; index < track.length; index += 1) {
    const previous = unwrappedAzimuths[index - 1]!;
    unwrappedAzimuths.push(
      previous + signedAngularDifferenceDegrees(track[index]!.azimuthDeg, previous),
    );
  }
  const minimumAzimuth = Math.min(...unwrappedAzimuths);
  const maximumAzimuth = Math.max(...unwrappedAzimuths);
  const minimumAltitude = Math.min(...track.map((position) => position.altitudeDeg));
  const maximumAltitude = Math.max(...track.map((position) => position.altitudeDeg));
  const minimumViewAltitude = Math.min(-5, minimumAltitude - 4);
  const maximumViewAltitude = Math.max(14, maximumAltitude + 5);
  const pitchDeg = (minimumViewAltitude + maximumViewAltitude) / 2;
  const trackVerticalFov = Math.max(36, maximumViewAltitude - minimumViewAltitude);
  const desiredHorizontalFov = clamp(
    Math.max(52, maximumAzimuth - minimumAzimuth + 14),
    52,
    112,
  );
  const horizontalVerticalFov = degrees(
    2 * Math.atan(Math.tan(radians(desiredHorizontalFov) / 2) / aspect),
  );
  const verticalFovDeg = clamp(
    Math.max(trackVerticalFov, horizontalVerticalFov),
    36,
    96,
  );
  const horizontalFovDeg = degrees(
    2 * Math.atan(Math.tan(radians(verticalFovDeg) / 2) * aspect),
  );

  return {
    bearingDeg: normalizedDegrees((minimumAzimuth + maximumAzimuth) / 2),
    pitchDeg,
    verticalFovDeg,
    horizontalFovDeg,
    farMetres: 120_000,
  };
}

function mercatorY(latitudeDeg: number, tileCount: number): number {
  const latitude = radians(clamp(
    latitudeDeg,
    -MAX_MERCATOR_LATITUDE,
    MAX_MERCATOR_LATITUDE,
  ));
  return (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * tileCount;
}

function latitudeForMercatorY(y: number, tileCount: number): number {
  return degrees(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / tileCount))));
}

function canonicalTileX(worldX: number, tileCount: number): number {
  return ((worldX % tileCount) + tileCount) % tileCount;
}

function terrainTile(z: number, worldX: number, y: number): GroundTerrainTile {
  const tileCount = 2 ** z;
  return {
    z,
    x: canonicalTileX(worldX, tileCount),
    y,
    worldX,
    westDeg: worldX / tileCount * 360 - 180,
    eastDeg: (worldX + 1) / tileCount * 360 - 180,
    northDeg: latitudeForMercatorY(y, tileCount),
    southDeg: latitudeForMercatorY(y + 1, tileCount),
  };
}

function tileLocalBounds(
  tile: GroundTerrainTile,
  observer: Observer,
): { minimumEast: number; maximumEast: number; minimumNorth: number; maximumNorth: number } {
  const longitudeScale = EARTH_RADIUS_METRES * Math.cos(radians(observer.latitudeDeg));
  const latitudeScale = EARTH_RADIUS_METRES;
  return {
    minimumEast: radians(tile.westDeg - observer.longitudeDeg) * longitudeScale,
    maximumEast: radians(tile.eastDeg - observer.longitudeDeg) * longitudeScale,
    minimumNorth: radians(tile.southDeg - observer.latitudeDeg) * latitudeScale,
    maximumNorth: radians(tile.northDeg - observer.latitudeDeg) * latitudeScale,
  };
}

function distanceToInterval(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return minimum - value;
  if (value > maximum) return value - maximum;
  return 0;
}

function tileMinimumDistanceMetres(
  tile: GroundTerrainTile,
  observer: Observer,
): number {
  const bounds = tileLocalBounds(tile, observer);
  return Math.hypot(
    distanceToInterval(0, bounds.minimumEast, bounds.maximumEast),
    distanceToInterval(0, bounds.minimumNorth, bounds.maximumNorth),
  );
}

function localSurfacePoint(
  observer: Observer,
  latitudeDeg: number,
  longitudeDeg: number,
  elevationMetres: number,
  groundElevationMetres: number,
  cameraHeightMetres: number,
): GroundSurfacePoint {
  const east = radians(signedAngularDifferenceDegrees(
    longitudeDeg,
    observer.longitudeDeg,
  )) * EARTH_RADIUS_METRES * Math.cos(radians(observer.latitudeDeg));
  const north = radians(latitudeDeg - observer.latitudeDeg) * EARTH_RADIUS_METRES;
  const distanceMetres = Math.hypot(east, north);
  const curvatureDrop = distanceMetres * distanceMetres /
    (2 * EARTH_RADIUS_METRES);
  return {
    altitudeDeg: degrees(Math.atan2(
      elevationMetres - groundElevationMetres - cameraHeightMetres - curvatureDrop,
      Math.max(0.01, distanceMetres),
    )),
    bearingDeg: normalizedDegrees(degrees(Math.atan2(east, north))),
    distanceMetres,
  };
}

function geographicPointAtDistance(
  observer: Observer,
  bearingDeg: number,
  distanceMetres: number,
): { latitudeDeg: number; longitudeDeg: number } {
  const bearing = radians(bearingDeg);
  const north = Math.cos(bearing) * distanceMetres;
  const east = Math.sin(bearing) * distanceMetres;
  const longitudeScale = Math.max(
    0.01,
    Math.cos(radians(observer.latitudeDeg)),
  );
  return {
    latitudeDeg: observer.latitudeDeg + degrees(north / EARTH_RADIUS_METRES),
    longitudeDeg: observer.longitudeDeg + degrees(
      east / (EARTH_RADIUS_METRES * longitudeScale),
    ),
  };
}

function logarithmicDistances(
  farMetres: number,
  sampleCount: number,
): Float64Array {
  const count = Math.max(16, Math.min(192, Math.floor(sampleCount)));
  const nearMetres = Math.min(80, farMetres / count);
  const logarithmicSpan = Math.log(Math.max(1, farMetres / nearMetres));
  return Float64Array.from({ length: count }, (_, index) =>
    nearMetres * Math.exp(logarithmicSpan * index / (count - 1))
  );
}

function groundHorizonModel(
  observer: Observer,
  camera: GroundCameraPlan,
  options: GroundTerrainVisibilityOptions,
): GroundHorizonModel {
  const halfFovDeg = camera.horizontalFovDeg / 2;
  const angularStepDeg = clamp(options.horizonAngularStepDeg ?? 0.75, 0.25, 2);
  const binCount = Math.max(
    2,
    Math.ceil(camera.horizontalFovDeg / angularStepDeg) + 1,
  );
  const distances = logarithmicDistances(
    camera.farMetres,
    options.horizonDistanceSamples ?? 80,
  );
  const cameraHeightMetres = options.cameraHeightMetres ?? 2;
  const bins = Array.from({ length: binCount }, (_, binIndex) => {
    const bearingDeg = normalizedDegrees(
      camera.bearingDeg - halfFovDeg +
        camera.horizontalFovDeg * binIndex / (binCount - 1),
    );
    const maximumAltitudeDeg = new Float64Array(distances.length);
    let maximum = -90;
    for (let index = 0; index < distances.length; index += 1) {
      const distanceMetres = distances[index]!;
      const point = geographicPointAtDistance(
        observer,
        bearingDeg,
        distanceMetres,
      );
      const elevationMetres = options.elevationAt(
        point.latitudeDeg,
        point.longitudeDeg,
      );
      if (elevationMetres !== null) {
        maximum = Math.max(
          maximum,
          localSurfacePoint(
            observer,
            point.latitudeDeg,
            point.longitudeDeg,
            elevationMetres,
            options.groundElevationMetres,
            cameraHeightMetres,
          ).altitudeDeg,
        );
      }
      maximumAltitudeDeg[index] = maximum;
    }
    return { distances, maximumAltitudeDeg };
  });
  return { bins, halfFovDeg, bearingDeg: camera.bearingDeg };
}

function maximumBeforeDistance(
  bin: GroundHorizonBin,
  distanceMetres: number,
): number | null {
  if (distanceMetres <= bin.distances[0]!) return null;
  let lower = 0;
  let upper = bin.distances.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (bin.distances[middle]! < distanceMetres) lower = middle + 1;
    else upper = middle;
  }
  if (lower === 0) return null;
  const value = bin.maximumAltitudeDeg[lower - 1]!;
  return value <= -89.999 ? null : value;
}

function horizonAltitudeDeg(
  model: GroundHorizonModel,
  bearingDeg: number,
  distanceMetres: number,
): number | null {
  const offsetDeg = signedAngularDifferenceDegrees(
    bearingDeg,
    model.bearingDeg,
  );
  const position = (offsetDeg + model.halfFovDeg) /
    (model.halfFovDeg * 2) * (model.bins.length - 1);
  if (position < 0 || position > model.bins.length - 1) return null;
  const westIndex = Math.max(0, Math.floor(position));
  const eastIndex = Math.min(model.bins.length - 1, Math.ceil(position));
  const west = maximumBeforeDistance(model.bins[westIndex]!, distanceMetres);
  const east = maximumBeforeDistance(model.bins[eastIndex]!, distanceMetres);
  if (west === null) return east;
  if (east === null) return west;
  return Math.max(west, east);
}

function tileVisibility(
  tile: GroundTerrainTile,
  observer: Observer,
  camera: GroundCameraPlan,
  model: GroundHorizonModel,
  options: GroundTerrainVisibilityOptions,
): "visible" | "frustum" | "occluded" {
  const bounds = tileLocalBounds(tile, observer);
  const tileSpanMetres = Math.max(
    bounds.maximumEast - bounds.minimumEast,
    bounds.maximumNorth - bounds.minimumNorth,
  );
  const minimumDistanceMetres = tileMinimumDistanceMetres(tile, observer);
  const occluderDistanceMetres = Math.max(
    0,
    minimumDistanceMetres - clamp(tileSpanMetres * 0.3, 80, 2_000),
  );
  const cameraHeightMetres = options.cameraHeightMetres ?? 2;
  const occlusionMarginDeg = options.occlusionMarginDeg ?? 0.45;
  const minimumAltitudeDeg = camera.pitchDeg - camera.verticalFovDeg / 2 - 0.75;
  const maximumAltitudeDeg = camera.pitchDeg + camera.verticalFovDeg / 2 + 0.75;
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  let hasKnownElevation = false;
  let intersectsFrustum = false;

  for (const rowFraction of fractions) {
    const latitudeDeg = latitudeForMercatorY(
      tile.y + rowFraction,
      2 ** tile.z,
    );
    for (const columnFraction of fractions) {
      const longitudeDeg = tile.westDeg +
        (tile.eastDeg - tile.westDeg) * columnFraction;
      const elevationMetres = options.elevationAt(latitudeDeg, longitudeDeg);
      if (elevationMetres === null) continue;
      hasKnownElevation = true;
      const point = localSurfacePoint(
        observer,
        latitudeDeg,
        longitudeDeg,
        elevationMetres,
        options.groundElevationMetres,
        cameraHeightMetres,
      );
      if (
        Math.abs(signedAngularDifferenceDegrees(
          point.bearingDeg,
          camera.bearingDeg,
        )) > camera.horizontalFovDeg / 2 + 0.75 ||
        point.altitudeDeg < minimumAltitudeDeg ||
        point.altitudeDeg > maximumAltitudeDeg
      ) continue;
      intersectsFrustum = true;
      if (minimumDistanceMetres < 350) return "visible";
      const horizon = horizonAltitudeDeg(
        model,
        point.bearingDeg,
        occluderDistanceMetres,
      );
      if (horizon === null || point.altitudeDeg >= horizon - occlusionMarginDeg) {
        return "visible";
      }
    }
  }
  if (!hasKnownElevation) return "visible";
  return intersectsFrustum ? "occluded" : "frustum";
}

/**
 * Uses the already-loaded coarse elevation surface to reject photographic
 * refinements that are outside the vertical camera frustum or hidden below a
 * nearer terrain horizon. Visible tiles are ordered from the observer outwards
 * and capped so a high-DPI canvas cannot create an unbounded texture fan-out.
 */
export function visibleGroundTerrainTiles(
  tiles: readonly GroundTerrainTile[],
  observer: Observer,
  camera: GroundCameraPlan,
  options: GroundTerrainVisibilityOptions,
): GroundTerrainRefinementPlan {
  const model = groundHorizonModel(observer, camera, options);
  const visible: GroundTerrainTile[] = [];
  let frustumCulled = 0;
  let occlusionCulled = 0;
  for (const tile of tiles) {
    const visibility = tileVisibility(tile, observer, camera, model, options);
    if (visibility === "visible") visible.push(tile);
    else if (visibility === "frustum") frustumCulled += 1;
    else occlusionCulled += 1;
  }
  visible.sort((first, second) => {
    const distance = tileMinimumDistanceMetres(first, observer) -
      tileMinimumDistanceMetres(second, observer);
    if (Math.abs(distance) > 0.1) return distance;
    const firstBounds = tileLocalBounds(first, observer);
    const secondBounds = tileLocalBounds(second, observer);
    const firstBearing = degrees(Math.atan2(
      firstBounds.minimumEast + firstBounds.maximumEast,
      firstBounds.minimumNorth + firstBounds.maximumNorth,
    ));
    const secondBearing = degrees(Math.atan2(
      secondBounds.minimumEast + secondBounds.maximumEast,
      secondBounds.minimumNorth + secondBounds.maximumNorth,
    ));
    return Math.abs(signedAngularDifferenceDegrees(firstBearing, camera.bearingDeg)) -
      Math.abs(signedAngularDifferenceDegrees(secondBearing, camera.bearingDeg));
  });
  const maximumTiles = Math.max(1, Math.floor(options.maxTiles ?? 96));
  const budgetCulled = Math.max(0, visible.length - maximumTiles);
  return {
    tiles: visible.slice(0, maximumTiles),
    frustumCulled,
    occlusionCulled,
    budgetCulled,
  };
}

function tileIntersectsView(
  tile: GroundTerrainTile,
  observer: Observer,
  camera: GroundCameraPlan,
): boolean {
  const bounds = tileLocalBounds(tile, observer);
  const closestDistance = tileMinimumDistanceMetres(tile, observer);
  if (closestDistance > camera.farMetres) return false;
  if (
    bounds.minimumEast <= 0 && bounds.maximumEast >= 0 &&
    bounds.minimumNorth <= 0 && bounds.maximumNorth >= 0
  ) return true;

  const centreEast = (bounds.minimumEast + bounds.maximumEast) / 2;
  const centreNorth = (bounds.minimumNorth + bounds.maximumNorth) / 2;
  const centreDistance = Math.hypot(centreEast, centreNorth);
  const radius = Math.hypot(
    bounds.maximumEast - bounds.minimumEast,
    bounds.maximumNorth - bounds.minimumNorth,
  ) / 2;
  const centreBearing = degrees(Math.atan2(centreEast, centreNorth));
  const angularRadius = degrees(Math.asin(clamp(
    radius / Math.max(radius, centreDistance),
    0,
    1,
  )));
  return Math.abs(signedAngularDifferenceDegrees(
    centreBearing,
    camera.bearingDeg,
  )) <= camera.horizontalFovDeg / 2 + angularRadius;
}

function desiredZoom(minimumDistanceMetres: number): number {
  if (minimumDistanceMetres < 12_000) return 12;
  if (minimumDistanceMetres < 27_000) return 11;
  if (minimumDistanceMetres < 58_000) return 10;
  return 9;
}

export function groundTerrainTiles(
  observer: Observer,
  camera: GroundCameraPlan,
  options: GroundTerrainPlanOptions = {},
): GroundTerrainTile[] {
  const maxZoom = Math.max(
    MIN_TILE_ZOOM,
    Math.floor(options.maxZoom ?? DEFAULT_MAX_TILE_ZOOM),
  );
  const screenSpaceLod =
    options.focalLengthPixels !== undefined &&
    options.sourceTilePixels !== undefined;
  const tileCount = 2 ** MIN_TILE_ZOOM;
  const centreWorldX = (observer.longitudeDeg + 180) / 360 * tileCount;
  const centreWorldY = mercatorY(observer.latitudeDeg, tileCount);
  const metresPerTile = Math.max(
    1,
    Math.cos(radians(observer.latitudeDeg)) * 2 * Math.PI * EARTH_RADIUS_METRES / tileCount,
  );
  const radiusInTiles = Math.ceil(camera.farMetres / metresPerTile) + 1;
  const roots: GroundTerrainTile[] = [];
  const minimumWorldX = Math.floor(centreWorldX) - radiusInTiles;
  const maximumWorldX = Math.floor(centreWorldX) + radiusInTiles;
  const minimumY = Math.max(0, Math.floor(centreWorldY) - radiusInTiles);
  const maximumY = Math.min(tileCount - 1, Math.floor(centreWorldY) + radiusInTiles);
  for (let worldX = minimumWorldX; worldX <= maximumWorldX; worldX += 1) {
    for (let y = minimumY; y <= maximumY; y += 1) {
      roots.push(terrainTile(MIN_TILE_ZOOM, worldX, y));
    }
  }

  const selected: GroundTerrainTile[] = [];
  const visit = (tile: GroundTerrainTile): void => {
    if (!tileIntersectsView(tile, observer, camera)) return;
    const minimumDistance = tileMinimumDistanceMetres(tile, observer);
    const bounds = tileLocalBounds(tile, observer);
    const tileSpanMetres = Math.max(
      bounds.maximumEast - bounds.minimumEast,
      bounds.maximumNorth - bounds.minimumNorth,
    );
    const projectedPixels = screenSpaceLod
      ? options.focalLengthPixels! * tileSpanMetres /
        Math.hypot(minimumDistance, 2)
      : 0;
    const targetZoom = screenSpaceLod
      ? maxZoom
      : Math.min(maxZoom, desiredZoom(minimumDistance));
    const needsMinimumTerrainZoom = tile.z < Math.min(9, maxZoom);
    const needsScreenDetail = screenSpaceLod &&
      projectedPixels > options.sourceTilePixels!;
    const shouldSubdivide = tile.z < targetZoom && (
      !screenSpaceLod || needsMinimumTerrainZoom || needsScreenDetail
    );
    if (!shouldSubdivide) {
      selected.push(tile);
      return;
    }
    const nextZoom = tile.z + 1;
    const childWorldX = tile.worldX * 2;
    const childY = tile.y * 2;
    visit(terrainTile(nextZoom, childWorldX, childY));
    visit(terrainTile(nextZoom, childWorldX + 1, childY));
    visit(terrainTile(nextZoom, childWorldX, childY + 1));
    visit(terrainTile(nextZoom, childWorldX + 1, childY + 1));
  };
  for (const root of roots) visit(root);
  return selected;
}
