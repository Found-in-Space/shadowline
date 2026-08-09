import "./tracker-202608.css";

import type {
  EclipseContact,
  EclipseScene,
  EclipseSummary,
  LocalEclipse,
  Observer,
} from "@found-in-space/shadowline";
import { ecefToGeodetic } from "@found-in-space/shadowline";
import { MapLibreGlobeRenderer } from "./maplibre-renderer.js";
import type { LeafletMercatorRenderer } from "./leaflet-renderer.js";
import type { TrackerGroundView } from "./tracker-ground-view.js";
import type { TrackerShadowView } from "./tracker-shadow-view.js";
import {
  configureOperationalDeltaT202608,
  solarDiscGeometry,
  solarHorizonGeometry,
} from "./tracker-astronomy.js";
import { SolarPreviewRenderer } from "./tracker-solar-preview.js";
import { terrainElevationMeters } from "./tracker-terrain.js";
import { TrackerWorkerClient } from "./tracker-worker-client.js";

const CLOCK_URL = "https://data.foundin.space/api/v1/time";
const LOCATION_URL = "https://data.foundin.space/api/v1/location";
const LOCATION_STORAGE_KEY = "shadowline-tracker-202608-location";
const ELEVATION_SOURCE_STORAGE_KEY =
  "shadowline-tracker-202608-elevation-source";
const CLOCK_STORAGE_KEY = "shadowline-tracker-202608-clock";
const CLOCK_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_RESYNC_INTERVAL_MS = 5 * 60 * 1000;
const FALLBACK_RANGE_START = Date.parse("2026-08-12T15:20:00Z");
const FALLBACK_RANGE_END = Date.parse("2026-08-12T20:10:00Z");
const DEFAULT_PREVIEW = Date.parse("2026-08-12T17:46:00Z");

interface NamedContact {
  key: "C1" | "C2" | "MAX" | "C3" | "C4" | "P1" | "P4";
  label: string;
  utc: string;
  contact?: EclipseContact;
}

type LocationSource = "gps" | "geoip" | "manual" | "map" | "saved";
type ElevationSource = "explicit" | "gps" | "terrain" | "pending";
type OverviewView = "globe" | "map" | "shadow" | "ground";

