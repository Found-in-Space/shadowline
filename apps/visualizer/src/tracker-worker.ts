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
import { configureOperationalDeltaT202608 } from "./tracker-astronomy.js";

interface InitializeRequest {
  id: number;
  type: "initialize";
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

configureOperationalDeltaT202608();
const provider = new AstronomyEngineProvider();
const engine = new EclipseEngine(astronomyEngineCapabilities(provider));
const event = engine
  .events({
    startUtc: "2026-08-12T00:00:00Z",
    endUtc: "2026-08-13T00:00:00Z",
  })
  .find((candidate) => candidate.id === "solar-2026-08-12-total");

if (!event) {
  throw new Error("The 12 August 2026 total solar eclipse was not found.");
}

function overview(): EclipseScene {
  return engine.calculateEvent(event!, {
    centralPath: true,
    globalVisibility: true,
    timeMarkers: true,
  });
}

function localCircumstances(observer: Observer): LocalEclipse | null {
  return engine.localCircumstances(event!, observer);
}

function instantaneousShadow(atUtc: string): EclipseScene {
  return engine.calculateEvent(event!, {
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
      result = { event: event!, scene: overview() };
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
