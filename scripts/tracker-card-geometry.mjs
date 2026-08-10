const FULL_LONGITUDE_SPAN = 360;

export function normalizeLongitude360(longitudeDeg) {
  return ((longitudeDeg % FULL_LONGITUDE_SPAN) + FULL_LONGITUDE_SPAN) %
    FULL_LONGITUDE_SPAN;
}

export function normalizeLongitude180(longitudeDeg) {
  const normalized = normalizeLongitude360(longitudeDeg + 180) - 180;
  return normalized === -180 ? 180 : normalized;
}

/**
 * Finds the smallest circular longitude interval containing every point.
 * The returned interval is unwrapped and can cross +180 degrees.
 */
export function minimumLongitudeArc(longitudesDeg) {
  if (longitudesDeg.length === 0) {
    throw new Error("At least one longitude is required.");
  }

  const sorted = longitudesDeg
    .map(normalizeLongitude360)
    .sort((left, right) => left - right);
  let largestGap = -1;
  let largestGapIndex = -1;

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = index === sorted.length - 1
      ? sorted[0] + FULL_LONGITUDE_SPAN
      : sorted[index + 1];
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }

  const west = sorted[(largestGapIndex + 1) % sorted.length];
  const span = FULL_LONGITUDE_SPAN - largestGap;
  return { west, east: west + span, span };
}

export function unwrapLongitudeNear(longitudeDeg, referenceDeg) {
  const normalized = normalizeLongitude180(longitudeDeg);
  return normalized +
    FULL_LONGITUDE_SPAN * Math.round((referenceDeg - normalized) / 360);
}

function clampLatitudeWindow(south, north) {
  const span = Math.min(180, north - south);
  let clampedSouth = south;
  let clampedNorth = north;

  if (clampedNorth > 90) {
    clampedSouth -= clampedNorth - 90;
    clampedNorth = 90;
  }
  if (clampedSouth < -90) {
    clampedNorth += -90 - clampedSouth;
    clampedSouth = -90;
  }

  return {
    south: Math.max(-90, clampedSouth),
    north: Math.min(90, clampedSouth + span, clampedNorth),
  };
}

/**
 * Produces a tight equirectangular viewport around the full central path.
 * Relative padding keeps long tracks readable; minimum spans protect short
 * and polar tracks from being cropped too tightly.
 */
export function calculateTrackViewport(
  geographicPoints,
  {
    paddingFraction = 0.1,
    minimumLongitudePaddingDeg = 5,
    minimumLatitudePaddingDeg = 5,
    minimumLongitudeSpanDeg = 30,
    minimumLatitudeSpanDeg = 24,
  } = {},
) {
  if (geographicPoints.length === 0) {
    throw new Error("At least one geographic point is required.");
  }

  const longitudeArc = minimumLongitudeArc(
    geographicPoints.map((point) => point.longitudeDeg),
  );
  const pathSouth = Math.min(
    ...geographicPoints.map((point) => point.latitudeDeg),
  );
  const pathNorth = Math.max(
    ...geographicPoints.map((point) => point.latitudeDeg),
  );
  const pathLatitudeSpan = pathNorth - pathSouth;

  const longitudePadding = Math.max(
    minimumLongitudePaddingDeg,
    longitudeArc.span * paddingFraction,
    (minimumLongitudeSpanDeg - longitudeArc.span) / 2,
  );
  const latitudePadding = Math.max(
    minimumLatitudePaddingDeg,
    pathLatitudeSpan * paddingFraction,
    (minimumLatitudeSpanDeg - pathLatitudeSpan) / 2,
  );

  let west = longitudeArc.west - longitudePadding;
  let east = longitudeArc.east + longitudePadding;
  if (east - west > FULL_LONGITUDE_SPAN) {
    const centre = (west + east) / 2;
    west = centre - 180;
    east = centre + 180;
  }

  const latitude = clampLatitudeWindow(
    pathSouth - latitudePadding,
    pathNorth + latitudePadding,
  );
  const centreLongitudeDeg = normalizeLongitude180((west + east) / 2);
  const unwrappedWest = unwrapLongitudeNear(west, centreLongitudeDeg);

  return {
    west: unwrappedWest,
    east: unwrappedWest + (east - west),
    south: latitude.south,
    north: latitude.north,
    centreLongitudeDeg,
    centreLatitudeDeg: (latitude.south + latitude.north) / 2,
  };
}

export function projectGeographicPoint(point, viewport, width, height) {
  const longitude = unwrapLongitudeNear(
    point.longitudeDeg,
    viewport.centreLongitudeDeg,
  );
  return {
    x: ((longitude - viewport.west) / (viewport.east - viewport.west)) * width,
    y: ((viewport.north - point.latitudeDeg) /
      (viewport.north - viewport.south)) * height,
  };
}
