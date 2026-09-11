import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AU_KM, EclipseEngine, scale } from "@found-in-space/shadowline";
import {
  AstronomyEngineProvider,
  astronomyEngineCapabilities,
} from "@found-in-space/shadowline-astronomy-engine";
import {
  configureGeneralDeltaT,
  configureOperationalDeltaT202608,
  configureTrackerDeltaT,
} from "../apps/visualizer/src/tracker-astronomy.js";
import type { SpacefarerFrame } from "../apps/visualizer/src/spacefarer-frame.js";

const postMessage = vi.fn();
const addEventListener = vi.fn();
const provider = new AstronomyEngineProvider();
const engine = new EclipseEngine(astronomyEngineCapabilities(provider));

beforeAll(async () => {
  vi.stubGlobal("self", { postMessage, addEventListener });
  await import("../apps/visualizer/src/spacefarer-worker.js");
});

afterAll(() => {
  vi.unstubAllGlobals();
  configureGeneralDeltaT();
});

describe("physical shadow worker timing", () => {
  it.each([
    { year: 2026, eventId: "solar-2026-08-12-total", deltaTMode: "tracker" },
    { year: 2027, eventId: "solar-2027-08-02-total", deltaTMode: "tracker" },
    { year: 2026, eventId: "solar-2026-08-12-total", deltaTMode: "general" },
  ] as const)("matches $year $deltaTMode ephemeris at the requested UTC", ({ year, eventId, deltaTMode }) => {
    if (deltaTMode === "tracker") configureTrackerDeltaT(eventId);
    else configureGeneralDeltaT();
    const event = engine.eventsForYear(year).find((candidate) => candidate.id === eventId);
    if (!event) throw new Error(`Missing test eclipse: ${eventId}`);
    const expectedMoon = scale(
      provider.stateVector("moon", event.peakUtc, "geocentric-earth-fixed").positionAu,
      AU_KM,
    );

    // Start the worker in the opposite calibration to check that each frame
    // selects its own timing model, including the special August 2026 tracker.
    if (deltaTMode === "tracker" && year === 2026) configureGeneralDeltaT();
    else configureOperationalDeltaT202608();
    postMessage.mockClear();
    const handleMessage = addEventListener.mock.calls[0]![1];
    handleMessage({ data: { type: "frame", requestId: 1, atUtc: event.peakUtc, event, deltaTMode } });

    const response = postMessage.mock.calls[0]![0] as { type: string; frame: SpacefarerFrame };
    expect(response.type).toBe("frame");
    expect(response.frame.event.id).toBe(eventId);
    expect(response.frame.atUtc).toBe(event.peakUtc);
    expect(response.frame.centralRings.length).toBeGreaterThan(0);
    for (const axis of ["x", "y", "z"] as const) {
      expect(response.frame.moonEcefKm[axis]).toBeCloseTo(expectedMoon[axis], 7);
    }
  });
});
