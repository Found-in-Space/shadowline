import type { Observer } from "@found-in-space/shadowline";
import type { SolarDiscGeometry } from "./tracker-astronomy.js";
import {
  groundCameraPlan,
  groundTrackPositions,
  type GroundCameraPlan,
  type GroundTrackPosition,
} from "./tracker-ground-plan.js";
import {
  renderGroundTerrainSnapshot,
  type GroundTerrainSnapshot,
} from "./tracker-ground-terrain.js";
import { solarPreviewLayout } from "./tracker-solar-preview.js";

const MAX_PIXEL_RATIO = 2;

interface TrackerGroundViewOptions {
  onStatus?: (message: string) => void;
}

interface GroundLocation {
  observer: Observer;
  startMs: number;
  endMs: number;
  key: string;
}

interface Direction3 {
  east: number;
  north: number;
  up: number;
}

interface ProjectedDirection {
  x: number;
  y: number;
  depth: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

function dot(first: Direction3, second: Direction3): number {
  return first.east * second.east +
    first.north * second.north +
    first.up * second.up;
}

function normalize(direction: Direction3): Direction3 {
  const length = Math.hypot(direction.east, direction.north, direction.up);
  return {
    east: direction.east / length,
    north: direction.north / length,
    up: direction.up / length,
  };
}

function horizontalDirection(altitudeDeg: number, azimuthDeg: number): Direction3 {
  const altitude = radians(altitudeDeg);
  const azimuth = radians(azimuthDeg);
  return {
    east: Math.cos(altitude) * Math.sin(azimuth),
    north: Math.cos(altitude) * Math.cos(azimuth),
    up: Math.sin(altitude),
  };
}

function moonDirection(geometry: SolarDiscGeometry): Direction3 {
  const altitude = radians(geometry.sunAltitudeDeg);
  const azimuth = radians(geometry.sunAzimuthDeg);
  const sun = horizontalDirection(geometry.sunAltitudeDeg, geometry.sunAzimuthDeg);
  const horizontal = {
    east: Math.cos(azimuth),
    north: -Math.sin(azimuth),
    up: 0,
  };
  const vertical = {
    east: -Math.sin(altitude) * Math.sin(azimuth),
    north: -Math.sin(altitude) * Math.cos(azimuth),
    up: Math.cos(altitude),
  };
  const horizontalAmount = Math.tan(radians(geometry.horizontalOffsetDeg));
  const verticalAmount = Math.tan(radians(geometry.verticalOffsetDeg));
  return normalize({
    east: sun.east + horizontal.east * horizontalAmount + vertical.east * verticalAmount,
    north: sun.north + horizontal.north * horizontalAmount + vertical.north * verticalAmount,
    up: sun.up + vertical.up * verticalAmount,
  });
}

function projectDirection(
  direction: Direction3,
  camera: GroundCameraPlan,
  width: number,
  height: number,
): ProjectedDirection {
  const bearing = radians(camera.bearingDeg);
  const pitch = radians(camera.pitchDeg);
  const forward = horizontalDirection(camera.pitchDeg, camera.bearingDeg);
  const right = {
    east: Math.cos(bearing),
    north: -Math.sin(bearing),
    up: 0,
  };
  const up = {
    east: -Math.sin(pitch) * Math.sin(bearing),
    north: -Math.sin(pitch) * Math.cos(bearing),
    up: Math.cos(pitch),
  };
  const depth = dot(direction, forward);
  const verticalScale = Math.tan(radians(camera.verticalFovDeg) / 2);
  const horizontalScale = verticalScale * width / height;
  return {
    x: width * (0.5 + dot(direction, right) / (2 * depth * horizontalScale)),
    y: height * (0.5 - dot(direction, up) / (2 * depth * verticalScale)),
    depth,
  };
}

function hsl(hue: number, saturation: number, lightness: number, alpha = 1): string {
  return `hsl(${hue} ${saturation}% ${lightness}% / ${alpha})`;
}

function compassDirection(degrees: number): string {
  const directions = [
    "north",
    "north-east",
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
  ];
  return directions[Math.round(degrees / 45) % directions.length]!;
}

export class TrackerGroundView {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly terrainCanvas = document.createElement("canvas");
  private readonly terrainContext: CanvasRenderingContext2D;
  private readonly attribution: HTMLSpanElement;
  private readonly bearing: HTMLSpanElement;
  private readonly resizeObserver: ResizeObserver;
  private location: GroundLocation | null = null;
  private pendingObserver: Observer | null = null;
  private geometry: SolarDiscGeometry | null = null;
  private camera: GroundCameraPlan | null = null;
  private snapshot: GroundTerrainSnapshot | null = null;
  private controller: AbortController | null = null;
  private buildVersion = 0;
  private active = false;
  private resizeTimer = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: TrackerGroundViewOptions = {},
  ) {
    container.replaceChildren();
    container.classList.add("tracker-ground");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "tracker-ground-canvas";
    this.canvas.setAttribute("aria-label", "Estimated ground view towards the eclipse");
    const context = this.canvas.getContext("2d");
    const terrainContext = this.terrainCanvas.getContext("2d");
    if (!context || !terrainContext) {
      throw new Error("The ground view canvas is unavailable.");
    }
    this.context = context;
    this.terrainContext = terrainContext;
    this.attribution = document.createElement("span");
    this.attribution.className = "ground-attribution";
    this.bearing = document.createElement("span");
    this.bearing.className = "ground-bearing";
    container.append(this.canvas, this.bearing, this.attribution);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.draw();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active && this.location && !this.snapshot && !this.controller) {
      void this.rebuild();
    }
    if (active) this.draw();
  }

  setLocationPending(observer: Observer): void {
    this.pendingObserver = observer;
    this.geometry = null;
    this.location = null;
    this.camera = null;
    this.cancelBuild();
    this.replaceSnapshot(null);
    delete this.container.dataset.terrainReady;
    this.attribution.textContent = "";
    this.bearing.textContent = "";
    this.status("");
    this.draw();
  }

  setLocation(observer: Observer, startMs: number, endMs: number): void {
    const key = [
      observer.latitudeDeg.toFixed(6),
      observer.longitudeDeg.toFixed(6),
      (observer.elevationMeters ?? 0).toFixed(1),
      Math.round(startMs),
      Math.round(endMs),
    ].join(":");
    this.pendingObserver = observer;
    if (this.location?.key === key && this.snapshot) return;
    this.location = { observer, startMs, endMs, key };
    this.cancelBuild();
    this.replaceSnapshot(null);
    delete this.container.dataset.terrainReady;
    this.status("");
    if (this.active) void this.rebuild();
  }

  setTime(geometry: SolarDiscGeometry | null): void {
    this.geometry = geometry;
    if (this.active) this.draw();
  }

  private status(message: string): void {
    this.options.onStatus?.(message);
  }

  private cancelBuild(): void {
    this.controller?.abort();
    this.controller = null;
    this.buildVersion += 1;
  }

  private replaceSnapshot(snapshot: GroundTerrainSnapshot | null): void {
    this.snapshot?.bitmap.close();
    this.snapshot = snapshot;
  }

  private canvasSize(): { width: number; height: number; pixelRatio: number } {
    const bounds = this.container.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
      pixelRatio: Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1)),
    };
  }

  private prepareCanvas(): { width: number; height: number; pixelRatio: number } {
    const size = this.canvasSize();
    const targetWidth = Math.round(size.width * size.pixelRatio);
    const targetHeight = Math.round(size.height * size.pixelRatio);
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }
    this.context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
    this.context.clearRect(0, 0, size.width, size.height);
    return size;
  }

  private handleResize(): void {
    if (!this.active) return;
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.draw();
      if (!this.location || this.controller) return;
      const size = this.canvasSize();
      const changed = !this.snapshot ||
        Math.abs(this.snapshot.width / this.snapshot.height - size.width / size.height) > 0.035 ||
        Math.abs(this.snapshot.width - size.width) > 80 ||
        Math.abs(this.snapshot.height - size.height) > 80;
      if (changed) void this.rebuild();
    }, 220);
  }

  private async rebuild(): Promise<void> {
    const location = this.location;
    if (!location || !this.active) return;
    this.cancelBuild();
    const version = this.buildVersion;
    const controller = new AbortController();
    this.controller = controller;
    const size = this.canvasSize();
    const track = groundTrackPositions(
      location.observer,
      location.startMs,
      location.endMs,
    );
    const camera = groundCameraPlan(track, size.width / size.height);
    this.camera = camera;
    this.updateBearing(camera);
    this.draw();
    this.status("Loading ground view… 0%");
    try {
      const snapshot = await renderGroundTerrainSnapshot({
        observer: location.observer,
        camera,
        width: size.width,
        height: size.height,
        signal: controller.signal,
        onProgress: (loaded, total) => {
          if (version !== this.buildVersion || controller.signal.aborted) return;
          const percentage = Math.round(loaded / total * 100);
          this.status(`Loading ground view… ${percentage}%`);
        },
      });
      if (version !== this.buildVersion || controller.signal.aborted) {
        snapshot.bitmap.close();
        return;
      }
      this.replaceSnapshot(snapshot);
      this.attribution.textContent = snapshot.attribution;
      this.container.dataset.terrainReady = "true";
      this.status("");
      this.draw();
    } catch (error) {
      if (controller.signal.aborted || version !== this.buildVersion) return;
      console.error(error);
      delete this.container.dataset.terrainReady;
      this.status("Local terrain is unavailable; the sky view is still shown.");
      this.draw();
    } finally {
      if (version === this.buildVersion) this.controller = null;
    }
  }

  private updateBearing(camera: GroundCameraPlan): void {
    this.bearing.textContent =
      `Facing ${compassDirection(camera.bearingDeg)} · ${camera.bearingDeg.toFixed(0)}°`;
  }

  private drawSky(
    width: number,
    height: number,
    daylight: number,
    eclipseDim: number,
    warmth: number,
  ): void {
    const daylightLightness = 12 + 25 * daylight * (1 - 0.78 * eclipseDim);
    const topHue = 222 - 8 * warmth;
    const horizonHue = 216 - 180 * warmth;
    const gradient = this.context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, hsl(topHue, 58, daylightLightness * 0.72));
    gradient.addColorStop(
      0.72,
      hsl(horizonHue, 52 + 20 * warmth, daylightLightness + 4 * warmth),
    );
    gradient.addColorStop(
      1,
      hsl(horizonHue, 60, daylightLightness + 7 * warmth),
    );
    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, width, height);
  }

  private drawSunAndMoon(
    geometry: SolarDiscGeometry,
    camera: GroundCameraPlan,
    width: number,
    height: number,
    totality: number,
    eclipseDim: number,
  ): void {
    const sun = projectDirection(
      horizontalDirection(geometry.sunAltitudeDeg, geometry.sunAzimuthDeg),
      camera,
      width,
      height,
    );
    if (sun.depth <= 0) return;
    const moon = projectDirection(moonDirection(geometry), camera, width, height);
    const focalPixels = height / (2 * Math.tan(radians(camera.verticalFovDeg) / 2));
    const sunRadius = focalPixels * Math.tan(radians(geometry.sunRadiusDeg)) / sun.depth;
    const moonRadius = focalPixels * Math.tan(radians(geometry.moonRadiusDeg)) /
      Math.max(0.01, moon.depth);
    const closeToFrame =
      sun.x >= -width * 0.35 && sun.x <= width * 1.35 &&
      sun.y >= -height * 0.35 && sun.y <= height * 1.35;
    if (!closeToFrame) return;

    const glowRadius = Math.max(width, height) * 0.42;
    const glow = this.context.createRadialGradient(
      sun.x,
      sun.y,
      Math.max(1, sunRadius),
      sun.x,
      sun.y,
      glowRadius,
    );
    glow.addColorStop(0, `rgb(255 244 194 / ${0.42 * (1 - 0.78 * eclipseDim)})`);
    glow.addColorStop(0.15, `rgb(255 197 93 / ${0.12 * (1 - 0.7 * eclipseDim)})`);
    glow.addColorStop(1, "rgb(255 160 60 / 0)");
    this.context.save();
    this.context.globalCompositeOperation = "screen";
    this.context.fillStyle = glow;
    this.context.fillRect(0, 0, width, height);
    this.context.restore();

    if (totality > 0.01) {
      const coronaRadius = Math.max(10, sunRadius * 6.5);
      const corona = this.context.createRadialGradient(
        sun.x,
        sun.y,
        Math.max(sunRadius, moonRadius) * 0.8,
        sun.x,
        sun.y,
        coronaRadius,
      );
      corona.addColorStop(0, `rgb(255 255 244 / ${0.92 * totality})`);
      corona.addColorStop(0.16, `rgb(255 239 192 / ${0.44 * totality})`);
      corona.addColorStop(0.5, `rgb(225 205 255 / ${0.14 * totality})`);
      corona.addColorStop(1, "rgb(210 180 255 / 0)");
      this.context.fillStyle = corona;
      this.context.fillRect(
        sun.x - coronaRadius,
        sun.y - coronaRadius,
        coronaRadius * 2,
        coronaRadius * 2,
      );
    }

    this.context.save();
    this.context.shadowColor = "rgb(255 210 100 / 0.9)";
    this.context.shadowBlur = Math.max(4, sunRadius * 2.6);
    this.context.fillStyle = "#fff3b0";
    this.context.beginPath();
    this.context.arc(sun.x, sun.y, Math.max(0.8, sunRadius), 0, Math.PI * 2);
    this.context.fill();
    this.context.restore();

    this.context.save();
    this.context.beginPath();
    this.context.arc(sun.x, sun.y, Math.max(0.8, sunRadius), 0, Math.PI * 2);
    this.context.clip();
    this.context.fillStyle = "#03050a";
    this.context.beginPath();
    this.context.arc(moon.x, moon.y, Math.max(0.8, moonRadius), 0, Math.PI * 2);
    this.context.fill();
    this.context.restore();

    if (totality > 0.4) {
      this.context.fillStyle = `rgb(3 5 10 / ${totality})`;
      this.context.beginPath();
      this.context.arc(moon.x, moon.y, Math.max(0.8, moonRadius), 0, Math.PI * 2);
      this.context.fill();
    }
  }

  private drawTerrain(
    snapshot: GroundTerrainSnapshot,
    width: number,
    height: number,
    daylight: number,
    eclipseDim: number,
    warmth: number,
  ): void {
    if (this.terrainCanvas.width !== width || this.terrainCanvas.height !== height) {
      this.terrainCanvas.width = width;
      this.terrainCanvas.height = height;
    }
    this.terrainContext.clearRect(0, 0, width, height);
    this.terrainContext.globalCompositeOperation = "source-over";
    this.terrainContext.globalAlpha = 1;
    this.terrainContext.drawImage(snapshot.bitmap, 0, 0, width, height);
    const brightness = clamp(
      (0.32 + daylight * 0.68) * (1 - eclipseDim * 0.78),
      0.08,
      1,
    );
    this.terrainContext.globalCompositeOperation = "source-atop";
    this.terrainContext.fillStyle = `rgb(4 7 14 / ${1 - brightness})`;
    this.terrainContext.fillRect(0, 0, width, height);
    if (warmth > 0.05) {
      this.terrainContext.fillStyle = `rgb(112 48 18 / ${0.12 * warmth})`;
      this.terrainContext.fillRect(0, 0, width, height);
    }
    this.terrainContext.globalCompositeOperation = "source-over";
    this.context.drawImage(this.terrainCanvas, 0, 0, width, height);
  }

  private draw(): void {
    const size = this.prepareCanvas();
    const frame = this.geometry;
    const camera = this.camera ?? (frame
      ? groundCameraPlan([{
          altitudeDeg: frame.sunAltitudeDeg,
          azimuthDeg: frame.sunAzimuthDeg,
        } satisfies GroundTrackPosition], size.width / size.height)
      : null);
    const appearance = frame
      ? solarPreviewLayout(frame, size.width, size.height)
      : null;
    this.drawSky(
      size.width,
      size.height,
      appearance?.daylight ?? 0.45,
      appearance?.eclipseDim ?? 0,
      appearance?.warmth ?? 0.15,
    );
    if (frame && camera) {
      this.drawSunAndMoon(
        frame,
        camera,
        size.width,
        size.height,
        appearance!.totality,
        appearance!.eclipseDim,
      );
    }
    if (this.snapshot) {
      this.drawTerrain(
        this.snapshot,
        size.width,
        size.height,
        appearance?.daylight ?? 0.45,
        appearance?.eclipseDim ?? 0,
        appearance?.warmth ?? 0.15,
      );
    } else {
      const ground = this.context.createLinearGradient(0, size.height * 0.76, 0, size.height);
      ground.addColorStop(0, "rgb(28 34 43 / 0.34)");
      ground.addColorStop(1, "rgb(9 13 21 / 0.82)");
      this.context.fillStyle = ground;
      this.context.fillRect(0, size.height * 0.76, size.width, size.height * 0.24);
    }
    const observer = this.location?.observer ?? this.pendingObserver;
    this.canvas.setAttribute(
      "aria-label",
      observer
        ? `Estimated ground view from ${observer.latitudeDeg.toFixed(4)}, ${observer.longitudeDeg.toFixed(4)} towards the eclipse.`
        : "Choose a location to prepare an estimated ground view towards the eclipse.",
    );
  }
}
