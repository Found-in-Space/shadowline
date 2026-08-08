import type {
  SolarDiscGeometry,
  SolarHorizonGeometry,
} from "./tracker-astronomy.js";

const PREVIEW_PIXEL_RATIO_LIMIT = 2;

export interface SolarPreviewLayout {
  width: number;
  height: number;
  sunX: number;
  sunY: number;
  sunRadius: number;
  moonX: number;
  moonY: number;
  moonRadius: number;
  horizonY: number;
  groundVisible: boolean;
  directSunVisible: boolean;
  atmosphericGlowOpacity: number;
  atmosphericGlowY: number;
  daylight: number;
  eclipseDim: number;
  warmth: number;
  totality: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const progress = clamp((value - minimum) / (maximum - minimum));
  return progress * progress * (3 - 2 * progress);
}

export function solarPreviewLayout(
  geometry: SolarDiscGeometry,
  width: number,
  height: number,
): SolarPreviewLayout {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError("Solar preview dimensions must be positive and finite.");
  }
  if (!Number.isFinite(geometry.sunRadiusDeg) || geometry.sunRadiusDeg <= 0) {
    throw new RangeError("Solar preview geometry requires a positive solar radius.");
  }

  const shortestSide = Math.min(width, height);
  const sunRadius = shortestSide * 0.245;
  const baseSunY = height * 0.46;
  const sunX = width * 0.56;
  const pixelsPerDegree = sunRadius / geometry.sunRadiusDeg;
  const naturalHorizonY = baseSunY + geometry.sunAltitudeDeg * pixelsPerDegree;
  const horizonFloor = height * 0.34;
  const horizonY = Math.max(horizonFloor, naturalHorizonY);
  const sunY = naturalHorizonY < horizonFloor
    ? horizonY - geometry.sunAltitudeDeg * pixelsPerDegree
    : baseSunY;
  const moonX = sunX + geometry.horizontalOffsetDeg * pixelsPerDegree;
  const moonY = sunY - geometry.verticalOffsetDeg * pixelsPerDegree;
  const moonRadius = geometry.moonRadiusDeg * pixelsPerDegree;
  const remainingPhotosphere = Math.sqrt(clamp(1 - geometry.obscuration));
  const daylight = smoothstep(-6, 1.5, geometry.sunAltitudeDeg);
  const nearHorizon = 1 - smoothstep(0.25, 8, Math.max(0, geometry.sunAltitudeDeg));
  const warmth = clamp(nearHorizon + (1 - daylight) * 0.72);
  const eclipseDim = smoothstep(0.82, 1, geometry.obscuration);
  const atmosphericGlowOpacity = daylight *
    (0.14 + 0.38 * nearHorizon) *
    (0.22 + 0.78 * remainingPhotosphere);
  const atmosphericGlowY = geometry.sunAltitudeDeg < 0
    ? horizonY + Math.min(height * 0.18, -geometry.sunAltitudeDeg * height * 0.025)
    : sunY;
  const totalityDepth = geometry.moonRadiusDeg -
    geometry.sunRadiusDeg -
    geometry.separationDeg;
  const totality = geometry.moonRadiusDeg > geometry.sunRadiusDeg
    ? smoothstep(-0.0015, 0.0015, totalityDepth)
    : 0;

  return {
    width,
    height,
    sunX,
    sunY,
    sunRadius,
    moonX,
    moonY,
    moonRadius,
    horizonY,
    groundVisible: horizonY < height,
    directSunVisible: horizonY > sunY - sunRadius,
    atmosphericGlowOpacity,
    atmosphericGlowY,
    daylight,
    eclipseDim,
    warmth,
    totality,
  };
}

function hsl(hue: number, saturation: number, lightness: number, alpha = 1): string {
  return `hsl(${hue} ${saturation}% ${lightness}% / ${alpha})`;
}

function drawSky(
  context: CanvasRenderingContext2D,
  layout: SolarPreviewLayout,
): void {
  const daylightLightness = 12 + 25 * layout.daylight * (1 - 0.78 * layout.eclipseDim);
  const topHue = 222 - 8 * layout.warmth;
  const horizonHue = 216 - 180 * layout.warmth;
  const gradient = context.createLinearGradient(0, 0, 0, layout.height);
  gradient.addColorStop(0, hsl(topHue, 58, daylightLightness * 0.72));
  gradient.addColorStop(
    0.72,
    hsl(
      horizonHue,
      52 + 20 * layout.warmth,
      daylightLightness + 4 * layout.warmth,
    ),
  );
  gradient.addColorStop(1, hsl(horizonHue, 60, daylightLightness + 7 * layout.warmth));
  context.fillStyle = gradient;
  context.fillRect(0, 0, layout.width, layout.height);
}