interface ApproximateLocationResponse {
  available?: unknown;
  precision?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}.`);
  return value as T;
};

const modeBadge = element("mode-badge");
const locationLabel = element("location-label");
const locationCoordinates = element("location-coordinates");
const locationMessage = element("location-message");
const gpsButton = element<HTMLButtonElement>("gps-button");
const manualToggle = element<HTMLButtonElement>("manual-toggle");
const manualLocation = element<HTMLFormElement>("manual-location");
const latitudeInput = element<HTMLInputElement>("latitude-input");
const longitudeInput = element<HTMLInputElement>("longitude-input");
const elevationInput = element<HTMLInputElement>("elevation-input");
const countdownHeading = element("countdown-heading");
const nextEventLabel = element("next-event-label");
const countdown = element("countdown");
const nextEventTime = element("next-event-time");
const obscurationValue = element("obscuration-value");
const phaseLabel = element("phase-label");
const solarDisc = element("solar-disc");
const solarPreview = new SolarPreviewRenderer(
  solarDisc,
  element<HTMLCanvasElement>("solar-preview-canvas"),
);
const horizonMarker = element("horizon-marker");
const sunAltitude = element("sun-altitude");
const sunAzimuth = element("sun-azimuth");
const previewTime = element("preview-time");
const previewLocalTime = element("preview-local-time");
const timeSlider = element<HTMLInputElement>("time-slider");
const liveButton = element<HTMLButtonElement>("live-button");
const contactList = element<HTMLOListElement>("contact-list");
const overviewCaption = element("overview-caption");
const overviewHint = element("overview-hint");
const overviewFollow = element<HTMLButtonElement>("overview-follow");
const overviewTabs: Record<OverviewView, HTMLButtonElement> = {
  globe: element<HTMLButtonElement>("globe-tab"),
  map: element<HTMLButtonElement>("map-tab"),
  shadow: element<HTMLButtonElement>("shadow-tab"),
  ground: element<HTMLButtonElement>("ground-tab"),
};
const overviewPanes: Record<OverviewView, HTMLElement> = {
  globe: element("tracker-globe"),
  map: element("tracker-map"),
  shadow: element("tracker-shadow"),
  ground: element("tracker-ground"),
};

configureOperationalDeltaT202608();
const worker = new TrackerWorkerClient();
const globe = new MapLibreGlobeRenderer(element("tracker-globe"));
globe.setLayerVisibility({
  centralPath: false,
  partialExtent: false,
  horizonLimits: false,
  contacts: false,
  localPenumbra: true,
  localCentralShadow: true,
  centerAndLimits: true,
  timeMarkers: false,
});

let event: EclipseSummary | null = null;
let overviewScene: EclipseScene | null = null;
let observer: Observer | null = null;
let localEclipse: LocalEclipse | null = null;
let localCalculationPending = false;
let followLive = true;
let previewTimeMs = DEFAULT_PREVIEW;
let clockOffsetMs = 0;
let clockSyncPending = false;
let rangeStartMs = FALLBACK_RANGE_START;
let rangeEndMs = FALLBACK_RANGE_END;
let locationVersion = 0;
let shadowVersion = 0;
let lastShadowBucket = Number.NaN;
let lastDiscBucket = Number.NaN;
let activeOverviewView: OverviewView = "globe";
let mercator: LeafletMercatorRenderer | null = null;
let shadowView: TrackerShadowView | null = null;
let groundView: TrackerGroundView | null = null;
let mapFollowingShadow = true;
let instantaneousScene: EclipseScene | null = null;
let currentSolarGeometry: ReturnType<typeof solarDiscGeometry> | null = null;
let globeOverviewCaption = "";
let shadowOverviewCaption = "";
let groundOverviewCaption = "";
let mercatorModulePromise: Promise<typeof import("./leaflet-renderer.js")> | null = null;
let shadowModulePromise: Promise<typeof import("./tracker-shadow-view.js")> | null = null;
let groundModulePromise: Promise<typeof import("./tracker-ground-view.js")> | null = null;

function loadMercatorModule(): Promise<typeof import("./leaflet-renderer.js")> {
  mercatorModulePromise ??= import("./leaflet-renderer.js");
  return mercatorModulePromise;
}

function loadShadowModule(): Promise<typeof import("./tracker-shadow-view.js")> {
  shadowModulePromise ??= import("./tracker-shadow-view.js");
  return shadowModulePromise;
}

function loadGroundModule(): Promise<typeof import("./tracker-ground-view.js")> {
  groundModulePromise ??= import("./tracker-ground-view.js");
  return groundModulePromise;
}

function currentTrackerTime(): number {
  return followLive ? monotonicEpochNow() : previewTimeMs;
}

function shadowCentre(scene: EclipseScene): {
  latitudeDeg: number;
  longitudeDeg: number;
} | null {
  const shadow = scene.instantaneousShadows[0];
  const region = shadow?.central?.region ?? shadow?.penumbra;
  const ring = region?.rings.length
    ? region.rings.reduce((largest, candidate) =>
        candidate.points.length > largest.points.length ? candidate : largest
      )
    : undefined;
  if (!ring || ring.points.length === 0) return null;

  const sum = ring.points.reduce(
    (total, point) => ({
      x: total.x + point.ecefKm.x,
      y: total.y + point.ecefKm.y,
      z: total.z + point.ecefKm.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const average = {
    x: sum.x / ring.points.length,
    y: sum.y / ring.points.length,
    z: sum.z / ring.points.length,
  };
  if (Math.hypot(average.x, average.y, average.z) < 100) return null;
  return ecefToGeodetic(average);
}

function followMercatorShadow(scene = instantaneousScene): void {
  if (!mercator || !mapFollowingShadow || !scene) return;
  const centre = shadowCentre(scene);
  if (!centre) return;
  mercator.map.panTo(
    [centre.latitudeDeg, centre.longitudeDeg],
    { animate: false },
  );
  overviewPanes.map.dataset.followLatitude = centre.latitudeDeg.toFixed(5);
  overviewPanes.map.dataset.followLongitude = centre.longitudeDeg.toFixed(5);
}

function updateFollowControl(): void {
  overviewFollow.hidden = activeOverviewView === "globe" || activeOverviewView === "ground";
  if (activeOverviewView === "globe" || activeOverviewView === "ground") return;
  const following = activeOverviewView === "map"
    ? mapFollowingShadow
    : shadowView?.isFollowingShadow() ?? true;
  overviewFollow.setAttribute("aria-pressed", String(following));
  overviewFollow.textContent = following ? "Following shadow" : "Follow shadow";
}

function setMapFollowingShadow(following: boolean): void {
  if (mapFollowingShadow === following) return;
  mapFollowingShadow = following;
  overviewPanes.map.dataset.followingShadow = String(following);
  if (following) followMercatorShadow();
  updateFollowControl();
  if (activeOverviewView === "map") showOverviewCaption();
}

function showOverviewCaption(): void {
  let caption = "";
  if (activeOverviewView === "globe") {
    caption = globeOverviewCaption;
    overviewHint.textContent = "Drag to explore · tap to choose a location";
  } else if (activeOverviewView === "map") {
    caption = globeOverviewCaption;
    overviewHint.textContent = mapFollowingShadow
      ? "Drag or zoom to hold another view · tap to choose"
      : "Drag to move · pinch to zoom · tap to choose";
  } else if (activeOverviewView === "shadow") {
    const following = shadowView?.isFollowingShadow() ?? true;
    caption = shadowOverviewCaption;
    overviewHint.textContent = following
      ? "Drag or zoom to hold another view"
      : "Drag to turn · pinch to zoom";
  } else {
    caption = groundOverviewCaption;
    overviewHint.textContent = observer
      ? "Fixed view from your chosen location"
      : "Choose a location on the globe or map first";
  }
  overviewCaption.textContent = caption;
  overviewCaption.hidden = caption === "";
}

async function ensureMercator(): Promise<LeafletMercatorRenderer> {
  if (mercator) return mercator;
  const module = await loadMercatorModule();
  const initialLatitude = observer?.latitudeDeg ?? event?.peakLocation?.latitudeDeg ?? 60;
  const initialLongitude = observer?.longitudeDeg ?? event?.peakLocation?.longitudeDeg ?? -20;
  mercator = new module.LeafletMercatorRenderer(overviewPanes.map, {
    latitude: initialLatitude,
    longitude: initialLongitude,
    zoom: observer ? 5 : 2,
  });
  mercator.setLayerVisibility({
    centralPath: false,
    partialExtent: false,
    horizonLimits: false,
    contacts: false,
    localPenumbra: true,
    localCentralShadow: true,
    centerAndLimits: true,
    timeMarkers: false,
  });
  mercator.onLocation = (selected) => {
    void setObserver(selected, "map", true);
  };
  if (overviewScene) {
    mercator.showPath(overviewScene);
    if (!observer) mercator.fitPath();
  }
  if (instantaneousScene) mercator.showShadowOutline(instantaneousScene);
  if (observer) mercator.setLocation(observer);
  overviewPanes.map.dataset.followingShadow = String(mapFollowingShadow);
  mercator.map.on("dragstart", () => setMapFollowingShadow(false));
  mercator.map.on("zoomstart", () => setMapFollowingShadow(false));
  followMercatorShadow();
  return mercator;
}

async function ensureShadowView(): Promise<TrackerShadowView> {
  if (shadowView) return shadowView;
  const module = await loadShadowModule();
  shadowView = new module.TrackerShadowView(overviewPanes.shadow, {
    onStatus: (message) => {
      shadowOverviewCaption = message;
      if (activeOverviewView === "shadow") showOverviewCaption();
    },
    onFollowingChange: () => {
      updateFollowControl();
      if (activeOverviewView === "shadow") showOverviewCaption();
    },
  });
  shadowView.setTime(currentTrackerTime());
  return shadowView;
}

async function ensureGroundView(): Promise<TrackerGroundView> {
  if (groundView) return groundView;
  const module = await loadGroundModule();
  groundView = new module.TrackerGroundView(overviewPanes.ground, {
    onStatus: (message) => {
      groundOverviewCaption = message;
      if (activeOverviewView === "ground") showOverviewCaption();
    },
  });
  groundView.setTime(currentSolarGeometry);
  if (observer) {
    if (localCalculationPending) groundView.setLocationPending(observer);
    else groundView.setLocation(observer, rangeStartMs, rangeEndMs);
  }
  return groundView;
}

async function selectOverviewView(view: OverviewView, focus = false): Promise<void> {
  activeOverviewView = view;
  for (const [name, tab] of Object.entries(overviewTabs) as [OverviewView, HTMLButtonElement][]) {
    const selected = name === view;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    overviewPanes[name].hidden = !selected;
  }
  shadowView?.setActive(view === "shadow");
  groundView?.setActive(view === "ground");
  updateFollowControl();
  showOverviewCaption();
  try {
    if (view === "map") await ensureMercator();
    if (view === "shadow") {
      const renderer = await ensureShadowView();
      renderer.setActive(true);
      renderer.setTime(currentTrackerTime());
    }
    if (view === "ground") {
      const renderer = await ensureGroundView();
      renderer.setActive(true);
      renderer.setTime(currentSolarGeometry);
    }
    updateFollowControl();
    showOverviewCaption();
  } catch (error) {
    console.error(error);
    overviewCaption.textContent = view === "map"
      ? "The map could not load. The globe is still available."
      : view === "shadow"
        ? "The shadow view is unavailable. The globe is still available."
        : "The ground view could not load. The other views are still available.";
    overviewCaption.hidden = false;
  }
  if (focus) overviewPanes[view].focus({ preventScroll: true });
}

function connectionAllowsBackgroundLoad(): boolean {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return navigator.onLine && connection?.saveData !== true && connection?.effectiveType !== "slow-2g";
}

function scheduleWhenIdle(task: () => Promise<unknown>, delayMs: number): void {
  window.setTimeout(() => {
    if (!connectionAllowsBackgroundLoad()) return;
    const run = () => void task().catch(() => {
      // Optional views still load on demand if background preparation fails.
    });
    const idleCallback = (window as Window & {
      requestIdleCallback?: Window["requestIdleCallback"];
    }).requestIdleCallback;
    if (idleCallback) {
      idleCallback(run, { timeout: 12_000 });
    } else {
      globalThis.setTimeout(run, 1_000);
    }
  }, delayMs);
}

function scheduleOptionalViewPreload(): void {
  const schedule = () => {
    scheduleWhenIdle(() => loadMercatorModule(), 2_000);
    scheduleWhenIdle(async () => {
      await loadMercatorModule();
      await loadGroundModule();
      const module = await loadShadowModule();
      await module.preloadTrackerShadowAssets();
      document.documentElement.dataset.optionalViewsReady = "true";
    }, 7_000);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}

function monotonicEpochNow(): number {
  return performance.timeOrigin + performance.now() + clockOffsetMs;
}

function coordinates(observerValue: Observer): string {
  const latitude = Math.abs(observerValue.latitudeDeg).toFixed(5);
  const longitude = Math.abs(observerValue.longitudeDeg).toFixed(5);
  const northSouth = observerValue.latitudeDeg >= 0 ? "N" : "S";
  const eastWest = observerValue.longitudeDeg >= 0 ? "E" : "W";
  return `${latitude}° ${northSouth}, ${longitude}° ${eastWest} · ${Math.round(observerValue.elevationMeters ?? 0)} m above sea level`;
}

function coordinateInputValue(value: number): string {
  // Five decimal places resolve to roughly one metre of latitude, which is
  // already finer than a phone location while avoiding raw GPS float noise.
  return String(Number(value.toFixed(5)));
}

function updateElevationInput(
  observerValue: Observer,
  source: ElevationSource,
): void {
  const calculated = source === "terrain" || source === "pending";
  elevationInput.value = calculated
    ? ""
    : String(Math.round(observerValue.elevationMeters ?? 0));
  elevationInput.placeholder = source === "terrain"
    ? `Estimated: ${Math.round(observerValue.elevationMeters ?? 0)} m`
    : "Estimated if blank";
  elevationInput.dataset.source = source;
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

function sunHeight(degrees: number): string {
  if (Math.abs(degrees) < 0.05) return "at the horizon";
  return `${Math.abs(degrees).toFixed(1)}° ${degrees > 0 ? "above" : "below"} the horizon`;
}

function utcTime(value: string | number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function localTime(value: string | number): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value))} · ${zone}`;
}

