import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  EARTH_MEAN_RADIUS_KM,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  type CartesianVector,
  type EclipseSummary,
} from "@found-in-space/shadowline";
import {
  WGS84_DISPLAY_EQUATORIAL_RADIUS,
  createGeodeticEllipsoidGeometry,
  ecefKmToDisplay,
} from "./earth-ellipsoid.js";
import {
  VISIBLE_SUN_FAR,
  createVisibleSun,
} from "./visible-sun.js";
import {
  createEarthClippedShadowCones,
  perpendicularBasis,
} from "./shadow-cone.js";
import type { SpacefarerFrame } from "./spacefarer-frame.js";

type WorkerResponse =
  | { type: "ready" }
  | { type: "range"; startUtc: string; endUtc: string }
  | { type: "range-error"; message: string }
  | { type: "frame"; requestId: number; frame: SpacefarerFrame }
  | { type: "error"; requestId: number; message: string };

interface TrackerShadowViewOptions {
  onStatus?: (message: string) => void;
  onFollowingChange?: (following: boolean) => void;
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

function northwardLift(axis: THREE.Vector3): THREE.Vector3 {
  const north = new THREE.Vector3(0, 1, 0);
  const lift = north.addScaledVector(axis, -north.dot(axis));
  if (lift.lengthSq() < 1e-6) {
    return perpendicularBasis(axis)[0];
  }
  return lift.normalize();
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
  private readonly camera = new THREE.PerspectiveCamera(
    42,
    1,
    0.02,
    VISIBLE_SUN_FAR,
  );
  private readonly controls: OrbitControls;
  private readonly cameraPresetButtons: Record<"earth" | "system", HTMLButtonElement>;
  private readonly moon: THREE.Mesh;
  private readonly sunLight = new THREE.DirectionalLight(0xffe6ae, 3.8);
  private readonly visibleSun = createVisibleSun();
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
  private lastRequestedTimeKey = Number.NaN;
  private lastRequestedEventId = "";
  private selectedEvent: EclipseSummary | null = null;
  private firstFrame = true;
  private moonPosition = new THREE.Vector3(-60, 0, 0);
  private shadowAxis = new THREE.Vector3(1, 0, 0);
  private sunDirection = new THREE.Vector3(-1, 0, 0);
  private sunAngularRadiusRad = THREE.MathUtils.degToRad(0.266);
  private cameraPreset: "earth" | "system" = "earth";
  private frameStatus = "";
  private followingShadow = true;
  private controlGestureActive = false;

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
    this.scene.add(this.visibleSun.object);
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
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    earthButton.addEventListener("click", () => this.applyCameraPreset("earth"));
    systemButton.addEventListener("click", () => this.applyCameraPreset("system"));
    this.controls.addEventListener("start", () => {
      this.controlGestureActive = true;
    });
    this.controls.addEventListener("change", () => {
      if (this.controlGestureActive) this.setFollowingShadow(false);
    });
    this.controls.addEventListener("end", () => {
      this.controlGestureActive = false;
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.worker.addEventListener("message", (message: MessageEvent<WorkerResponse>) => {
      this.handleWorkerMessage(message.data);
    });
    this.worker.addEventListener("error", () => {
      this.options.onStatus?.("The shadow view is unavailable.");
    });
    container.dataset.rendererReady = "true";
    container.dataset.followingShadow = "true";
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

  setTime(timeMs: number, event?: EclipseSummary): void {
    if (event) this.selectedEvent = event;
    const timeKey = event ? timeMs : Math.floor(timeMs / 1000);
    const eventId = this.selectedEvent?.id ?? "";
    if (
      timeKey === this.lastRequestedTimeKey &&
      eventId === this.lastRequestedEventId
    ) {
      return;
    }
    this.lastRequestedTimeKey = timeKey;
    this.lastRequestedEventId = eventId;
    this.queuedTimeMs = timeMs;
    if (this.active) this.requestFrame();
  }

  isFollowingShadow(): boolean {
    return this.followingShadow;
  }

  resumeFollowing(): void {
    this.setFollowingShadow(true);
    if (!this.firstFrame) this.applyCameraPreset(this.cameraPreset, false);
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
      event: this.selectedEvent ?? undefined,
      angularIntervalDegrees: 0.5,
    });
  }

  private handleWorkerMessage(response: WorkerResponse): void {
    if (response.type !== "frame" && response.type !== "error") return;
    this.requestInFlight = false;
    if (response.type === "error") {
      this.options.onStatus?.("The eclipse shadow is not reaching Earth at this time.");
    } else {
      this.updateFrame(response.frame);
    }
    if (this.queuedTimeMs !== null && this.active) this.requestFrame();
  }

  private updateFrame(frame: SpacefarerFrame): void {
    this.container.dataset.eventId = frame.event.id;
    this.container.dataset.frameUtc = frame.atUtc;
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
      ...createEarthClippedShadowCones({
        moonPosition,
        shadowAxis: axis,
        displayLength: coneLength,
        sunMoonDistanceKm: frame.sunMoonDistanceKm,
      }),
    );
    for (const ring of frame.penumbraRings) {
      const line = footprint(ring, 0x7ee7f2);
      if (line) this.footprintLayer.add(line);
    }
    for (const ring of frame.centralRings) {
      const line = footprint(ring, 0xd1c5ff);
      if (line) this.footprintLayer.add(line);
    }
    this.sunDirection.copy(displayDirection(frame.sunEcefKm));
    this.sunAngularRadiusRad = Math.asin(
      SUN_RADIUS_KM / frame.sunMoonDistanceKm,
    );
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(20);
    this.frameStatus = frame.centralKind !== null
      ? "The narrow purple cone reaches Earth. The wider gold cone marks where a partial eclipse can be seen."
      : frame.penumbraRings.length > 0
        ? "The wider gold cone reaches Earth, but the narrow central cone does not at this time."
        : "The Moon’s shadow cones are not reaching Earth at this time.";
    if (this.firstFrame) {
      this.firstFrame = false;
      this.applyCameraPreset("earth", false);
    } else if (this.followingShadow && !this.controlGestureActive) {
      this.applyCameraPreset(this.cameraPreset, false);
    } else {
      this.showCameraStatus();
    }
  }