function drawAtmosphericGlow(
  context: CanvasRenderingContext2D,
  layout: SolarPreviewLayout,
): void {
  if (layout.atmosphericGlowOpacity < 0.002) return;
  const radius = Math.max(layout.width, layout.height) * (0.66 + 0.18 * layout.warmth);
  const glow = context.createRadialGradient(
    layout.sunX,
    layout.atmosphericGlowY,
    layout.sunRadius * 0.45,
    layout.sunX,
    layout.atmosphericGlowY,
    radius,
  );
  const opacity = layout.atmosphericGlowOpacity;
  glow.addColorStop(0, hsl(45 - 16 * layout.warmth, 100, 84, opacity));
  glow.addColorStop(0.22, hsl(42 - 13 * layout.warmth, 100, 66, opacity * 0.55));
  glow.addColorStop(0.58, hsl(31, 94, 54, opacity * 0.16));
  glow.addColorStop(1, hsl(25, 90, 46, 0));
  context.save();
  context.globalCompositeOperation = "screen";
  context.fillStyle = glow;
  context.fillRect(0, 0, layout.width, layout.height);
  context.restore();
}

function createSolarLayer(
  layout: SolarPreviewLayout,
  pixelRatio: number,
): HTMLCanvasElement {
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(layout.width * pixelRatio));
  layer.height = Math.max(1, Math.round(layout.height * pixelRatio));
  const context = layer.getContext("2d");
  if (!context) throw new Error("The solar preview canvas is unavailable.");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const sun = context.createRadialGradient(
    layout.sunX - layout.sunRadius * 0.18,
    layout.sunY - layout.sunRadius * 0.22,
    layout.sunRadius * 0.08,
    layout.sunX,
    layout.sunY,
    layout.sunRadius,
  );
  sun.addColorStop(0, "#fffdf0");
  sun.addColorStop(0.58, "#fff3b0");
  sun.addColorStop(0.9, "#ffd365");
  sun.addColorStop(1, "#f3a83e");
  context.fillStyle = sun;
  context.beginPath();
  context.arc(layout.sunX, layout.sunY, layout.sunRadius, 0, Math.PI * 2);
  context.fill();

  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  context.arc(layout.moonX, layout.moonY, layout.moonRadius, 0, Math.PI * 2);
  context.fill();
  context.globalCompositeOperation = "source-over";
  return layer;
}

function drawCorona(
  context: CanvasRenderingContext2D,
  layout: SolarPreviewLayout,
): void {
  if (layout.totality < 0.01) return;
  const innerRadius = Math.max(layout.sunRadius, layout.moonRadius) * 0.88;
  const outerRadius = layout.sunRadius * 2.65;
  const corona = context.createRadialGradient(
    layout.sunX,
    layout.sunY,
    innerRadius,
    layout.sunX,
    layout.sunY,
    outerRadius,
  );
  corona.addColorStop(0, `rgb(255 255 245 / ${0.82 * layout.totality})`);
  corona.addColorStop(0.08, `rgb(255 240 188 / ${0.54 * layout.totality})`);
  corona.addColorStop(0.34, `rgb(235 205 255 / ${0.18 * layout.totality})`);
  corona.addColorStop(1, "rgb(210 180 255 / 0)");
  context.save();
  context.globalCompositeOperation = "screen";
  context.fillStyle = corona;
  context.fillRect(0, 0, layout.width, layout.height);
  context.restore();
}

function drawSolarBloom(
  context: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  layout: SolarPreviewLayout,
): void {
  const bloomStrength = 0.64 + 0.36 * Math.sqrt(clamp(1 - layout.eclipseDim));
  const layers = [
    { blur: 18, opacity: 0.2 },
    { blur: 7, opacity: 0.4 },
    { blur: 2.2, opacity: 0.78 },
  ];
  context.save();
  context.globalCompositeOperation = "screen";
  for (const bloom of layers) {
    context.filter = `blur(${bloom.blur}px)`;
    context.globalAlpha = bloom.opacity * bloomStrength;
    context.drawImage(layer, 0, 0, layout.width, layout.height);
  }
  context.restore();

  context.save();
  context.globalAlpha = 0.98;
  context.drawImage(layer, 0, 0, layout.width, layout.height);
  context.restore();
}

function drawTotalityMoon(
  context: CanvasRenderingContext2D,
  layout: SolarPreviewLayout,
): void {
  if (layout.totality < 0.4) return;
  const moon = context.createRadialGradient(
    layout.moonX - layout.moonRadius * 0.22,
    layout.moonY - layout.moonRadius * 0.18,
    0,
    layout.moonX,
    layout.moonY,
    layout.moonRadius,
  );
  moon.addColorStop(0, `rgb(3 5 10 / ${layout.totality})`);
  moon.addColorStop(0.82, `rgb(5 7 13 / ${layout.totality})`);
  moon.addColorStop(1, `rgb(13 16 26 / ${layout.totality})`);
  context.fillStyle = moon;
  context.beginPath();
  context.arc(layout.moonX, layout.moonY, layout.moonRadius, 0, Math.PI * 2);
  context.fill();
}