function previewDate(value: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function localContacts(local: LocalEclipse): NamedContact[] {
  return [
    { key: "C1", label: "Partial eclipse begins", utc: local.partialBegin.utc, contact: local.partialBegin },
    ...(local.centralBegin
      ? [{ key: "C2" as const, label: "Totality begins", utc: local.centralBegin.utc, contact: local.centralBegin }]
      : []),
    { key: "MAX", label: "Most coverage at your location", utc: local.peak.utc, contact: local.peak },
    ...(local.centralEnd
      ? [{ key: "C3" as const, label: "Totality ends", utc: local.centralEnd.utc, contact: local.centralEnd }]
      : []),
    { key: "C4", label: "Partial eclipse ends", utc: local.partialEnd.utc, contact: local.partialEnd },
  ];
}

function globalContacts(scene: EclipseScene): NamedContact[] {
  const first = scene.contacts[0];
  const last = scene.contacts.at(-1);
  return [
    ...(first ? [{ key: "P1" as const, label: "Eclipse begins somewhere on Earth", utc: first.utc }] : []),
    { key: "MAX", label: "Eclipse at its greatest", utc: scene.event.peakUtc },
    ...(last ? [{ key: "P4" as const, label: "Eclipse ends on Earth", utc: last.utc }] : []),
  ];
}

function activeContacts(): NamedContact[] {
  if (observer) return localEclipse ? localContacts(localEclipse) : [];
  return overviewScene ? globalContacts(overviewScene) : [];
}

function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const time = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return days > 0 ? `${days}d ${time}` : time;
}

