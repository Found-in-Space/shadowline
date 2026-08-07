import * as Astronomy from "astronomy-engine";
import {
  AU_KM,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  type Observer,
} from "@found-in-space/shadowline";

const astronomyNamespace = Astronomy as unknown as Record<string, unknown>;
const AstronomyRuntime = (
  typeof astronomyNamespace["Equator"] === "function"
    ? astronomyNamespace
    : astronomyNamespace["default"]
) as typeof Astronomy;

const {
  Body,
  Equator,
  Horizon,
  Observer: AstronomyObserver,
  SetDeltaTFunction,
} = AstronomyRuntime;

export const TRACKER_DELTA_T_SECONDS = 69.1734;

export function configureOperationalDeltaT202608(): void {
  SetDeltaTFunction(() => TRACKER_DELTA_T_SECONDS);
}

export interface SolarDiscGeometry {
  sunRadiusDeg: number;
  moonRadiusDeg: number;
  eastOffsetDeg: number;
  northOffsetDeg: number;
  separationDeg: number;
  obscuration: number;
  sunAltitudeDeg: number;
  sunAzimuthDeg: number;
}

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

function normalized(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function cross(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

export function circleOverlapFraction(
  foregroundRadius: number,
  backgroundRadius: number,
  separation: number,
): number {
  if (
    foregroundRadius <= 0 ||
    backgroundRadius <= 0 ||
    separation < 0
  ) {
    throw new RangeError("Circle radii must be positive and separation non-negative.");
  }
  if (separation >= foregroundRadius + backgroundRadius) return 0;
  if (separation <= Math.abs(foregroundRadius - backgroundRadius)) {
    return foregroundRadius >= backgroundRadius
      ? 1
      : (foregroundRadius * foregroundRadius) /
          (backgroundRadius * backgroundRadius);
  }
  const first = Math.acos(
    (separation * separation + foregroundRadius * foregroundRadius -
      backgroundRadius * backgroundRadius) /
      (2 * separation * foregroundRadius),
  );
  const second = Math.acos(
    (separation * separation + backgroundRadius * backgroundRadius -
      foregroundRadius * foregroundRadius) /
      (2 * separation * backgroundRadius),
  );
  const lens = Math.sqrt(
    Math.max(
      0,
      (-separation + foregroundRadius + backgroundRadius) *
        (separation + foregroundRadius - backgroundRadius) *
        (separation - foregroundRadius + backgroundRadius) *
        (separation + foregroundRadius + backgroundRadius),
    ),
  );
  const area =
    foregroundRadius * foregroundRadius * first +
    backgroundRadius * backgroundRadius * second -
    lens / 2;
  return Math.min(1, Math.max(0, area / (Math.PI * backgroundRadius ** 2)));
}

export function solarDiscGeometry(
  observer: Observer,
  at: Date,
): SolarDiscGeometry {
  const location = new AstronomyObserver(
    observer.latitudeDeg,
    observer.longitudeDeg,
    observer.elevationMeters ?? 0,
  );
  const sun = Equator(Body.Sun, at, location, true, true);
  const moon = Equator(Body.Moon, at, location, true, true);
  const sunDirection = normalized(sun.vec);
  const moonDirection = normalized(moon.vec);
  const celestialNorth = { x: 0, y: 0, z: 1 };
  let east = cross(celestialNorth, sunDirection);
  if (Math.hypot(east.x, east.y, east.z) < 1e-12) {
    east = cross({ x: 0, y: 1, z: 0 }, sunDirection);
  }
  east = normalized(east);
  const north = normalized(cross(sunDirection, east));
  const radial = Math.max(-1, Math.min(1, dot(moonDirection, sunDirection)));
  const eastOffset = Math.atan2(dot(moonDirection, east), radial);
  const northOffset = Math.atan2(dot(moonDirection, north), radial);
  const separation = Math.acos(radial);
  const sunRadius = Math.asin(SUN_RADIUS_KM / (sun.dist * AU_KM));
  const moonRadius = Math.asin(MOON_RADIUS_KM / (moon.dist * AU_KM));
  const horizontal = Horizon(
    at,
    location,
    sun.ra,
    sun.dec,
    "normal",
  );
  const radiansToDegrees = 180 / Math.PI;
  return {
    sunRadiusDeg: sunRadius * radiansToDegrees,
    moonRadiusDeg: moonRadius * radiansToDegrees,
    eastOffsetDeg: eastOffset * radiansToDegrees,
    northOffsetDeg: northOffset * radiansToDegrees,
    separationDeg: separation * radiansToDegrees,
    obscuration: circleOverlapFraction(moonRadius, sunRadius, separation),
    sunAltitudeDeg: horizontal.altitude,
    sunAzimuthDeg: horizontal.azimuth,
  };
}
