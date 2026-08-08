import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createEarthClippedShadowCones,
  perpendicularBasis,
} from "../apps/visualizer/src/shadow-cone.js";

describe("shared eclipse shadow cones", () => {
  it("builds both standard-quality cone surfaces", () => {
    const cones = createEarthClippedShadowCones({
      moonPosition: new THREE.Vector3(-60, 0, 0),
      shadowAxis: new THREE.Vector3(1, 0, 0),
      displayLength: 64,
      sunMoonDistanceKm: 149_000_000,
    });

    expect(cones).toHaveLength(2);
    for (const cone of cones) {
      expect(cone.geometry.getAttribute("position").count).toBe(49 * 97);
      expect(cone.geometry.getAttribute("coneRayOrigin").count).toBe(49 * 97);
      expect(cone.geometry.getIndex()?.count).toBe(48 * 96 * 6);
      expect(cone.renderOrder).toBe(3);
    }
  });

  it("clips fragments when Earth intersects the Moon-to-fragment segment", () => {
    const transform = new THREE.Matrix4().makeRotationY(0.2);
    const [cone] = createEarthClippedShadowCones({
      moonPosition: new THREE.Vector3(-60, 0, 0),
      shadowAxis: new THREE.Vector3(1, 0, 0),
      displayLength: 64,
      sunMoonDistanceKm: 149_000_000,
      coneToEarthFixed: transform,
    });
    const material = cone.material as THREE.MeshBasicMaterial;
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader:
        "#include <common>\n#include <clipping_planes_fragment>",
    };

    material.onBeforeCompile(
      shader as Parameters<typeof material.onBeforeCompile>[0],
      {} as THREE.WebGLRenderer,
    );

    expect(shader.uniforms).toMatchObject({
      coneToEarthFixed: { value: transform },
    });
    expect(shader.vertexShader).toContain("vConeRayOrigin = coneRayOrigin");
    expect(shader.fragmentShader).toContain("earthFixedStart");
    expect(shader.fragmentShader).toContain("earthFixedEnd");
    expect(shader.fragmentShader).toContain("entry > 0.00001");
    expect(shader.fragmentShader).toContain("exit > 0.00001");
    expect(shader.fragmentShader).toContain("entry < 0.9995");
  });

  it("provides a stable orthogonal camera basis around the shadow axis", () => {
    const axis = new THREE.Vector3(0.2, 0.9, -0.3).normalize();
    const [first, second] = perpendicularBasis(axis);

    expect(first.length()).toBeCloseTo(1);
    expect(second.length()).toBeCloseTo(1);
    expect(first.dot(axis)).toBeCloseTo(0);
    expect(second.dot(axis)).toBeCloseTo(0);
    expect(first.dot(second)).toBeCloseTo(0);
  });
});