function currentPhase(atMs: number): string {
  if (localCalculationPending) return "—";
  if (!localEclipse) return observer ? "Not visible here" : "Choose your location";
  const c1 = Date.parse(localEclipse.partialBegin.utc);
  const c4 = Date.parse(localEclipse.partialEnd.utc);
  const c2 = localEclipse.centralBegin ? Date.parse(localEclipse.centralBegin.utc) : null;
  const c3 = localEclipse.centralEnd ? Date.parse(localEclipse.centralEnd.utc) : null;
  if (atMs < c1) return "Before the eclipse begins";
  if (atMs > c4) return "Eclipse complete";
  if (c2 !== null && c3 !== null && atMs >= c2 && atMs <= c3) return "Totality";
  return "Partial eclipse";
}

function renderCountdown(atMs: number): void {
  const contacts = activeContacts();
  const next = contacts.find((contact) => Date.parse(contact.utc) > atMs);
  countdownHeading.textContent = observer
    ? "Next at this location"
    : "Next eclipse event";
  if (!observer && !overviewScene) {
    nextEventLabel.textContent = "Choose a location";
    countdown.textContent = "--:--:--";
    return;
  }
  if (localCalculationPending) {
    nextEventLabel.textContent = "—";
    countdown.textContent = "--:--:--";
    nextEventTime.textContent = "";
    return;
  }
  if (observer && !localEclipse) {
    nextEventLabel.textContent = "Eclipse not visible here";
    countdown.textContent = "—";
    nextEventTime.textContent = "Choose another location on the map or enter a different location.";
    return;
  }
  if (!next) {
    nextEventLabel.textContent = "Eclipse complete";
    countdown.textContent = "00:00:00";
    nextEventTime.textContent = "The eclipse has finished at this location.";
    return;
  }
  nextEventLabel.textContent = next.label;
  countdown.textContent = formatCountdown(Date.parse(next.utc) - atMs);
  nextEventTime.textContent = `${utcTime(next.utc)} UTC · ${localTime(next.utc)}`;
}

function renderContactList(atMs: number): void {
  const contacts = localEclipse ? localContacts(localEclipse) : [];
  if (contacts.length === 0) {
    if (localCalculationPending) {
      contactList.replaceChildren();
      return;
    }
    const message = observer
      ? "The eclipse is not visible from this location."
      : "Choose a location to see when the eclipse begins, reaches its maximum and ends.";
    contactList.innerHTML = `<li class="placeholder-contact">${message}</li>`;
    return;
  }
  contactList.innerHTML = contacts
    .map((contact) => {
      const contactMs = Date.parse(contact.utc);
      const state = atMs >= contactMs ? "is-past" : "";
      const altitude = contact.contact
        ? `<span>Sun ${sunHeight(contact.contact.sunAltitudeDeg)} · facing ${compassDirection(contact.contact.sunAzimuthDeg)}</span>`
        : "";
      return `<li class="${state}"><div><strong>${contact.label}</strong>${altitude}</div><time datetime="${contact.utc}">${utcTime(contact.utc)}</time></li>`;
    })
    .join("");
}

