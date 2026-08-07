const TERRAIN_TILE_SIZE = 512;
const TERRAIN_ZOOM = 12;
const MAX_MERCATOR_LATITUDE = 85.05112878;

export interface TerrainTileSample {
  url: string;
  pixelX: number;
  pixelY: number;
}

export function decodeTerrariumPixel(
  red: number,
  green: number,
  blue: number,
): number {
  return red * 256 + green + blue / 256 - 32768;
}

export function terrainTileSample(
  latitudeDeg: number,
  longitudeDeg: number,
): TerrainTileSample {
  const latitude = Math.max(
    -MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, latitudeDeg),
  );
  const longitude = ((longitudeDeg + 180) % 360 + 360) % 360 - 180;
  const tileCount = 2 ** TERRAIN_ZOOM;
  const worldX = ((longitude + 180) / 360) * tileCount;
  const latitudeRadians = latitude * Math.PI / 180;
  const worldY = (
    1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI
  ) / 2 * tileCount;
  const tileX = Math.floor(worldX);
  const tileY = Math.max(0, Math.min(tileCount - 1, Math.floor(worldY)));
  const pixelX = Math.max(
    0,
    Math.min(TERRAIN_TILE_SIZE - 1, Math.floor((worldX - tileX) * TERRAIN_TILE_SIZE)),
  );
  const pixelY = Math.max(
    0,
    Math.min(TERRAIN_TILE_SIZE - 1, Math.floor((worldY - tileY) * TERRAIN_TILE_SIZE)),
  );
  return {
    url: `https://tiles.mapterhorn.com/${TERRAIN_ZOOM}/${tileX}/${tileY}.webp`,
    pixelX,
    pixelY,
  };
}

export async function terrainElevationMeters(
  latitudeDeg: number,
  longitudeDeg: number,
): Promise<number> {
  const sample = terrainTileSample(latitudeDeg, longitudeDeg);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(sample.url, {
      cache: "force-cache",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Terrain returned ${response.status}.`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = document.createElement("canvas");
      canvas.width = TERRAIN_TILE_SIZE;
      canvas.height = TERRAIN_TILE_SIZE;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Terrain image decoding is unavailable.");
      context.drawImage(bitmap, 0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
      const [red, green, blue] = context.getImageData(
        sample.pixelX,
        sample.pixelY,
        1,
        1,
      ).data;
      return decodeTerrariumPixel(red!, green!, blue!);
    } finally {
      bitmap.close();
    }
  } finally {
    window.clearTimeout(timeout);
  }
}