  private setFollowingShadow(following: boolean): void {
    if (this.followingShadow === following) return;
    this.followingShadow = following;
    this.container.dataset.followingShadow = String(following);
    this.options.onFollowingChange?.(following);
  }

  private applyCameraPreset(
    preset: "earth" | "system",
    resumeFollowing = true,
  ): void {
    if (resumeFollowing) this.setFollowingShadow(true);
    this.cameraPreset = preset;
    for (const [name, button] of Object.entries(this.cameraPresetButtons)) {
      button.setAttribute("aria-pressed", String(name === preset));
    }
    const [side] = perpendicularBasis(this.shadowAxis);
    const up = northwardLift(this.shadowAxis);
    this.camera.up.copy(up);
    if (preset === "system") {
      const separation = Math.max(1, this.moonPosition.length());
      const target = this.moonPosition.clone().multiplyScalar(0.5);
      this.camera.position
        .copy(target)
        .addScaledVector(side, separation * 1.85)
        .addScaledVector(up, separation * 0.35);
      this.controls.target.copy(target);
    } else {
      // Look from the Sun-facing side of Earth, almost directly along the
      // shadow axis. A small lift keeps the camera just above the umbra.
      this.camera.position
        .copy(this.shadowAxis)
        .multiplyScalar(-7.4)
        .addScaledVector(up, 0.55);
      this.controls.target.set(0, 0, 0);
    }
    this.camera.near = preset === "system" ? 0.05 : 0.02;
    this.camera.far = VISIBLE_SUN_FAR;
    this.camera.updateProjectionMatrix();
    this.updateControlSensitivity();
    this.controls.update();
    this.showCameraStatus();
  }

  private updateControlSensitivity(): void {
    const targetDistance = this.camera.position.distanceTo(
      this.controls.target,
    );
    const localScale = Math.hypot(
      targetDistance - WGS84_DISPLAY_EQUATORIAL_RADIUS,
      this.camera.near,
    );
    const sensitivity =
      localScale /
      Math.max(targetDistance, WGS84_DISPLAY_EQUATORIAL_RADIUS);
    this.controls.zoomSpeed = sensitivity;
    this.controls.rotateSpeed = sensitivity;
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
    this.updateControlSensitivity();
    this.controls.update();
    this.visibleSun.update(
      this.camera,
      this.sunDirection,
      this.sunAngularRadiusRad,
    );
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = window.requestAnimationFrame(this.render);
  };
}