function renderDisc(atMs: number): void {
  if (!observer) {
    currentSolarGeometry = null;
    groundView?.setTime(null);
    obscurationValue.textContent = "—";
    phaseLabel.textContent = "Choose your location";
    solarPreview.clear();
    horizonMarker.hidden = true;
    solarDisc.classList.remove("is-horizon-crossing", "is-below-horizon");
    delete solarDisc.dataset.horizon;
    return;
  }
  try {
    const geometry = solarDiscGeometry(observer, new Date(atMs));
    currentSolarGeometry = geometry;
    groundView?.setTime(geometry);
    const horizon = solarHorizonGeometry(
      geometry.sunAltitudeDeg,
      geometry.sunRadiusDeg,
    );
    solarPreview.render(geometry, horizon);
    obscurationValue.textContent = `${(geometry.obscuration * 100).toFixed(1)}% covered`;
    phaseLabel.textContent = currentPhase(atMs);
    solarDisc.classList.toggle("is-horizon-crossing", horizon.state === "crossing");
    solarDisc.classList.toggle("is-below-horizon", horizon.state === "below");
    solarDisc.dataset.horizon = horizon.state;
    horizonMarker.hidden = horizon.state === "above";
    horizonMarker.textContent = horizon.state === "crossing"
      ? "Partly below horizon"
      : "Below horizon";
    sunAltitude.textContent = sunHeight(geometry.sunAltitudeDeg);
    sunAzimuth.textContent = `${compassDirection(geometry.sunAzimuthDeg)} · ${geometry.sunAzimuthDeg.toFixed(1)}°`;
    const horizonDescription = geometry.sunAltitudeDeg < 0
      ? `${Math.abs(geometry.sunAltitudeDeg).toFixed(1)} degrees below the horizon`
      : `${geometry.sunAltitudeDeg.toFixed(1)} degrees above the horizon`;
    const horizonVisibilityDescription = horizon.state === "crossing"
      ? "The horizon crosses the solar disc."
      : horizon.state === "below"
        ? "The Sun is entirely below the horizon."
        : "";
    solarDisc.setAttribute(
      "aria-label",
      `The Sun is predicted to be ${(geometry.obscuration * 100).toFixed(1)} percent covered. It is ${horizonDescription}. ${horizonVisibilityDescription}`.trim(),
    );
  } catch (error) {
    console.error(error);
    currentSolarGeometry = null;
    groundView?.setTime(null);
    phaseLabel.textContent = "Preview unavailable";
  }
}

function updatePreviewReadout(atMs: number): void {
  previewTime.textContent = `${previewDate(atMs)} UTC`;
  previewLocalTime.textContent = localTime(atMs);
  modeBadge.textContent = followLive ? "LIVE" : "PREVIEW";
  modeBadge.classList.toggle("is-preview", !followLive);
  liveButton.hidden = followLive;
  if (!followLive) timeSlider.value = String(Math.round((atMs - rangeStartMs) / 1000));
}

async function updateShadow(atMs: number): Promise<void> {
  if (!event || atMs < rangeStartMs - 3_600_000 || atMs > rangeEndMs + 3_600_000) {
    instantaneousScene = null;
    globe.clearShadowOutline();
    mercator?.clearShadowOutline();
    return;
  }
  const version = ++shadowVersion;
  try {
    const result = await worker.calculateShadow(new Date(atMs).toISOString());
    if (version !== shadowVersion) return;
    instantaneousScene = result.scene;
    globe.showShadowOutline(result.scene);
    mercator?.showShadowOutline(result.scene);
    followMercatorShadow(result.scene);
  } catch {
    if (version === shadowVersion) {
      instantaneousScene = null;
      globe.clearShadowOutline();
      mercator?.clearShadowOutline();
    }
  }
}

function setPreview(value: number): void {
  followLive = false;
  previewTimeMs = Math.max(rangeStartMs, Math.min(rangeEndMs, value));
  const url = new URL(location.href);
  url.searchParams.set("at", new Date(previewTimeMs).toISOString());
  history.replaceState(null, "", url);
  lastDiscBucket = Number.NaN;
  lastShadowBucket = Number.NaN;
  renderFrame();
}

function renderFrame(): void {
  const atMs = followLive ? monotonicEpochNow() : previewTimeMs;
  updatePreviewReadout(atMs);
  renderCountdown(atMs);
  const discBucket = Math.floor(atMs / 250);
  if (discBucket !== lastDiscBucket) {
    lastDiscBucket = discBucket;
    renderDisc(atMs);
    renderContactList(atMs);
  }
  const shadowBucket = Math.floor(atMs / (followLive ? 15_000 : 1_000));
  if (shadowBucket !== lastShadowBucket) {
    lastShadowBucket = shadowBucket;
    void updateShadow(atMs);
  }
  if (activeOverviewView === "shadow") shadowView?.setTime(atMs);
}

