import type { Observer } from "@found-in-space/shadowline";
import * as THREE from "three";
import type {
  GroundCameraPlan,
  GroundTerrainTile,
} from "./tracker-ground-plan.js";
import {
  groundTerrainTiles,
  visibleGroundTerrainTiles,
} from "./tracker-ground-plan.js";

const ELEVATION_TILE_SIZE = 512;
const ELEVATION_URL_TEMPLATE =
  "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
const EARTH_RADIUS_METRES = 6_371_008.8;
const MAX_PIXEL_RATIO = 2;
const MAX_ELEVATION_ZOOM = 12;
const CAMERA_HEIGHT_METRES = 2;
const MAX_PHOTOGRAPHIC_TILES = 96;
const TILE_LOAD_CONCURRENCY = 6;
const REFINEMENT_BATCH_SIZE = 12;

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
  resourceCount: number;
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
  onProgress?: (
    loaded: number,
    total: number,
    phase: "terrain" | "imagery",
  ) => void;
  onSnapshot?: (snapshot: GroundTerrainSnapshot) => void;
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

async function mapWithConcurrency<T, Result>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length && failure === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(values[index]!, index);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  const workerCount = Math.min(
    values.length,
    Math.max(1, Math.floor(concurrency)),
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failure !== undefined) throw failure;
  return results;
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

