/// <reference lib="webworker" />

import { EclipseEngine } from "@found-in-space/shadowline";
import {
  AstronomyEngineProvider,
  astronomyEngineCapabilities,
} from "@found-in-space/shadowline-astronomy-engine";

interface CountdownRequest {
  atUtc: string;
  afterEventId?: string;
}

const engine = new EclipseEngine(
  astronomyEngineCapabilities(new AstronomyEngineProvider()),
);

function nextEclipse(atUtc: string, afterEventId?: string) {
  const at = new Date(atUtc);
  const atMs = at.getTime();
  if (!Number.isFinite(atMs)) throw new RangeError("Invalid countdown time.");

  const firstYear = at.getUTCFullYear();
  for (let year = firstYear; year <= firstYear + 10; year += 1) {
    for (const event of engine.eventsForYear(year)) {
      if (event.id === afterEventId) continue;

      // A global solar eclipse lasts hours, so an event whose peak was more
      // than a day ago cannot still be in progress. Skipping it avoids an
      // unnecessary contact calculation when the page opens later in the year.
      if (Date.parse(event.peakUtc) < atMs - 24 * 60 * 60 * 1_000) continue;

      const contacts = engine.calculateGlobalContacts(event);
      const first = contacts[0];
      const last = contacts.at(-1);
      if (!first || !last || Date.parse(last.utc) < atMs) continue;

      return {
        id: event.id,
        kind: event.kind,
        startUtc: first.utc,
        endUtc: last.utc,
      };
    }
  }

  throw new Error("No upcoming solar eclipse was found.");
}

self.addEventListener("message", (message: MessageEvent<CountdownRequest>) => {
  try {
    self.postMessage({
      event: nextEclipse(
        message.data.atUtc,
        message.data.afterEventId,
      ),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export {};