function updateRange(): void {
  const contacts = localEclipse ? localContacts(localEclipse) : overviewScene ? globalContacts(overviewScene) : [];
  if (contacts.length > 0) {
    rangeStartMs = Date.parse(contacts[0]!.utc) - 20 * 60 * 1000;
    rangeEndMs = Date.parse(contacts.at(-1)!.utc) + 20 * 60 * 1000;
  }
  timeSlider.min = "0";
  timeSlider.max = String(Math.round((rangeEndMs - rangeStartMs) / 1000));
  if (!followLive) {
    previewTimeMs = Math.max(rangeStartMs, Math.min(rangeEndMs, previewTimeMs));
  }
  timeSlider.value = String(Math.round((Math.max(rangeStartMs, Math.min(rangeEndMs, previewTimeMs)) - rangeStartMs) / 1000));
}

async function setObserver(
  nextObserver: Observer,
  source: LocationSource,
  refineTerrain = false,
  elevationSource: ElevationSource = refineTerrain
    ? "pending"
    : source === "gps"
      ? "gps"
      : "explicit",
): Promise<void> {
  const version = ++locationVersion;
  observer = nextObserver;
  localEclipse = null;
  localCalculationPending = true;
  currentSolarGeometry = null;
  groundView?.setLocationPending(nextObserver);
  groundView?.setTime(null);
  globe.setLocation(nextObserver);
  mercator?.setLocation(nextObserver);
  locationLabel.textContent = source === "gps"
    ? "Location from GPS"
    : source === "geoip"
      ? "Rough location"
      : source === "saved"
        ? "Saved location"
        : source === "map"
          ? "Location chosen on the map"
          : "Entered location";
  locationCoordinates.textContent = coordinates(nextObserver);
  locationMessage.textContent = "";
  latitudeInput.value = coordinateInputValue(nextObserver.latitudeDeg);
  longitudeInput.value = coordinateInputValue(nextObserver.longitudeDeg);
  updateElevationInput(nextObserver, elevationSource);
  if (source !== "geoip") {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(nextObserver));
    localStorage.setItem(
      ELEVATION_SOURCE_STORAGE_KEY,
      elevationSource === "pending" ? "terrain" : elevationSource,
    );
  }
  const url = new URL(location.href);
  url.searchParams.set("lat", nextObserver.latitudeDeg.toFixed(6));
  url.searchParams.set("lon", nextObserver.longitudeDeg.toFixed(6));
  if (elevationSource === "explicit" || elevationSource === "gps") {
    url.searchParams.set(
      "elevation",
      String(Math.round(nextObserver.elevationMeters ?? 0)),
    );
  } else {
    url.searchParams.delete("elevation");
  }
  if (source === "geoip") url.searchParams.set("location", "geoip");
  else url.searchParams.delete("location");
  history.replaceState(null, "", url);
  lastDiscBucket = Number.NaN;
  if (refineTerrain && navigator.onLine) {
    void terrainElevationMeters(
      nextObserver.latitudeDeg,
      nextObserver.longitudeDeg,
    ).then((elevationMeters) => {
      if (
        version !== locationVersion ||
        !Number.isFinite(elevationMeters)
      ) return;
      void setObserver(
        { ...nextObserver, elevationMeters },
        source,
        false,
        "terrain",
      );
    }).catch(() => {
      // Local circumstances already use the supplied height, so terrain
      // lookup failure never blocks the field view.
    });
  }
  try {
    const result = await worker.calculateLocation(nextObserver);
    if (version !== locationVersion) return;
    localEclipse = result.local;
    localCalculationPending = false;
    const approximationDetail = source === "geoip"
      ? " This is only a rough location. Use GPS or enter a location before relying on these times."
      : "";
    locationMessage.textContent = result.local
      ? `${result.local.kind === "total" ? "You can see totality" : "You can see a partial eclipse"} from this location.${approximationDetail}`
      : `The eclipse will not be visible from this location.${approximationDetail}`;
    updateRange();
    groundView?.setLocation(nextObserver, rangeStartMs, rangeEndMs);
    renderFrame();
  } catch (error) {
    if (version !== locationVersion) return;
    console.error(error);
    localCalculationPending = false;
    groundView?.setLocation(nextObserver, rangeStartMs, rangeEndMs);
    locationMessage.textContent = "We could not work out the eclipse times. Try again or choose another location.";
  }
}

async function resolveApproximateLocation(): Promise<void> {
  if (!event || !navigator.onLine || observer || locationVersion !== 0) return;
  const version = locationVersion;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(LOCATION_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return;
    const payload = (await response.json()) as ApproximateLocationResponse;
    if (
      payload.available !== true ||
      payload.precision !== "ip" ||
      typeof payload.latitude !== "number" ||
      !Number.isFinite(payload.latitude) ||
      payload.latitude < -90 ||
      payload.latitude > 90 ||
      typeof payload.longitude !== "number" ||
      !Number.isFinite(payload.longitude) ||
      payload.longitude < -180 ||
      payload.longitude > 180 ||
      observer ||
      version !== locationVersion
    ) return;
    await setObserver(
      {
        latitudeDeg: payload.latitude,
        longitudeDeg: payload.longitude,
        elevationMeters: 0,
      },
      "geoip",
      true,
    );
  } catch {
    // Network location is only a convenience fallback. GPS, manual entry,
    // saved coordinates and globe selection remain fully available.
  } finally {
    window.clearTimeout(timeout);
  }
}