function drawHorizon(
  context: CanvasRenderingContext2D,
  layout: SolarPreviewLayout,
): void {
  if (!layout.groundVisible) return;
  const horizonY = clamp(layout.horizonY, 0, layout.height);
  const bandHeight = Math.min(30, layout.height * 0.23);
  const haze = context.createLinearGradient(0, horizonY - bandHeight, 0, horizonY);
  haze.addColorStop(0, "rgb(255 184 105 / 0)");
  haze.addColorStop(1, `rgb(255 181 100 / ${0.1 + 0.18 * layout.warmth})`);
  context.fillStyle = haze;
  context.fillRect(0, horizonY - bandHeight, layout.width, bandHeight);

  const ground = context.createLinearGradient(0, horizonY, 0, layout.height);
  ground.addColorStop(0, "#313947");
  ground.addColorStop(0.13, "#252c38");
  ground.addColorStop(1, "#111722");
  context.fillStyle = ground;
  context.fillRect(0, horizonY, layout.width, layout.height - horizonY);

  context.strokeStyle = "rgb(222 227 235 / 0.62)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, horizonY + 0.5);
  context.lineTo(layout.width, horizonY + 0.5);
  context.stroke();
}

interface SolarPreviewFrame {
  geometry: SolarDiscGeometry;
  horizon: SolarHorizonGeometry;
}

export class SolarPreviewRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private frame: SolarPreviewFrame | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The solar preview canvas is unavailable.");
    this.context = context;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.frame) this.draw(this.frame);
      else this.drawPlaceholder();
    });
    this.resizeObserver.observe(canvas);
    this.drawPlaceholder();
  }

  clear(): void {
    this.frame = null;
    delete this.element.dataset.rendererReady;
    delete this.element.dataset.directSunVisible;
    delete this.element.dataset.atmosphericGlow;
    delete this.element.dataset.horizonEdge;
    this.drawPlaceholder();
  }

  render(geometry: SolarDiscGeometry, horizon: SolarHorizonGeometry): void {
    this.frame = { geometry, horizon };
    this.draw(this.frame);
  }

  private canvasSize(): { width: number; height: number; pixelRatio: number } {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
      pixelRatio: Math.min(PREVIEW_PIXEL_RATIO_LIMIT, Math.max(1, window.devicePixelRatio || 1)),
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

  private draw(frame: SolarPreviewFrame): void {
    const size = this.prepareCanvas();
    const layout = solarPreviewLayout(frame.geometry, size.width, size.height);
    const solarLayer = createSolarLayer(layout, size.pixelRatio);

    drawSky(this.context, layout);
    drawAtmosphericGlow(this.context, layout);
    drawCorona(this.context, layout);
    drawSolarBloom(this.context, solarLayer, layout);
    drawTotalityMoon(this.context, layout);
    drawHorizon(this.context, layout);

    this.element.dataset.rendererReady = "true";
    this.element.dataset.directSunVisible = String(layout.directSunVisible);
    this.element.dataset.atmosphericGlow = layout.atmosphericGlowOpacity > 0.01
      ? "visible"
      : "none";
    this.element.dataset.horizonEdge = frame.horizon.edgePositionPercent.toFixed(2);
    this.canvas.dataset.rendererReady = "true";
  }

  private drawPlaceholder(): void {
    const size = this.prepareCanvas();
    const gradient = this.context.createLinearGradient(0, 0, 0, size.height);
    gradient.addColorStop(0, "#15213d");
    gradient.addColorStop(1, "#26324a");
    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, size.width, size.height);

    const radius = Math.min(size.width, size.height) * 0.2;
    const x = size.width * 0.56;
    const y = size.height * 0.48;
    const glow = this.context.createRadialGradient(x, y, radius * 0.2, x, y, radius * 2.2);
    glow.addColorStop(0, "rgb(255 248 206 / 0.7)");
    glow.addColorStop(0.24, "rgb(255 196 93 / 0.2)");
    glow.addColorStop(1, "rgb(255 160 60 / 0)");
    this.context.fillStyle = glow;
    this.context.fillRect(0, 0, size.width, size.height);
    this.context.fillStyle = "rgb(255 211 101 / 0.55)";
    this.context.beginPath();
    this.context.arc(x, y, radius, 0, Math.PI * 2);
    this.context.fill();
  }
}
