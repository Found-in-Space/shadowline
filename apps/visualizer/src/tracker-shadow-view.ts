import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  EARTH_MEAN_RADIUS_KM,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  type CartesianVector,
} from "@found-in-space/shadowline";
import {
  createGeodeticEllipsoidGeometry,
  ecefKmToDisplay,
} from "./earth-ellipsoid.js";
import type { SpacefarerFrame } from "./spacefarer-frame.js";

type WorkerResponse =
  | { type: "ready" }
  | { type: "range"; startUtc: string; endUtc: string }
  | { type: "range-error"; message: string }
  | { type: "frame"; requestId: number; frame: SpacefarerFrame }
  | { type: "error"; requestId: number; message: string };

interface TrackerShadowViewOptions {
  onStatus?: (message: string) => void;
}

const siteRoot = new URL(/* @vite-ignore */ "../", import.meta.url);
const earthTextureUrl = new URL("bluemarble-2048.png", siteRoot).href;
const moonTextureUrl = new URL("lroc-color-2k.jpg", siteRoot).href;

function preloadSpacefarerWorker(): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./spacefarer-worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("The physical shadow worker did not preload in time."));
    }, 15_000);
    worker.addEventListener("message", () => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve();
    }, { once: true });
    worker.addEventListener("error", () => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error("The physical shadow worker could not be preloaded."));
    }, { once: true });
  });
}

export async function preloadTrackerShadowAssets(): Promise<void> {
  await Promise.all([
    ...[earthTextureUrl, moonTextureUrl].map((url) =>
      fetch(url, { cache: "force-cache" }).then((response) => {
        if (!response.ok) throw new Error(`Could not preload ${url}.`);
      }),
    ),
    preloadSpacefarerWorker(),
  ]);
}

function displayDirection(value: CartesianVector): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.z, -value.y).normalize();
}

function perpendicularBasis(
  axis: THREE.Vector3,
): [THREE.Vector3, THREE.Vector3] {
  const reference =
    Math.abs(axis.y) < 0.82
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  const first = new THREE.Vector3().crossVectors(axis, reference).normalize();
  const second = new THREE.Vector3().crossVectors(axis, first).normalize();
  return [first, second];
}

