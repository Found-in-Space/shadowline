import type { Observer } from "@found-in-space/shadowline";
import * as THREE from "three";
import type {
  GroundCameraPlan,
  GroundTerrainTile,
} from "./tracker-ground-plan.js";
import { groundTerrainTiles } from "./tracker-ground-plan.js";

const ELEVATION_TILE_SIZE = 512;
const ELEVATION_URL_TEMPLATE =
  "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
const EARTH_RADIUS_METRES = 6_371_008.8;
const MAX_PIXEL_RATIO = 2;
const MAX_ELEVATION_ZOOM = 12;
const CAMERA_HEIGHT_METRES = 2;

interface GroundImageryConfiguration {
  urlTemplate: string;
  attribution: string;
  tileSize: number;
  maxZoom: number;
}

export interface GroundTerrainSnapshot {
  bitmap: ImageBitmap;
  camera: GroundCameraPlan;
  tileCount: number;
  photographic: boolean;
  attribution: string;
  width: number;
  height: number;
}

export interface GroundTerrainSnapshotOptions {
  observer: Observer;
  camera: GroundCameraPlan;
  width: number;
  height: number;
  signal: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

interface DecodedElevation {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

const SEA_LEVEL_ELEVATION: DecodedElevation = {
  width: 1,
  height: 1,
  // Terrarium encodes metres as R * 256 + G + B / 256 - 32768.
  pixels: new Uint8ClampedArray([128, 0, 0, 255]),
};

interface ElevationResource {
  elevation: DecodedElevation;
  sourceScale: number;
  sourceOffsetX: number;
  sourceOffsetY: number;
}

interface LoadedGroundTile {
  tile: GroundTerrainTile;
  elevation: ElevationResource;
  texture: THREE.CanvasTexture | null;
}

function optionalNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function groundImageryConfiguration(): GroundImageryConfiguration | null {
  const mapTilerKey = import.meta.env.VITE_MAPTILER_KEY?.trim();
  const configuredTemplate = (
    import.meta.env.VITE_GROUND_IMAGERY_XYZ_TEMPLATE ??
    import.meta.env.VITE_IMAGERY_XYZ_TEMPLATE
  )?.trim();
  const urlTemplate = configuredTemplate || (mapTilerKey
    ? `https://api.maptiler.com/maps/satellite-v4/256/{z}/{x}/{y}.jpg?key=${encodeURIComponent(mapTilerKey)}`
    : "");
  if (!urlTemplate) return null;
  return {
    urlTemplate,
    attribution: (
      import.meta.env.VITE_GROUND_IMAGERY_ATTRIBUTION ??
      import.meta.env.VITE_IMAGERY_ATTRIBUTION ??
      "© MapTiler © OpenStreetMap contributors"
    ).trim(),
    tileSize: optionalNumber(
      import.meta.env.VITE_GROUND_IMAGERY_TILE_SIZE ??
        import.meta.env.VITE_IMAGERY_TILE_SIZE,
      256,
    ),
    maxZoom: optionalNumber(
      import.meta.env.VITE_GROUND_IMAGERY_MAX_ZOOM ??
        import.meta.env.VITE_IMAGERY_MAX_ZOOM,
      20,
    ),
  };
}

function tileUrl(
  template: string,
  tile: Pick<GroundTerrainTile, "z" | "x" | "y">,
): string {
  return template
    .replaceAll("{z}", String(tile.z))
    .replaceAll("{x}", String(tile.x))
    .replaceAll("{y}", String(tile.y));
}

async function fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { cache: "force-cache", signal });
  if (!response.ok) throw new Error(`Tile provider returned ${response.status}.`);
  return createImageBitmap(await response.blob());
}

