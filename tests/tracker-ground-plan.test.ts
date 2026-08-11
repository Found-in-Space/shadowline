import { describe, expect, it } from "vitest";
import {
  groundCameraPlan,
  groundTerrainTiles,
  signedAngularDifferenceDegrees,
  visibleGroundTerrainTiles,
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

  it("caps photographic refinement and orders retained tiles outwards", () => {
    const observer = {
      latitudeDeg: 43.107639,
      longitudeDeg: -4.876658,
      elevationMeters: 1_562,
    };
    const camera = groundCameraPlan([
      { altitudeDeg: 1, azimuthDeg: 272 },
      { altitudeDeg: 20, azimuthDeg: 290 },
    ], 1.35);
    const candidates = groundTerrainTiles(observer, camera, {
      maxZoom: 20,
      focalLengthPixels: 1_100,
      sourceTilePixels: 256,
    });
    const plan = visibleGroundTerrainTiles(
      candidates,
      observer,
      camera,
      {
        groundElevationMetres: 1_562,
        elevationAt: () => 1_562,
        maxTiles: 12,
      },
    );
    const minimumDistance = (tile: (typeof candidates)[number]): number => {
      const longitudeScale = 6_371_008.8 * Math.cos(
        observer.latitudeDeg * Math.PI / 180,
      );
      const minimumEast = (tile.westDeg - observer.longitudeDeg) *
        Math.PI / 180 * longitudeScale;
      const maximumEast = (tile.eastDeg - observer.longitudeDeg) *
        Math.PI / 180 * longitudeScale;
      const minimumNorth = (tile.southDeg - observer.latitudeDeg) *
        Math.PI / 180 * 6_371_008.8;
      const maximumNorth = (tile.northDeg - observer.latitudeDeg) *
        Math.PI / 180 * 6_371_008.8;
      const intervalDistance = (
        minimum: number,
        maximum: number,
      ): number => 0 < minimum ? minimum : 0 > maximum ? -maximum : 0;
      return Math.hypot(
        intervalDistance(minimumEast, maximumEast),
        intervalDistance(minimumNorth, maximumNorth),
      );
    };

    expect(plan.tiles.length).toBeLessThanOrEqual(12);
    expect(
      plan.tiles.length + plan.frustumCulled + plan.occlusionCulled +
        plan.budgetCulled,
    ).toBe(candidates.length);
    for (let index = 1; index < plan.tiles.length; index += 1) {
      expect(minimumDistance(plan.tiles[index]!)).toBeGreaterThanOrEqual(
        minimumDistance(plan.tiles[index - 1]!) - 0.1,
      );
    }
  });

  it("rejects terrain below the vertical camera frustum", () => {
    const observer = {
      latitudeDeg: 0,
      longitudeDeg: 0,
      elevationMeters: 0,
    };
    const camera = {
      bearingDeg: 0,
      pitchDeg: 38,
      verticalFovDeg: 20,
      horizontalFovDeg: 52,
      farMetres: 120_000,
    };
    const candidates = groundTerrainTiles(observer, camera, {
      maxZoom: 16,
      focalLengthPixels: 800,
      sourceTilePixels: 256,
    });
    const plan = visibleGroundTerrainTiles(
      candidates,
      observer,
      camera,
      {
        groundElevationMetres: 0,
        elevationAt: () => 0,
        maxTiles: 1_000,
      },
    );

    expect(plan.tiles).toHaveLength(0);
    expect(plan.frustumCulled).toBe(candidates.length);
  });

  it("uses a nearer elevation ridge to cull hidden outward refinements", () => {
    const observer = {
      latitudeDeg: 0,
      longitudeDeg: 0,
      elevationMeters: 0,
    };
    const camera = {
      bearingDeg: 0,
      pitchDeg: 0,
      verticalFovDeg: 24,
      horizontalFovDeg: 32,
      farMetres: 50_000,
    };
    const candidates = groundTerrainTiles(observer, camera, {
      maxZoom: 18,
      focalLengthPixels: 900,
      sourceTilePixels: 256,
    });
    const flat = visibleGroundTerrainTiles(
      candidates,
      observer,
      camera,
      {
        groundElevationMetres: 0,
        elevationAt: () => 0,
        maxTiles: 1_000,
      },
    );
    const ridge = visibleGroundTerrainTiles(
      candidates,
      observer,
      camera,
      {
        groundElevationMetres: 0,
        elevationAt: (latitudeDeg) => {
          const northMetres = latitudeDeg * Math.PI / 180 * 6_371_008.8;
          return northMetres >= 700 && northMetres <= 1_500 ? 220 : 0;
        },
        maxTiles: 1_000,
      },
    );

    expect(ridge.occlusionCulled).toBeGreaterThan(flat.occlusionCulled);
    expect(ridge.tiles.length).toBeLessThan(flat.tiles.length);
  });
});