function observerFromUrl(): Observer | null {
  const query = new URL(location.href).searchParams;
  const latitudeValue = query.get("lat");
  const longitudeValue = query.get("lon");
  if (latitudeValue === null || longitudeValue === null) return null;
  const latitudeDeg = Number(latitudeValue);
  const longitudeDeg = Number(longitudeValue);
  const elevationMeters = Number(query.get("elevation") ?? 0);
  return Number.isFinite(latitudeDeg) && latitudeDeg >= -90 && latitudeDeg <= 90 && Number.isFinite(longitudeDeg) && longitudeDeg >= -180 && longitudeDeg <= 180 && Number.isFinite(elevationMeters)
    ? { latitudeDeg, longitudeDeg, elevationMeters }
    : null;
}

function savedObserver(): Observer | null {
  try {
    const value = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) ?? "null") as Observer | null;
    return value &&
      Number.isFinite(value.latitudeDeg) && value.latitudeDeg >= -90 && value.latitudeDeg <= 90 &&
      Number.isFinite(value.longitudeDeg) && value.longitudeDeg >= -180 && value.longitudeDeg <= 180 &&
      (value.elevationMeters === undefined || Number.isFinite(value.elevationMeters))
      ? value
      : null;
  } catch {
    return null;
  }
}

function savedElevationSource(): ElevationSource {
  const value = localStorage.getItem(ELEVATION_SOURCE_STORAGE_KEY);
  return value === "gps" || value === "terrain" || value === "explicit"
    ? value
    : "explicit";
}

function restorePreviewFromUrl(): void {
  const value = new URL(location.href).searchParams.get("at");
  if (value === null) return;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return;
  followLive = false;
  previewTimeMs = Math.max(FALLBACK_RANGE_START, Math.min(FALLBACK_RANGE_END, parsed));
}

interface ClockCalibration {
  offsetMs: number;
  roundTripMs: number;
  calibratedAtMs: number;
}

function calibrationAge(calibration: ClockCalibration): number {
  return Date.now() + calibration.offsetMs - calibration.calibratedAtMs;
}

function loadCachedClock(): void {
  try {
    const calibration = JSON.parse(
      localStorage.getItem(CLOCK_STORAGE_KEY) ?? "null",
    ) as ClockCalibration | null;
    if (
      !calibration ||
      !Number.isFinite(calibration.offsetMs) ||
      !Number.isFinite(calibration.roundTripMs) ||
      !Number.isFinite(calibration.calibratedAtMs)
    ) return;
    const ageMs = calibrationAge(calibration);
    if (ageMs < 0 || ageMs > CLOCK_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(CLOCK_STORAGE_KEY);
      return;
    }
    clockOffsetMs = calibration.offsetMs;
  } catch {
    localStorage.removeItem(CLOCK_STORAGE_KEY);
  }
}

async function initializeModel(): Promise<void> {
  try {
    const result = await worker.initialize();
    event = result.event;
    overviewScene = result.scene;
    globe.showPath(result.scene);
    globe.showGlobalVisibility(result.scene);
    globe.fitPath();
    globe.showPeak(undefined, undefined);
    mercator?.showPath(result.scene);
    globeOverviewCaption = "Purple shows where the Sun will be completely covered. The shaded areas show where the Moon will cover part or all of the Sun at the chosen time.";
    showOverviewCaption();
    updateRange();
    renderFrame();
    const urlObserver = observerFromUrl();
    const initialObserver = urlObserver ?? savedObserver();
    if (initialObserver) {
      const hasUrlElevation = new URL(location.href).searchParams.has("elevation");
      const source: LocationSource = urlObserver
        ? new URL(location.href).searchParams.get("location") === "geoip"
          ? "geoip"
          : "manual"
        : "saved";
      void setObserver(
        initialObserver,
        source,
        Boolean(urlObserver && !hasUrlElevation),
        urlObserver
          ? hasUrlElevation ? "explicit" : "pending"
          : savedElevationSource(),
      );
    } else {
      void resolveApproximateLocation();
    }
  } catch (error) {
    console.error(error);
    globeOverviewCaption = "The eclipse map could not load. Reload the page to try again.";
    showOverviewCaption();
  }
}

async function syncClock(): Promise<void> {
  if (!navigator.onLine || clockSyncPending) return;
  clockSyncPending = true;
  const samples: Array<{ offset: number; roundTrip: number }> = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_500);
    const sent = performance.timeOrigin + performance.now();
    try {
      const response = await fetch(CLOCK_URL, { cache: "no-store", signal: controller.signal });
      const received = performance.timeOrigin + performance.now();
      if (!response.ok) throw new Error(`Clock returned ${response.status}.`);
      const payload = (await response.json()) as Record<string, unknown>;
      const server = Number(payload["unixTimeMs"] ?? payload["epochMilliseconds"] ?? payload["now"]);
      if (!Number.isFinite(server)) throw new Error("Clock response had no timestamp.");
      samples.push({ offset: server - (sent + received) / 2, roundTrip: received - sent });
    } catch {
      // The device clock remains a safe offline fallback.
    } finally {
      window.clearTimeout(timeout);
    }
  }
  try {
    const best = samples.sort((first, second) => first.roundTrip - second.roundTrip)[0];
    if (!best) return;
    clockOffsetMs = best.offset;
    const calibration: ClockCalibration = {
      offsetMs: best.offset,
      roundTripMs: best.roundTrip,
      calibratedAtMs: Date.now() + best.offset,
    };
    localStorage.setItem(CLOCK_STORAGE_KEY, JSON.stringify(calibration));
  } finally {
    clockSyncPending = false;
  }
}

