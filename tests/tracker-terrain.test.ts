import { describe, expect, it } from "vitest";
import {
  decodeTerrariumPixel,
  terrainTileSample,
} from "../apps/visualizer/src/tracker-terrain.js";

describe("tracker terrain elevation", () => {
  it("decodes Terrarium RGB elevation", () => {
    expect(decodeTerrariumPixel(128, 0, 0)).toBe(0);
    expect(decodeTerrariumPixel(128, 1, 128)).toBe(1.5);
    expect(decodeTerrariumPixel(127, 255, 0)).toBe(-1);
  });

  it("addresses the shared z12 Mapterhorn tile grid", () => {
    expect(terrainTileSample(0, 0)).toEqual({
      url: "https://tiles.mapterhorn.com/12/2048/2048.webp",
      pixelX: 0,
      pixelY: 0,
    });
    const iceland = terrainTileSample(65.1411, -25.3272);
    expect(iceland.url).toMatch(/^https:\/\/tiles\.mapterhorn\.com\/12\/\d+\/\d+\.webp$/);
    expect(iceland.pixelX).toBeGreaterThanOrEqual(0);
    expect(iceland.pixelX).toBeLessThan(512);
    expect(iceland.pixelY).toBeGreaterThanOrEqual(0);
    expect(iceland.pixelY).toBeLessThan(512);
  });
});
