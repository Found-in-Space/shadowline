/// <reference types="vite/client" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadElevation } from "../apps/visualizer/src/tracker-ground-terrain.js";

describe("tracker ground terrain", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a missing Mapterhorn tile as flat sea level", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(null, { status: 404 }),
    ));

    const elevation = await loadElevation(
      { z: 9, x: 259, y: 168 },
      new AbortController().signal,
    );

    expect(elevation.width).toBe(1);
    expect(elevation.height).toBe(1);
    expect(Array.from(elevation.pixels)).toEqual([128, 0, 0, 255]);
  });

  it("does not hide provider failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(null, { status: 503 }),
    ));

    await expect(loadElevation(
      { z: 9, x: 259, y: 168 },
      new AbortController().signal,
    )).rejects.toThrow("Tile provider returned 503.");
  });
});
