import "./tracker-202608.css";

import type {
  EclipseContact,
  EclipseScene,
  EclipseSummary,
  LocalEclipse,
  Observer,
} from "@found-in-space/shadowline";
import { MapLibreGlobeRenderer } from "./maplibre-renderer.js";
import {
  configureOperationalDeltaT202608,
  solarDiscGeometry,
} from "./tracker-astronomy.js";
import { terrainElevationMeters } from "./tracker-terrain.js";
import { TrackerWorkerClient } from "./tracker-worker-client.js";

const CLOCK_URL = "https://data.foundin.space/api/v1/time";
const LOCATION_URL = "https://data.foundin.space/api/v1/location";
const LOCATION_STORAGE_KEY = "shadowline-tracker-202608-location";
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

const networkStatus = element("network-status");
const clockStatus = element("clock-status");
const clockDetail = element("clock-detail");
const offlineStatus = element("offline-status");
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
const moonDisc = element("moon-disc");
const sunAltitude = element("sun-altitude");
const sunAzimuth = element("sun-azimuth");
const previewTime = element("preview-time");
const previewLocalTime = element("preview-local-time");
const timeSlider = element<HTMLInputElement>("time-slider");
const liveButton = element<HTMLButtonElement>("live-button");
const contactList = element<HTMLOListElement>("contact-list");
const globeStatus = element("globe-status");

configureOperationalDeltaT202608();
const worker = new TrackerWorkerClient();
const globe = new MapLibreGlobeRenderer(element("tracker-globe"));

let event: EclipseSummary | null = null;
let overviewScene: EclipseScene | null = null;
let observer: Observer | null = null;
let localEclipse: LocalEclipse | null = null;
let localCalculationPending = false;
let followLive = true;
let previewTimeMs = DEFAULT_PREVIEW;
let clockOffsetMs = 0;
let clockSource: "device" | "cached" | "edge" = "device";
let clockSyncPending = false;
let rangeStartMs = FALLBACK_RANGE_START;
let rangeEndMs = FALLBACK_RANGE_END;
let locationVersion = 0;
let shadowVersion = 0;
let lastShadowBucket = Number.NaN;
let lastDiscBucket = Number.NaN;

function monotonicEpochNow(): number {
  return performance.timeOrigin + performance.now() + clockOffsetMs;
}

function coordinates(observerValue: Observer): string {
  const latitude = Math.abs(observerValue.latitudeDeg).toFixed(5);
  const longitude = Math.abs(observerValue.longitudeDeg).toFixed(5);
  const northSouth = observerValue.latitudeDeg >= 0 ? "N" : "S";
  const eastWest = observerValue.longitudeDeg >= 0 ? "E" : "W";
  return `${latitude}° ${northSouth}, ${longitude}° ${eastWest} · ${Math.round(observerValue.elevationMeters ?? 0)} m`;
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
    { key: "MAX", label: "Local maximum", utc: local.peak.utc, contact: local.peak },
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
    ...(first ? [{ key: "P1" as const, label: "First contact with Earth", utc: first.utc }] : []),
    { key: "MAX", label: "Global maximum", utc: scene.event.peakUtc },
    ...(last ? [{ key: "P4" as const, label: "Last contact with Earth", utc: last.utc }] : []),
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
  if (localCalculationPending) return "Calculating local view";
  if (!localEclipse) return observer ? "Not visible here" : "Set your location";
  const c1 = Date.parse(localEclipse.partialBegin.utc);
  const c4 = Date.parse(localEclipse.partialEnd.utc);
  const c2 = localEclipse.centralBegin ? Date.parse(localEclipse.centralBegin.utc) : null;
  const c3 = localEclipse.centralEnd ? Date.parse(localEclipse.centralEnd.utc) : null;
  if (atMs < c1) return "Before first contact";
  if (atMs > c4) return "Eclipse complete";
  if (c2 !== null && c3 !== null && atMs >= c2 && atMs <= c3) return "Totality";
  return "Partial eclipse";
}

function renderCountdown(atMs: number): void {
  const contacts = activeContacts();
  const next = contacts.find((contact) => Date.parse(contact.utc) > atMs);
  countdownHeading.textContent = observer
    ? "Next at this location"
    : "Next global milestone";
  if (!observer && !overviewScene) {
    nextEventLabel.textContent = "Waiting for eclipse model";
    countdown.textContent = "--:--:--";
    return;
  }
  if (localCalculationPending) {
    nextEventLabel.textContent = "Calculating local contacts";
    countdown.textContent = "--:--:--";
    nextEventTime.textContent = "Using your precise coordinates and elevation.";
    return;
  }
  if (observer && !localEclipse) {
    nextEventLabel.textContent = "Eclipse not visible here";
    countdown.textContent = "—";
    nextEventTime.textContent = "Move the globe or change your coordinates to explore another position.";
    return;
  }
  if (!next) {
    nextEventLabel.textContent = "Eclipse complete";
    countdown.textContent = "00:00:00";
    nextEventTime.textContent = "All contacts at this location have passed.";
    return;
  }
  nextEventLabel.textContent = next.label;
  countdown.textContent = formatCountdown(Date.parse(next.utc) - atMs);
  nextEventTime.textContent = `${utcTime(next.utc)} UTC · ${localTime(next.utc)}`;
}

