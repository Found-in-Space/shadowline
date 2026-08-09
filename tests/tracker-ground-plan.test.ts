import { describe, expect, it } from "vitest";
import {
  groundCameraPlan,
  groundTerrainTiles,
  signedAngularDifferenceDegrees,
} from "../apps/visualizer/src/tracker-ground-plan.js";

describe("tracker ground view planning", () => {
  it("frames a solar track that crosses north without turning it into a full-circle view", () => {
    const track = [350, 355, 0, 5, 10].map((azimuthDeg, index) => ({
      azimuthDeg,
      altitudeDeg: 4 + index * 3,
    }));
    const camera = groundCameraPlan(track, 1.2);

    expect(Math.abs(signedAngularDifferenceDegrees(camera.bearingDeg, 0)))
      .toBeLessThan(1);
    for (const position of track) {
      expect(Math.abs(signedAngularDifferenceDegrees(
        position.azimuthDeg,
        camera.bearingDeg,
      ))).toBeLessThan(camera.horizontalFovDeg / 2);
      expect(position.altitudeDeg).toBeGreaterThan(
        camera.pitchDeg - camera.verticalFovDeg / 2,
      );
      expect(position.altitudeDeg).toBeLessThan(
        camera.pitchDeg + camera.verticalFovDeg / 2,
      );
    }
    expect(0).toBeGreaterThan(camera.pitchDeg - camera.verticalFovDeg / 2);
    expect(0).toBeLessThan(camera.pitchDeg + camera.verticalFovDeg / 2);
  });

  it("keeps full elevation detail at the observer while coarsening the distant frustum", () => {
    const observer = {
      latitudeDeg: 65.1411,
      longitudeDeg: -25.3272,
      elevationMeters: 0,
    };
    const camera = groundCameraPlan([
      { altitudeDeg: 12, azimuthDeg: 245 },
      { altitudeDeg: 18, azimuthDeg: 265 },
    ], 1);
    const tiles = groundTerrainTiles(observer, camera);
    const observerTile = tiles.find((tile) =>
      observer.longitudeDeg >= tile.westDeg &&
      observer.longitudeDeg <= tile.eastDeg &&
      observer.latitudeDeg <= tile.northDeg &&
      observer.latitudeDeg >= tile.southDeg
    );

    expect(observerTile?.z).toBe(12);
    expect(tiles.some((tile) => tile.z < 12)).toBe(true);
    expect(tiles.every((tile) => tile.z >= 9 && tile.z <= 12)).toBe(true);
  });

  it("selects photographic zoom from projected screen detail independently of terrain zoom", () => {
    const observer = {
      latitudeDeg: 43.107639,
      longitudeDeg: -4.876658,
      elevationMeters: 1_562,
    };
    const camera = groundCameraPlan([
      { altitudeDeg: 4, azimuthDeg: 275 },
      { altitudeDeg: 18, azimuthDeg: 288 },
    ], 1);
    const tiles = groundTerrainTiles(observer, camera, {
      maxZoom: 18,
      focalLengthPixels: 800,
      sourceTilePixels: 512,
    });
    const observerTile = tiles.find((tile) =>
      observer.longitudeDeg >= tile.westDeg &&
      observer.longitudeDeg <= tile.eastDeg &&
      observer.latitudeDeg <= tile.northDeg &&
      observer.latitudeDeg >= tile.southDeg
    );

    expect(observerTile?.z).toBe(18);
    expect(tiles.some((tile) => tile.z <= 12)).toBe(true);
  });
});