function coneSurface(
  start: THREE.Vector3,
  axis: THREE.Vector3,
  displayLength: number,
  slope: number,
  color: number,
  opacity: number,
): THREE.Mesh {
  const radialSegments = 96;
  const lengthSegments = 48;
  const [first, second] = perpendicularBasis(axis);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let alongIndex = 0; alongIndex <= lengthSegments; alongIndex += 1) {
    const along = (displayLength * alongIndex) / lengthSegments;
    const physicalRadiusKm =
      MOON_RADIUS_KM + slope * along * EARTH_MEAN_RADIUS_KM;
    const displayRadius = Math.abs(physicalRadiusKm) / EARTH_MEAN_RADIUS_KM;
    const centre = start.clone().addScaledVector(axis, along);
    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
      const angle = (radialIndex / radialSegments) * Math.PI * 2;
      const point = centre
        .clone()
        .addScaledVector(first, Math.cos(angle) * displayRadius)
        .addScaledVector(second, Math.sin(angle) * displayRadius);
      positions.push(point.x, point.y, point.z);
    }
  }
  const row = radialSegments + 1;
  for (let alongIndex = 0; alongIndex < lengthSegments; alongIndex += 1) {
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
      const index = alongIndex * row + radialIndex;
      const next = index + row;
      indices.push(index, next, index + 1, next, next + 1, index + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3;
  return mesh;
}

function disposeLayer(layer: THREE.Group): void {
  for (const child of [...layer.children]) {
    child.traverse((object) => {
      const candidate = object as THREE.Mesh | THREE.Line;
      candidate.geometry?.dispose();
      const material = candidate.material;
      if (Array.isArray(material)) {
        for (const item of material) item.dispose();
      } else {
        material?.dispose();
      }
    });
    layer.remove(child);
  }
}

function footprint(
  ring: CartesianVector[],
  color: number,
): THREE.LineLoop | null {
  if (ring.length < 3) return null;
  const points = ring.map((point) => ecefKmToDisplay(point).multiplyScalar(1.002));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const line = new THREE.LineLoop(geometry, material);
  line.renderOrder = 5;
  return line;
}

export class TrackerShadowView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.02, 180);
  private readonly controls: OrbitControls;
  private readonly cameraPresetButtons: Record<"earth" | "system", HTMLButtonElement>;
  private readonly moon: THREE.Mesh;
  private readonly sunLight = new THREE.DirectionalLight(0xffe6ae, 3.8);
  private readonly coneLayer = new THREE.Group();
  private readonly footprintLayer = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly worker = new Worker(
    new URL("./spacefarer-worker.ts", import.meta.url),
    { type: "module" },
  );
  private active = false;
  private animationFrame = 0;
  private requestId = 0;
  private requestInFlight = false;
  private queuedTimeMs: number | null = null;
  private lastRequestedSecond = Number.NaN;
  private firstFrame = true;
  private moonPosition = new THREE.Vector3(-60, 0, 0);
  private shadowAxis = new THREE.Vector3(1, 0, 0);
  private cameraPreset: "earth" | "system" = "earth";
  private frameStatus = "Preparing the physical shadow view…";

  constructor(
    private readonly container: HTMLElement,
    private readonly options: TrackerShadowViewOptions = {},
  ) {
    container.replaceChildren();
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    const cameraControls = document.createElement("div");
    cameraControls.className = "shadow-camera-controls";
    cameraControls.setAttribute("role", "group");
    cameraControls.setAttribute("aria-label", "Physical shadow viewpoint");
    const earthButton = document.createElement("button");
    earthButton.type = "button";
    earthButton.textContent = "At Earth";
    earthButton.setAttribute("aria-pressed", "true");
    const systemButton = document.createElement("button");
    systemButton.type = "button";
    systemButton.textContent = "Earth + Moon";
    systemButton.setAttribute("aria-pressed", "false");
    cameraControls.append(earthButton, systemButton);
    this.cameraPresetButtons = { earth: earthButton, system: systemButton };
    container.append(this.renderer.domElement, cameraControls);

    this.scene.background = new THREE.Color(0x050914);
    this.scene.add(new THREE.HemisphereLight(0x7998c2, 0x05050a, 0.48));
    this.sunLight.target.position.set(0, 0, 0);
    this.scene.add(this.sunLight, this.sunLight.target);

    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load(earthTextureUrl);
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    const earth = new THREE.Mesh(
      createGeodeticEllipsoidGeometry(128, 64),
      new THREE.MeshStandardMaterial({
        map: earthTexture,
        roughness: 0.94,
        emissive: 0x07111a,
        emissiveMap: earthTexture,
        emissiveIntensity: 0.15,
      }),
    );
    this.scene.add(earth);

    const atmosphere = new THREE.Mesh(
      createGeodeticEllipsoidGeometry(96, 48, 100),
      new THREE.MeshBasicMaterial({
        color: 0x79ddeb,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(atmosphere);

    const moonTexture = textureLoader.load(moonTextureUrl);
    moonTexture.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_RADIUS_KM / EARTH_MEAN_RADIUS_KM, 48, 32),
      new THREE.MeshStandardMaterial({ map: moonTexture, roughness: 1 }),
    );
    this.scene.add(this.moon, this.coneLayer, this.footprintLayer);

    this.camera.position.set(7.4, 3.2, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.4;
    this.controls.maxDistance = 180;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    earthButton.addEventListener("click", () => this.applyCameraPreset("earth"));
    systemButton.addEventListener("click", () => this.applyCameraPreset("system"));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.worker.addEventListener("message", (message: MessageEvent<WorkerResponse>) => {
      this.handleWorkerMessage(message.data);
    });
    this.worker.addEventListener("error", () => {
      this.options.onStatus?.("The physical shadow view could not start.");
    });
    container.dataset.rendererReady = "true";
    this.resize();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.resize();
      if (this.queuedTimeMs !== null) this.requestFrame();
      this.render();
    } else {
      window.cancelAnimationFrame(this.animationFrame);
    }
  }

  setTime(timeMs: number): void {
    const second = Math.floor(timeMs / 1000);
    if (second === this.lastRequestedSecond) return;
    this.lastRequestedSecond = second;
    this.queuedTimeMs = timeMs;
    if (this.active) this.requestFrame();
  }

  private requestFrame(): void {
    if (this.requestInFlight || this.queuedTimeMs === null) return;
    const atUtc = new Date(this.queuedTimeMs).toISOString();
    this.queuedTimeMs = null;
    this.requestInFlight = true;
    this.requestId += 1;
    this.worker.postMessage({
      type: "frame",
      requestId: this.requestId,
      atUtc,
      angularIntervalDegrees: 0.5,
    });
  }

  private handleWorkerMessage(response: WorkerResponse): void {
    if (response.type !== "frame" && response.type !== "error") return;
    this.requestInFlight = false;
    if (response.type === "error") {
      this.options.onStatus?.("The physical shadow could not be calculated for this time.");
    } else {
      this.updateFrame(response.frame);
    }
    if (this.queuedTimeMs !== null && this.active) this.requestFrame();
  }

  private updateFrame(frame: SpacefarerFrame): void {
    disposeLayer(this.coneLayer);
    disposeLayer(this.footprintLayer);
    const moonPosition = ecefKmToDisplay(frame.moonEcefKm);
    const axis = displayDirection(frame.direction);
    this.moonPosition.copy(moonPosition);
    this.shadowAxis.copy(axis);
    this.moon.position.copy(moonPosition);
    const coneLength =
      frame.axisDistanceToEarthPlaneKm / EARTH_MEAN_RADIUS_KM + 2.3;
    this.coneLayer.add(
      coneSurface(
        moonPosition,
        axis,
        coneLength,
        (SUN_RADIUS_KM + MOON_RADIUS_KM) / frame.sunMoonDistanceKm,
        0xf2b94d,
        0.09,
      ),
      coneSurface(
        moonPosition,
        axis,
        coneLength,
        -(SUN_RADIUS_KM - MOON_RADIUS_KM) / frame.sunMoonDistanceKm,
        0x9d7cff,
        0.23,
      ),
    );
    for (const ring of frame.penumbraRings) {
      const line = footprint(ring, 0x7ee7f2);
      if (line) this.footprintLayer.add(line);
    }
    for (const ring of frame.centralRings) {
      const line = footprint(ring, 0xd1c5ff);
      if (line) this.footprintLayer.add(line);
    }
    this.sunLight.position.copy(displayDirection(frame.sunEcefKm)).multiplyScalar(20);
    this.frameStatus = frame.centralKind !== null
      ? "The narrow purple cone reaches Earth. The wider gold cone marks where a partial eclipse can be seen."
      : frame.penumbraRings.length > 0
        ? "The wider gold cone reaches Earth, but the narrow central cone does not at this time."
        : "The Moon’s shadow cones are not reaching Earth at this time.";
    if (this.firstFrame) {
      this.firstFrame = false;
      this.applyCameraPreset("earth");
    } else {
      this.showCameraStatus();
    }
  }

  private applyCameraPreset(preset: "earth" | "system"): void {
    this.cameraPreset = preset;
    for (const [name, button] of Object.entries(this.cameraPresetButtons)) {
      button.setAttribute("aria-pressed", String(name === preset));
    }
    const [side, up] = perpendicularBasis(this.shadowAxis);
    if (preset === "system") {
      const separation = Math.max(1, this.moonPosition.length());
      const target = this.moonPosition.clone().multiplyScalar(0.5);
      this.camera.position
        .copy(target)
        .addScaledVector(side, separation * 1.85)
        .addScaledVector(up, separation * 0.35);
      this.controls.target.copy(target);
    } else {
      this.camera.position
        .copy(side)
        .multiplyScalar(7.4)
        .addScaledVector(up, 3.2)
        .addScaledVector(this.shadowAxis, -0.7);
      this.controls.target.set(0, 0, 0);
    }
    this.camera.near = preset === "system" ? 0.05 : 0.02;
    this.camera.far = 300;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.showCameraStatus();
  }

  private showCameraStatus(): void {
    this.options.onStatus?.(
      this.cameraPreset === "system"
        ? "Earth, Moon and both shadow cones share one physical scale here, so the cones appear extremely long and narrow. Pinch to move closer."
        : this.frameStatus,
    );
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private render = (): void => {
    if (!this.active) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = window.requestAnimationFrame(this.render);
  };
}