function renderContactList(atMs: number): void {
  const contacts = localEclipse ? localContacts(localEclipse) : [];
  if (contacts.length === 0) {
    const message = localCalculationPending
      ? "Calculating local contacts…"
      : observer
        ? "The eclipse is not visible from this position."
        : "Choose a location to calculate C1, maximum, C4 and totality.";
    contactList.innerHTML = `<li class="placeholder-contact">${message}</li>`;
    return;
  }
  contactList.innerHTML = contacts
    .map((contact) => {
      const contactMs = Date.parse(contact.utc);
      const state = atMs >= contactMs ? "is-past" : "";
      const altitude = contact.contact
        ? `<span>Sun ${contact.contact.sunAltitudeDeg.toFixed(1)}° high · az ${contact.contact.sunAzimuthDeg.toFixed(1)}°</span>`
        : "";
      return `<li class="${state}"><span class="contact-key">${contact.key}</span><div><strong>${contact.label}</strong>${altitude}</div><time datetime="${contact.utc}">${utcTime(contact.utc)}</time></li>`;
    })
    .join("");
}

function renderDisc(atMs: number): void {
  if (!observer) {
    obscurationValue.textContent = "—";
    phaseLabel.textContent = "Set your location";
    return;
  }
  try {
    const geometry = solarDiscGeometry(observer, new Date(atMs));
    const sunRadiusPixels = 66;
    const x = (geometry.eastOffsetDeg / geometry.sunRadiusDeg) * sunRadiusPixels;
    const y = -(geometry.northOffsetDeg / geometry.sunRadiusDeg) * sunRadiusPixels;
    const moonDiameter =
      2 * sunRadiusPixels * (geometry.moonRadiusDeg / geometry.sunRadiusDeg);
    moonDisc.style.width = `${moonDiameter}px`;
    moonDisc.style.height = `${moonDiameter}px`;
    moonDisc.style.transform = `translate(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px))`;
    obscurationValue.textContent = `${(geometry.obscuration * 100).toFixed(1)}%`;
    phaseLabel.textContent = currentPhase(atMs);
    sunAltitude.textContent = `${geometry.sunAltitudeDeg.toFixed(1)}°`;
    sunAzimuth.textContent = `${geometry.sunAzimuthDeg.toFixed(1)}°`;
    solarDisc.setAttribute(
      "aria-label",
      `Predicted solar disc, ${(geometry.obscuration * 100).toFixed(1)} percent obscured. Sun altitude ${geometry.sunAltitudeDeg.toFixed(1)} degrees.`,
    );
  } catch (error) {
    phaseLabel.textContent = error instanceof Error ? error.message : String(error);
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
    globe.clearShadowOutline();
    return;
  }
  const version = ++shadowVersion;
  try {
    const result = await worker.calculateShadow(new Date(atMs).toISOString());
    if (version !== shadowVersion) return;
    globe.showShadowOutline(result.scene);
  } catch {
    if (version === shadowVersion) globe.clearShadowOutline();
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
  elevationDetail = "",
): Promise<void> {
  const version = ++locationVersion;
  observer = nextObserver;
  localEclipse = null;
  localCalculationPending = true;
  globe.setLocation(nextObserver);
  locationLabel.textContent = source === "gps"
    ? "Current GPS position"
    : source === "geoip"
      ? "Approximate network location"
      : source === "saved"
        ? "Saved observing position"
        : source === "map"
          ? "Position selected on globe"
          : "Manual observing position";
  locationCoordinates.textContent = coordinates(nextObserver);
  locationMessage.textContent = "Calculating local contacts on this device…";
  latitudeInput.value = String(nextObserver.latitudeDeg);
  longitudeInput.value = String(nextObserver.longitudeDeg);
  elevationInput.value = String(nextObserver.elevationMeters ?? 0);
  if (source !== "geoip") {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(nextObserver));
  }
  const url = new URL(location.href);
  url.searchParams.set("lat", nextObserver.latitudeDeg.toFixed(6));
  url.searchParams.set("lon", nextObserver.longitudeDeg.toFixed(6));
  if (nextObserver.elevationMeters) url.searchParams.set("elevation", String(Math.round(nextObserver.elevationMeters)));
  else url.searchParams.delete("elevation");
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
        !Number.isFinite(elevationMeters) ||
        Math.abs(elevationMeters - (nextObserver.elevationMeters ?? 0)) < 0.5
      ) return;
      void setObserver(
        { ...nextObserver, elevationMeters },
        source,
        false,
        `Terrain elevation refined to ${Math.round(elevationMeters)} m from GLO-30.`,
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
      ? " Approximate network location—use GPS or manual coordinates for final contact timing."
      : "";
    locationMessage.textContent = result.local
      ? `${result.local.kind === "total" ? "Totality" : "A partial eclipse"} is visible from this position.${approximationDetail}${elevationDetail ? ` ${elevationDetail}` : ""}`
      : `The 12 August eclipse is not visible from this position.${approximationDetail}${elevationDetail ? ` ${elevationDetail}` : ""}`;
    updateRange();
    renderFrame();
  } catch (error) {
    if (version !== locationVersion) return;
    localCalculationPending = false;
    locationMessage.textContent = `Local calculation failed: ${error instanceof Error ? error.message : String(error)}`;
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
    clockSource = "cached";
    clockStatus.textContent = "Last edge sync";
    clockStatus.classList.add("is-ready");
    const ageMinutes = Math.max(1, Math.round(ageMs / 60_000));
    clockDetail.textContent = `Using an edge-clock calibration from ${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago while a fresh sample is unavailable.`;
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
    globe.showPeak(result.event.peakLocation?.latitudeDeg, result.event.peakLocation?.longitudeDeg);
    globe.fitPath();
    globeStatus.textContent = "Purple marks the path of totality. Gold and plum show the penumbra and central shadow at the preview time.";
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
      );
    } else {
      void resolveApproximateLocation();
    }
  } catch (error) {
    globeStatus.textContent = `The eclipse model could not start: ${error instanceof Error ? error.message : String(error)}`;
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
    if (!best) {
      if (clockSource === "device") {
        clockStatus.textContent = "Device clock";
        clockDetail.textContent = "The CloudFront edge clock could not be reached, so countdowns currently use this device’s clock.";
      }
      return;
    }
    clockOffsetMs = best.offset;
    clockSource = "edge";
    const calibration: ClockCalibration = {
      offsetMs: best.offset,
      roundTripMs: best.roundTrip,
      calibratedAtMs: Date.now() + best.offset,
    };
    localStorage.setItem(CLOCK_STORAGE_KEY, JSON.stringify(calibration));
    clockStatus.textContent = "Edge-synchronised";
    clockStatus.classList.add("is-ready");
    clockDetail.textContent = `Countdown calibrated to the CloudFront edge clock (${Math.round(best.roundTrip)} ms round trip; device adjustment ${best.offset >= 0 ? "+" : ""}${Math.round(best.offset)} ms).`;
  } finally {
    clockSyncPending = false;
  }
}