function elevationAtLoadedGround(
  tiles: readonly LoadedGroundTile[],
  latitudeDeg: number,
  longitudeDeg: number,
): number | null {
  for (const loaded of tiles) {
    const centreLongitude = (loaded.tile.westDeg + loaded.tile.eastDeg) / 2;
    const longitude = longitudeDeg + 360 * Math.round(
      (centreLongitude - longitudeDeg) / 360,
    );
    if (
      longitude < loaded.tile.westDeg ||
      longitude > loaded.tile.eastDeg ||
      latitudeDeg > loaded.tile.northDeg ||
      latitudeDeg < loaded.tile.southDeg
    ) continue;
    const u = (longitude - loaded.tile.westDeg) /
      (loaded.tile.eastDeg - loaded.tile.westDeg);
    const latitude = THREE.MathUtils.degToRad(latitudeDeg);
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
  return null;
}

function observerGroundElevation(
  tiles: readonly LoadedGroundTile[],
  observer: Observer,
): number {
  return elevationAtLoadedGround(
    tiles,
    observer.latitudeDeg,
    observer.longitudeDeg,
  ) ?? observer.elevationMeters ?? 0;
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
  const coarseTiles = groundTerrainTiles(options.observer, options.camera);
  const scene = new THREE.Scene();
  const meshes: THREE.Mesh[] = [];
  const textures: THREE.CanvasTexture[] = [];
  const elevationCache = new Map<string, Promise<DecodedElevation>>();
  const renderCanvas = document.createElement("canvas");
  let renderer: THREE.WebGLRenderer | null = null;

  try {
    let loadedTerrain = 0;
    options.onProgress?.(0, coarseTiles.length, "terrain");
    const loadedCoarseTiles = await mapWithConcurrency(
      coarseTiles,
      TILE_LOAD_CONCURRENCY,
      async (tile): Promise<LoadedGroundTile> => {
        options.signal.throwIfAborted();
        const elevation = await elevationResource(
          tile,
          options.signal,
          elevationCache,
        );
        loadedTerrain += 1;
        options.onProgress?.(
          loadedTerrain,
          coarseTiles.length,
          "terrain",
        );
        return { tile, elevation, texture: null };
      },
    );
    const groundElevation = observerGroundElevation(
      loadedCoarseTiles,
      options.observer,
    );

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
    const addTerrainMesh = (
      loadedTile: LoadedGroundTile,
      photographicOverlay: boolean,
    ): void => {
      const material = new THREE.MeshLambertMaterial({
        color: loadedTile.texture ? 0xffffff : 0x687263,
        map: loadedTile.texture,
        side: THREE.DoubleSide,
        polygonOffset: photographicOverlay,
        polygonOffsetFactor: photographicOverlay ? -1 : 0,
        polygonOffsetUnits: photographicOverlay ? -1 : 0,
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
      mesh.renderOrder = photographicOverlay ? 1 : 0;
      scene.add(mesh);
      meshes.push(mesh);
    };
    for (const loadedTile of loadedCoarseTiles) {
      addTerrainMesh(loadedTile, false);
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
    const snapshot = async (
      photographicTileCount: number,
      imageryRequestCount: number,
    ): Promise<GroundTerrainSnapshot> => {
      renderer!.render(scene, camera);
      return {
        bitmap: await createImageBitmap(renderCanvas),
        camera: options.camera,
        tileCount: coarseTiles.length + photographicTileCount,
        resourceCount: elevationCache.size + imageryRequestCount,
        photographic: photographicTileCount > 0,
        attribution: [
          "Terrain © Mapterhorn · Copernicus GLO-30",
          photographicTileCount > 0 ? imagery?.attribution : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        width,
        height,
      };
    };

    if (!imagery) return snapshot(0, 0);

    if (options.onSnapshot) {
      options.signal.throwIfAborted();
      options.onSnapshot(await snapshot(0, 0));
    }

    const photographicCandidates = groundTerrainTiles(
      options.observer,
      options.camera,
      {
        maxZoom: imagery.maxZoom,
        focalLengthPixels,
        sourceTilePixels: imagery.tileSize,
      },
    );
    const refinement = visibleGroundTerrainTiles(
      photographicCandidates,
      options.observer,
      options.camera,
      {
        groundElevationMetres: groundElevation,
        elevationAt: (latitudeDeg, longitudeDeg) => elevationAtLoadedGround(
          loadedCoarseTiles,
          latitudeDeg,
          longitudeDeg,
        ),
        maxTiles: MAX_PHOTOGRAPHIC_TILES,
        cameraHeightMetres: CAMERA_HEIGHT_METRES,
      },
    );
    let loadedRefinements = 0;
    let photographicTileCount = 0;
    let imageryRequestCount = 0;
    options.onProgress?.(0, refinement.tiles.length, "imagery");
    for (
      let batchStart = 0;
      batchStart < refinement.tiles.length;
      batchStart += REFINEMENT_BATCH_SIZE
    ) {
      options.signal.throwIfAborted();
      const batch = refinement.tiles.slice(
        batchStart,
        batchStart + REFINEMENT_BATCH_SIZE,
      );
      const loadedBatch = await mapWithConcurrency(
        batch,
        TILE_LOAD_CONCURRENCY,
        async (tile): Promise<LoadedGroundTile | null> => {
          imageryRequestCount += 1;
          try {
            const [elevationResult, textureResult] = await Promise.allSettled([
              elevationResource(tile, options.signal, elevationCache),
              imageryTexture(tile, imagery, options.signal),
            ]);
            if (textureResult.status === "fulfilled") {
              textures.push(textureResult.value);
            }
            if (elevationResult.status === "rejected") {
              throw elevationResult.reason;
            }
            if (textureResult.status === "rejected") {
              throw textureResult.reason;
            }
            return {
              tile,
              elevation: elevationResult.value,
              texture: textureResult.value,
            };
          } catch (error) {
            if (options.signal.aborted) throw error;
            console.warn(
              `Photographic tile unavailable for ${tile.z}/${tile.x}/${tile.y}.`,
              error,
            );
            return null;
          } finally {
            loadedRefinements += 1;
            options.onProgress?.(
              loadedRefinements,
              refinement.tiles.length,
              "imagery",
            );
          }
        },
      );
      for (const loadedTile of loadedBatch) {
        if (!loadedTile) continue;
        addTerrainMesh(loadedTile, true);
        photographicTileCount += 1;
      }
      const isFinalBatch = batchStart + batch.length >= refinement.tiles.length;
      if (!isFinalBatch && options.onSnapshot) {
        options.signal.throwIfAborted();
        options.onSnapshot(await snapshot(
          photographicTileCount,
          imageryRequestCount,
        ));
      }
    }
    return snapshot(photographicTileCount, imageryRequestCount);
  } finally {
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshLambertMaterial;
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
