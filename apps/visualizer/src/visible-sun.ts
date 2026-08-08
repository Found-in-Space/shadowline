import * as THREE from "three";

export const VISIBLE_SUN_FAR = 1200;

const SUN_DISC_DISTANCE = 650;

function sunTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable.");
  const glow = context.createRadialGradient(128, 128, 6, 128, 128, 128);
  glow.addColorStop(0, "rgba(255,255,242,1)");
  glow.addColorStop(0.43, "rgba(255,224,138,1)");
  glow.addColorStop(0.5, "rgba(255,184,70,0.98)");
  glow.addColorStop(0.58, "rgba(255,177,62,0.24)");
  glow.addColorStop(0.77, "rgba(255,143,38,0.06)");
  glow.addColorStop(1, "rgba(255,120,24,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface VisibleSun {
  readonly object: THREE.Sprite;
  update(
    viewCamera: THREE.Camera,
    sunDirection: THREE.Vector3,
    sunAngularRadiusRad: number,
  ): void;
}

export function createVisibleSun(): VisibleSun {
  const object = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunTexture(),
      color: 0xffffff,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  object.renderOrder = -5;

  const cameraWorldPosition = new THREE.Vector3();
  return {
    object,
    update(viewCamera, sunDirection, sunAngularRadiusRad) {
      viewCamera.getWorldPosition(cameraWorldPosition);
      object.position
        .copy(cameraWorldPosition)
        .addScaledVector(sunDirection, SUN_DISC_DISTANCE);
      const planeSize =
        4 * SUN_DISC_DISTANCE * Math.tan(sunAngularRadiusRad);
      object.scale.set(planeSize, planeSize, 1);
    },
  };
}