function updateNetworkStatus(): void {
  const online = navigator.onLine;
  networkStatus.textContent = online ? "Online" : "Offline";
  networkStatus.classList.toggle("is-ready", online);
  networkStatus.classList.toggle("is-offline", !online);
  if (!online && clockSource === "edge") {
    clockStatus.textContent = "Last edge sync";
  }
}

async function prepareOffline(): Promise<void> {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) {
    offlineStatus.textContent = "Offline caching is enabled in the production build.";
    return;
  }
  try {
    const serviceWorkerUrl = new URL("./service-worker.js", location.href);
    await navigator.serviceWorker.register(serviceWorkerUrl, { scope: "./" });
    await navigator.serviceWorker.ready;
    offlineStatus.textContent = "App shell ready offline. Map and terrain tiles are retained as you view them.";
  } catch {
    offlineStatus.textContent = "Offline preparation did not complete; keep this page open in the field.";
  }
}

gpsButton.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    locationMessage.textContent = "This browser does not expose GPS. Enter coordinates manually.";
    return;
  }
  gpsButton.disabled = true;
  gpsButton.textContent = "Finding GPS…";
  locationMessage.textContent = "Waiting for a high-accuracy position…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      gpsButton.disabled = false;
      gpsButton.textContent = "Refresh GPS";
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
      locationMessage.textContent = `${error.message} Enter coordinates manually if needed.`;
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
  updateNetworkStatus();
  void syncClock();
  void resolveApproximateLocation();
});
window.addEventListener("offline", updateNetworkStatus);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void syncClock();
});

restorePreviewFromUrl();
loadCachedClock();
updateNetworkStatus();
updateRange();
renderFrame();
void initializeModel();
void syncClock();
void prepareOffline();
window.setInterval(renderFrame, 250);
window.setInterval(() => void syncClock(), CLOCK_RESYNC_INTERVAL_MS);
