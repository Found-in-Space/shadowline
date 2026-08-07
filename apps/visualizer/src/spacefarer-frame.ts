import type {
  CartesianVector,
  EclipseSummary,
} from "@found-in-space/shadowline";
import type { CartesianBasis } from "./celestial-frame.js";

export interface SpacefarerFrame {
  event: EclipseSummary;
  atUtc: string;
  sunEcefKm: CartesianVector;
  moonEcefKm: CartesianVector;
  direction: CartesianVector;
  ecefToEquatorialJ2000: CartesianBasis;
  sunMoonDistanceKm: number;
  moonEarthDistanceKm: number;
  axisDistanceToEarthPlaneKm: number;
  umbraRadiusAtEarthPlaneKm: number;
  penumbraRadiusAtEarthPlaneKm: number;
  centralKind: "umbra" | "antumbra" | null;
  penumbraRings: CartesianVector[][];
  centralRings: CartesianVector[][];
}