export async function loadElevation(
  tile: Pick<GroundTerrainTile, "z" | "x" | "y">,
  signal: AbortSignal,
): Promise<DecodedElevation> {
  const response = await fetch(tileUrl(ELEVATION_URL_TEMPLATE, tile), {
    cache: "force-cache",
    signal,
  });
  // Mapterhorn intentionally has no tiles for open water. Treat those gaps as
  // sea level so a coastal view can still render its available land terrain.
  if (response.status === 404) return SEA_LEVEL_ELEVATION;
  if (!response.ok) throw new Error(`Tile provider returned ${response.status}.`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width || ELEVATION_TILE_SIZE;
    canvas.height = bitmap.height || ELEVATION_TILE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Terrain image decoding is unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, pixels: image.data };
  } finally {
    bitmap.close();
  }
}

async function elevationResource(
  tile: GroundTerrainTile,
  signal: AbortSignal,
  cache: Map<string, Promise<DecodedElevation>>,
): Promise<ElevationResource> {
  const sourceZoom = Math.min(MAX_ELEVATION_ZOOM, tile.z);
  const sourceScale = 2 ** (tile.z - sourceZoom);
  const sourceX = Math.floor(tile.x / sourceScale);
  const sourceY = Math.floor(tile.y / sourceScale);
  const key = `${sourceZoom}/${sourceX}/${sourceY}`;
  let promise = cache.get(key);
  if (!promise) {
    promise = loadElevation(
      { z: sourceZoom, x: sourceX, y: sourceY },
      signal,
    );
    cache.set(key, promise);
  }
  return {
    elevation: await promise,
    sourceScale,
    sourceOffsetX: tile.x - sourceX * sourceScale,
    sourceOffsetY: tile.y - sourceY * sourceScale,
  };
}

function decodedElevationAt(
  elevation: DecodedElevation,
  u: number,
  v: number,
): number {
  const pixelX = Math.min(elevation.width - 1, Math.max(0, u * elevation.width - 0.5));
  const pixelY = Math.min(elevation.height - 1, Math.max(0, v * elevation.height - 0.5));
  const west = Math.floor(pixelX);
  const east = Math.min(elevation.width - 1, west + 1);
  const north = Math.floor(pixelY);
  const south = Math.min(elevation.height - 1, north + 1);
  const amountX = pixelX - west;
  const amountY = pixelY - north;
  const sample = (x: number, y: number): number => {
    const offset = (y * elevation.width + x) * 4;
    return elevation.pixels[offset]! * 256 +
      elevation.pixels[offset + 1]! +
      elevation.pixels[offset + 2]! / 256 -
      32768;
  };
  const northHeight = THREE.MathUtils.lerp(
    sample(west, north),
    sample(east, north),
    amountX,
  );
  const southHeight = THREE.MathUtils.lerp(
    sample(west, south),
    sample(east, south),
    amountX,
  );
  return THREE.MathUtils.lerp(northHeight, southHeight, amountY);
}

function latitudeForTileRow(tile: GroundTerrainTile, rowFraction: number): number {
  const tileCount = 2 ** tile.z;
  const worldY = tile.y + rowFraction;
  return THREE.MathUtils.radToDeg(
    Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY / tileCount))),
  );
}

function terrainSegments(tile: GroundTerrainTile): number {
  if (tile.z >= 12) {
    return Math.max(1, Math.round(256 / 2 ** (tile.z - 12)));
  }
  if (tile.z === 11) return 128;
  if (tile.z === 10) return 64;
  return 32;
}

function elevationAtTilePoint(
  resource: ElevationResource,
  u: number,
  v: number,
): number {
  return decodedElevationAt(
    resource.elevation,
    (resource.sourceOffsetX + u) / resource.sourceScale,
    (resource.sourceOffsetY + v) / resource.sourceScale,
  );
}

