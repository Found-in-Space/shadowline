/// <reference lib="webworker" />

import {
  EclipseEngine,
  type EclipseScene,
  type EclipseSummary,
  type LocalEclipse,
  type Observer,
} from "@found-in-space/shadowline";
import {
  AstronomyEngineProvider,
  astronomyEngineCapabilities,
} from "@found-in-space/shadowline-astronomy-engine";
import { configureTrackerDeltaT } from "./tracker-astronomy.js";

interface InitializeRequest {
  id: number;
  type: "initialize";
  eventId: string;
}

interface LocationRequest {
  id: number;
  type: "location";
  observer: Observer;
}

interface ShadowRequest {
  id: number;
  type: "shadow";
  atUtc: string;
}

type TrackerRequest = InitializeRequest | LocationRequest | ShadowRequest;

const provider = new AstronomyEngineProvider();
const engine = new EclipseEngine(astronomyEngineCapabilities(provider));
let event: EclipseSummary | null = null;

function initializeEvent(eventId: string): EclipseSummary {
  const match = /^solar-(\d{4})-\d{2}-\d{2}-(total|annular|partial|hybrid)$/.exec(
    eventId,
  );
  if (!match) throw new Error(`Invalid eclipse event ID: ${eventId}`);
  configureTrackerDeltaT(eventId);
  const candidate = engine
    .eventsForYear(Number(match[1]))
    .find((value) => value.id === eventId);
  if (!candidate) throw new Error(`Eclipse event not found: ${eventId}`);
  event = candidate;
  return candidate;
}

function currentEvent(): EclipseSummary {
  if (!event) throw new Error("The tracker worker has not been initialized.");
  return event;
}

function overview(): EclipseScene {
  return engine.calculateEvent(currentEvent(), {
    centralPath: true,
    globalVisibility: true,
    timeMarkers: true,
  });
}

function localCircumstances(observer: Observer): LocalEclipse | null {
  return engine.localCircumstances(currentEvent(), observer);
}

function instantaneousShadow(atUtc: string): EclipseScene {
  return engine.calculateEvent(currentEvent(), {
    centralPath: false,
    globalVisibility: false,
    instantaneousAtUtc: [atUtc],
    timeMarkers: false,
  });
}

self.addEventListener("message", (message: MessageEvent<TrackerRequest>) => {
  const request = message.data;
  try {
    let result:
      | { event: EclipseSummary; scene: EclipseScene }
      | { local: LocalEclipse | null }
      | { scene: EclipseScene };
    if (request.type === "initialize") {
      const initializedEvent = initializeEvent(request.eventId);
      result = { event: initializedEvent, scene: overview() };
    } else if (request.type === "location") {
      result = { local: localCircumstances(request.observer) };
    } else {
      result = { scene: instantaneousShadow(request.atUtc) };
    }
    self.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export {};
