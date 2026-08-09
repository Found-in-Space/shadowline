export interface CoordinatePair {
  latitude: number;
  longitude: number;
}

const DECIMAL_COORDINATE = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const COORDINATE_PAIR = new RegExp(
  `^\\s*(${DECIMAL_COORDINATE})\\s*,\\s*(${DECIMAL_COORDINATE})\\s*$`,
);

export function parseCoordinatePair(value: string): CoordinatePair | null {
  const match = COORDINATE_PAIR.exec(value);
  if (!match) return null;

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}