function terrainGeometry(
  tile: GroundTerrainTile,
  observer: Observer,
  elevation: ElevationResource,
  referenceElevation: number,
): THREE.BufferGeometry {
  const segments = terrainSegments(tile);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rowLength = segments + 1;
  const longitudeScale = EARTH_RADIUS_METRES * Math.cos(
    THREE.MathUtils.degToRad(observer.latitudeDeg),
  );

  for (let row = 0; row <= segments; row += 1) {
    const v = row / segments;
    const latitudeDeg = latitudeForTileRow(tile, v);
    const north = THREE.MathUtils.degToRad(latitudeDeg - observer.latitudeDeg) *
      EARTH_RADIUS_METRES;
    for (let column = 0; column <= segments; column += 1) {
      const u = column / segments;
      const longitudeDeg = THREE.MathUtils.lerp(tile.westDeg, tile.eastDeg, u);
      const east = THREE.MathUtils.degToRad(longitudeDeg - observer.longitudeDeg) *
        longitudeScale;
      const curvatureDrop = (east * east + north * north) /
        (2 * EARTH_RADIUS_METRES);
      const height = elevationAtTilePoint(elevation, u, v) -
        referenceElevation -
        curvatureDrop;
      positions.push(east, height, -north);
      uvs.push(u, 1 - v);
    }
  }
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const northWest = row * rowLength + column;
      const southWest = northWest + rowLength;
      indices.push(
        northWest,
        southWest,
        northWest + 1,
        northWest + 1,
        southWest,
        southWest + 1,
      );
    }
  }

  const skirtDepth = tile.z >= 11
    ? Math.max(4, 180 / 2 ** Math.max(0, tile.z - 12))
    : 420;
  const edges = [
    Array.from({ length: rowLength }, (_, index) => index),
    Array.from({ length: rowLength }, (_, index) => index * rowLength + segments),
    Array.from({ length: rowLength }, (_, index) => segments * rowLength + segments - index),
    Array.from({ length: rowLength }, (_, index) => (segments - index) * rowLength),
  ];
  for (const edge of edges) {
    const skirt = edge.map((sourceIndex) => {
      const positionOffset = sourceIndex * 3;
      const uvOffset = sourceIndex * 2;
      positions.push(
        positions[positionOffset]!,
        positions[positionOffset + 1]! - skirtDepth,
        positions[positionOffset + 2]!,
      );
      uvs.push(uvs[uvOffset]!, uvs[uvOffset + 1]!);
      return positions.length / 3 - 1;
    });
    for (let index = 0; index < edge.length - 1; index += 1) {
      indices.push(
        edge[index]!,
        skirt[index]!,
        edge[index + 1]!,
        edge[index + 1]!,
        skirt[index]!,
        skirt[index + 1]!,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

async function imageryTexture(
  tile: GroundTerrainTile,
  configuration: GroundImageryConfiguration,
  signal: AbortSignal,
): Promise<THREE.CanvasTexture> {
  const bitmap = await fetchBitmap(
    tileUrl(configuration.urlTemplate, tile),
    signal,
  );
  const canvas = document.createElement("canvas");
  canvas.width = configuration.tileSize;
  canvas.height = configuration.tileSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Photographic tile composition is unavailable.");
  try {
    context.drawImage(
      bitmap,
      0,
      0,
      configuration.tileSize,
      configuration.tileSize,
    );
  } finally {
    bitmap.close();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function cameraDirection(camera: GroundCameraPlan): THREE.Vector3 {
  const bearing = THREE.MathUtils.degToRad(camera.bearingDeg);
  const pitch = THREE.MathUtils.degToRad(camera.pitchDeg);
  return new THREE.Vector3(
    Math.sin(bearing) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(bearing) * Math.cos(pitch),
  );
}

function observerGroundElevation(
  tiles: readonly LoadedGroundTile[],
  observer: Observer,
): number {
  for (const loaded of tiles) {
    const centreLongitude = (loaded.tile.westDeg + loaded.tile.eastDeg) / 2;
    const longitude = observer.longitudeDeg + 360 * Math.round(
      (centreLongitude - observer.longitudeDeg) / 360,
    );
    if (
      longitude < loaded.tile.westDeg ||
      longitude > loaded.tile.eastDeg ||
      observer.latitudeDeg > loaded.tile.northDeg ||
      observer.latitudeDeg < loaded.tile.southDeg
    ) continue;
    const u = (longitude - loaded.tile.westDeg) /
      (loaded.tile.eastDeg - loaded.tile.westDeg);
    const latitude = THREE.MathUtils.degToRad(observer.latitudeDeg);
    const tileCount = 2 ** loaded.tile.z;
    const worldY = (
      1 - Math.asinh(Math.tan(latitude)) / Math.PI
    ) / 2 * tileCount;
    return elevationAtTilePoint(
      loaded.elevation,
      u,
      worldY - loaded.tile.y,
    );
  }
  return observer.elevationMeters ?? 0;
}

export async function renderGroundTerrainSnapshot(
  options: GroundTerrainSnapshotOptions,
): Promise<GroundTerrainSnapshot> {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const imagery = groundImageryConfiguration();
  const renderPixelRatio = Math.min(
    MAX_PIXEL_RATIO,
    Math.max(1, window.devicePixelRatio || 1),
  );
  const focalLengthPixels = height * renderPixelRatio /
    (2 * Math.tan(THREE.MathUtils.degToRad(options.camera.verticalFovDeg) / 2));
  const tiles = groundTerrainTiles(
    options.observer,
    options.camera,
    imagery
      ? {
          maxZoom: imagery.maxZoom,
          focalLengthPixels,
          sourceTilePixels: imagery.tileSize,
        }
      : {},
  );
  const scene = new THREE.Scene();
  const meshes: THREE.Mesh[] = [];
  const elevationCache = new Map<string, Promise<DecodedElevation>>();
  let loaded = 0;

  const loadedResults = await Promise.allSettled(tiles.map(async (tile) => {
    const [elevation, texture] = await Promise.all([
      elevationResource(tile, options.signal, elevationCache),
      imagery
        ? imageryTexture(tile, imagery, options.signal).catch((error: unknown) => {
            if (options.signal.aborted) throw error;
            console.warn(`Photographic tile unavailable for ${tile.z}/${tile.x}/${tile.y}.`, error);
            return null;
          })
        : Promise.resolve(null),
    ]);
    loaded += 1;
    options.onProgress?.(loaded, tiles.length);
    return { tile, elevation, texture };
  }));

  const failedTile = loadedResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  const loadedTiles = loadedResults
    .filter((result): result is PromiseFulfilledResult<LoadedGroundTile> =>
      result.status === "fulfilled"
    )
    .map((result) => result.value);
  if (failedTile) {
    for (const loadedTile of loadedTiles) loadedTile.texture?.dispose();
    throw failedTile.reason;
  }
  const photographic = loadedTiles.some((loadedTile) => loadedTile.texture !== null);
  const groundElevation = observerGroundElevation(loadedTiles, options.observer);

  const renderCanvas = document.createElement("canvas");
  let renderer: THREE.WebGLRenderer | null = null;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas: renderCanvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(renderPixelRatio);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    for (const loadedTile of loadedTiles) {
      const material = new THREE.MeshLambertMaterial({
        color: loadedTile.texture ? 0xffffff : 0x687263,
        map: loadedTile.texture,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(
        terrainGeometry(
          loadedTile.tile,
          options.observer,
          loadedTile.elevation,
          groundElevation,
        ),
        material,
      );
      scene.add(mesh);
      meshes.push(mesh);
    }
    scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x6a6657, 2.05));
    const keyLight = new THREE.DirectionalLight(0xfff4d6, 1.15);
    keyLight.position.set(-0.7, 1, 0.45).normalize();
    scene.add(keyLight);

    const camera = new THREE.PerspectiveCamera(
      options.camera.verticalFovDeg,
      width / height,
      1.5,
      options.camera.farMetres * 1.08,
    );
    camera.position.set(0, CAMERA_HEIGHT_METRES, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(camera.position.clone().add(cameraDirection(options.camera)));
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const bitmap = await createImageBitmap(renderCanvas);
    return {
      bitmap,
      camera: options.camera,
      tileCount: tiles.length,
      photographic,
      attribution: [
        "Terrain © Mapterhorn · Copernicus GLO-30",
        photographic ? imagery?.attribution : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      width,
      height,
    };
  } finally {
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshLambertMaterial;
      material.dispose();
    }
    for (const loadedTile of loadedTiles) loadedTile.texture?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