async function prepareOffline(): Promise<void> {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) {
    return;
  }
  try {
    const serviceWorkerUrl = new URL("./service-worker.js", location.href);
    const registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
      scope: "./",
      updateViaCache: "none",
    });
    if (navigator.onLine) await registration.update();
    await navigator.serviceWorker.ready;
  } catch {
    // Offline support is optional; the live tracker remains available.
  }
}

gpsButton.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    locationMessage.textContent = "GPS is not available in this browser. Enter a location instead.";
    return;
  }
  gpsButton.disabled = true;
  gpsButton.textContent = "Finding GPS…";
  locationMessage.textContent = "";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      gpsButton.disabled = false;
      gpsButton.textContent = "Update GPS";
      const hasGpsAltitude = position.coords.altitude !== null;
      void setObserver(
        {
          latitudeDeg: position.coords.latitude,
          longitudeDeg: position.coords.longitude,
          elevationMeters: position.coords.altitude ?? 0,
        },
        "gps",
        !hasGpsAltitude,
      );
    },
    (error) => {
      gpsButton.disabled = false;
      gpsButton.textContent = "Use my GPS";
      locationMessage.textContent = error.code === 1
        ? "Location access was not allowed. Enter a location instead."
        : error.code === 2
          ? "Your location could not be found. Try again or enter it yourself."
          : "GPS took too long. Try again or enter a location instead.";
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 },
  );
});

manualToggle.addEventListener("click", () => {
  const expanded = manualToggle.getAttribute("aria-expanded") === "true";
  manualToggle.setAttribute("aria-expanded", String(!expanded));
  manualLocation.hidden = expanded;
  if (!expanded) latitudeInput.focus();
});

manualLocation.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();
  if (!manualLocation.reportValidity()) return;
  void setObserver(
    {
      latitudeDeg: Number(latitudeInput.value),
      longitudeDeg: Number(longitudeInput.value),
      elevationMeters: Number(elevationInput.value || 0),
    },
    "manual",
    elevationInput.value === "",
  );
  manualLocation.hidden = true;
  manualToggle.setAttribute("aria-expanded", "false");
});

globe.onLocation = (selected) => {
  void setObserver(selected, "map", true);
};

const overviewViewOrder: OverviewView[] = ["globe", "map", "shadow", "ground"];
for (const [view, tab] of Object.entries(overviewTabs) as [OverviewView, HTMLButtonElement][]) {
  tab.addEventListener("click", () => {
    void selectOverviewView(view);
  });
  tab.addEventListener("keydown", (keyboardEvent) => {
    const currentIndex = overviewViewOrder.indexOf(view);
    const targetIndex = keyboardEvent.key === "ArrowRight"
      ? (currentIndex + 1) % overviewViewOrder.length
      : keyboardEvent.key === "ArrowLeft"
        ? (currentIndex - 1 + overviewViewOrder.length) % overviewViewOrder.length
        : keyboardEvent.key === "Home"
          ? 0
          : keyboardEvent.key === "End"
            ? overviewViewOrder.length - 1
            : -1;
    if (targetIndex < 0) return;
    keyboardEvent.preventDefault();
    const targetView = overviewViewOrder[targetIndex]!;
    overviewTabs[targetView].focus();
    void selectOverviewView(targetView);
  });
}

overviewFollow.addEventListener("click", () => {
  if (activeOverviewView === "map") {
    setMapFollowingShadow(true);
  } else if (activeOverviewView === "shadow") {
    shadowView?.resumeFollowing();
  }
});

timeSlider.addEventListener("input", () => {
  setPreview(rangeStartMs + Number(timeSlider.value) * 1000);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-nudge]")) {
  button.addEventListener("click", () => {
    const base = followLive ? monotonicEpochNow() : previewTimeMs;
    setPreview(base + Number(button.dataset.nudge) * 1000);
  });
}

liveButton.addEventListener("click", () => {
  followLive = true;
  const url = new URL(location.href);
  url.searchParams.delete("at");
  history.replaceState(null, "", url);
  lastDiscBucket = Number.NaN;
  lastShadowBucket = Number.NaN;
  renderFrame();
});

window.addEventListener("online", () => {
  void syncClock();
  void resolveApproximateLocation();
  scheduleOptionalViewPreload();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void syncClock();
});

restorePreviewFromUrl();
loadCachedClock();
updateRange();
renderFrame();
void initializeModel();
void syncClock();
void prepareOffline();
scheduleOptionalViewPreload();
window.setInterval(renderFrame, 250);
window.setInterval(() => void syncClock(), CLOCK_RESYNC_INTERVAL_MS);
