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
