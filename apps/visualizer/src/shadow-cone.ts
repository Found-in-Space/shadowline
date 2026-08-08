import * as THREE from "three";
import {
  EARTH_MEAN_RADIUS_KM,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
} from "@found-in-space/shadowline";
import { WGS84_DISPLAY_AXES } from "./earth-ellipsoid.js";

const IDENTITY_MATRIX = new THREE.Matrix4();

export type ShadowConeQuality = "standard" | "high";

export interface EarthClippedShadowConesOptions {
  moonPosition: THREE.Vector3;
  shadowAxis: THREE.Vector3;
  displayLength: number;
  sunMoonDistanceKm: number;
  coneToEarthFixed?: THREE.Matrix4;
  quality?: ShadowConeQuality;
  penumbraOpacity?: number;
  centralOpacity?: number;
}

export function perpendicularBasis(
  axis: THREE.Vector3,
): [THREE.Vector3, THREE.Vector3] {
  const reference =
    Math.abs(axis.y) < 0.82
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  const first = new THREE.Vector3().crossVectors(axis, reference).normalize();
  const second = new THREE.Vector3().crossVectors(axis, first).normalize();
  return [first, second];
}

interface ConeSurfaceOptions {
  moonPosition: THREE.Vector3;
  shadowAxis: THREE.Vector3;
  displayLength: number;
  slope: number;
  color: number;
  opacity: number;
  coneToEarthFixed: THREE.Matrix4;
  quality: ShadowConeQuality;
}

function coneSurface(options: ConeSurfaceOptions): THREE.Mesh {
  const {
    moonPosition,
    shadowAxis,
    displayLength,
    slope,
    color,
    opacity,
    coneToEarthFixed,
    quality,
  } = options;
  const radialSegments = quality === "high" ? 180 : 96;
  const lengthSegments = quality === "high" ? 96 : 48;
  const [first, second] = perpendicularBasis(shadowAxis);
  const positions: number[] = [];
  const rayOrigins: number[] = [];
  const indices: number[] = [];
  for (let alongIndex = 0; alongIndex <= lengthSegments; alongIndex += 1) {
    const along = (displayLength * alongIndex) / lengthSegments;
    const signedPhysicalRadiusKm =
      MOON_RADIUS_KM + slope * along * EARTH_MEAN_RADIUS_KM;
    const displayRadius =
      Math.abs(signedPhysicalRadiusKm) / EARTH_MEAN_RADIUS_KM;
    const moonRadiusDirection = Math.sign(signedPhysicalRadiusKm) || 1;
    const centre = moonPosition.clone().addScaledVector(shadowAxis, along);
    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
      const angle = (radialIndex / radialSegments) * Math.PI * 2;
      const radialDirection = first
        .clone()
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(second, Math.sin(angle));
      const point = centre.clone().addScaledVector(
        radialDirection,
        displayRadius,
      );
      const rayOrigin = moonPosition.clone().addScaledVector(
        radialDirection,
        moonRadiusDirection * MOON_RADIUS_KM / EARTH_MEAN_RADIUS_KM,
      );
      positions.push(point.x, point.y, point.z);
      rayOrigins.push(rayOrigin.x, rayOrigin.y, rayOrigin.z);
    }
  }
  const row = radialSegments + 1;
  for (let alongIndex = 0; alongIndex < lengthSegments; alongIndex += 1) {
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
      const index = alongIndex * row + radialIndex;
      const next = index + row;
      indices.push(index, next, index + 1, next, next + 1, index + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "coneRayOrigin",
    new THREE.Float32BufferAttribute(rayOrigins, 3),
  );
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms["coneToEarthFixed"] = { value: coneToEarthFixed };
    shader.uniforms["wgs84DisplayAxes"] = { value: WGS84_DISPLAY_AXES };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 coneRayOrigin;
varying vec3 vConeRayOrigin;
varying vec3 vConePosition;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vConeRayOrigin = coneRayOrigin;
vConePosition = transformed;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform mat4 coneToEarthFixed;
uniform vec3 wgs84DisplayAxes;
varying vec3 vConeRayOrigin;
varying vec3 vConePosition;`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
vec3 earthFixedStart =
  ( coneToEarthFixed * vec4( vConeRayOrigin, 1.0 ) ).xyz;
vec3 earthFixedEnd =
  ( coneToEarthFixed * vec4( vConePosition, 1.0 ) ).xyz;
vec3 ellipsoidStart = earthFixedStart / wgs84DisplayAxes;
vec3 ellipsoidDelta = ( earthFixedEnd - earthFixedStart ) / wgs84DisplayAxes;
float segmentA = dot( ellipsoidDelta, ellipsoidDelta );
float segmentB = 2.0 * dot( ellipsoidStart, ellipsoidDelta );
float segmentC = dot( ellipsoidStart, ellipsoidStart ) - 1.0;
float discriminant = segmentB * segmentB - 4.0 * segmentA * segmentC;
if ( segmentA > 0.0 && discriminant >= 0.0 ) {
  float root = sqrt( discriminant );
  float entry = ( -segmentB - root ) / ( 2.0 * segmentA );
  float exit = ( -segmentB + root ) / ( 2.0 * segmentA );
  if (
    ( entry > 0.00001 && entry < 0.9995 ) ||
    ( exit > 0.00001 && exit < 0.9995 )
  ) discard;
}`,
      );
  };
  material.customProgramCacheKey = () => "earth-clipped-shadow-cone-v2";
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3;
  return mesh;
}

/**
 * Builds the penumbral and central eclipse cones at the shared Earth scale.
 * Cone fragments are discarded after their ray first intersects WGS 84 Earth.
 */
export function createEarthClippedShadowCones(
  options: EarthClippedShadowConesOptions,
): [THREE.Mesh, THREE.Mesh] {
  const {
    moonPosition,
    shadowAxis,
    displayLength,
    sunMoonDistanceKm,
    coneToEarthFixed = IDENTITY_MATRIX,
    quality = "standard",
    penumbraOpacity = 0.13,
    centralOpacity = 0.26,
  } = options;
  const common = {
    moonPosition,
    shadowAxis,
    displayLength,
    coneToEarthFixed,
    quality,
  };
  return [
    coneSurface({
      ...common,
      slope: (SUN_RADIUS_KM + MOON_RADIUS_KM) / sunMoonDistanceKm,
      color: 0xf2b94d,
      opacity: penumbraOpacity,
    }),
    coneSurface({
      ...common,
      slope: -(SUN_RADIUS_KM - MOON_RADIUS_KM) / sunMoonDistanceKm,
      color: 0x9d7cff,
      opacity: centralOpacity,
    }),
  ];
}
