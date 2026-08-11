import { describe, expect, it } from "vitest";
import type { LocalEclipse } from "@found-in-space/shadowline";
import {
  totalityAboveHorizon,
  visibleAboveHorizon,
} from "../apps/visualizer/src/local-eclipse-visibility.js";

function localEclipse(
  kind: LocalEclipse["kind"],
  altitudes: {
    partialBegin: number;
    centralBegin?: number;
    peak: number;
    centralEnd?: number;
    partialEnd: number;
  },
): LocalEclipse {
  const contact = (sunAltitudeDeg: number) => ({
    utc: "2026-08-12T18:00:00.000Z",
    sunAltitudeDeg,
    sunAzimuthDeg: 180,
  });
  return {
    kind,
    obscuration: kind === "total" ? 1 : 0.5,
    partialBegin: contact(altitudes.partialBegin),
    ...(altitudes.centralBegin === undefined
      ? {}
      : { centralBegin: contact(altitudes.centralBegin) }),
    peak: contact(altitudes.peak),
    ...(altitudes.centralEnd === undefined
      ? {}
      : { centralEnd: contact(altitudes.centralEnd) }),
    partialEnd: contact(altitudes.partialEnd),
  };
}

describe("local eclipse visibility", () => {
  it("recognizes an eclipse when any phase is above the apparent horizon", () => {
    const event = localEclipse("partial", {
      partialBegin: -5,
      peak: -1,
      partialEnd: 2,
    });
    expect(visibleAboveHorizon(event)).toBe(true);
  });

  it("requires the total phase itself to be above the horizon", () => {
    const event = localEclipse("total", {
      partialBegin: 2,
      centralBegin: -2,
      peak: -1.5,
      centralEnd: -1,
      partialEnd: 4,
    });
    expect(visibleAboveHorizon(event)).toBe(true);
    expect(totalityAboveHorizon(event)).toBe(false);
  });

  it("accepts locally visible totality and rejects annularity", () => {
    const total = localEclipse("total", {
      partialBegin: -4,
      centralBegin: -1,
      peak: 0,
      centralEnd: 1,
      partialEnd: 3,
    });
    const annular = { ...total, kind: "annular" as const };
    expect(totalityAboveHorizon(total)).toBe(true);
    expect(totalityAboveHorizon(annular)).toBe(false);
  });
});
