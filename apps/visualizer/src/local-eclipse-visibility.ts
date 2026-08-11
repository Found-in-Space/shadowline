import type { EclipseContact, LocalEclipse } from "@found-in-space/shadowline";

const APPARENT_HORIZON_ALTITUDE_DEG = -0.833;

function contactAboveHorizon(contact: EclipseContact | undefined): boolean {
  return Boolean(
    contact && contact.sunAltitudeDeg > APPARENT_HORIZON_ALTITUDE_DEG,
  );
}

export function visibleAboveHorizon(event: LocalEclipse): boolean {
  return [
    event.partialBegin,
    event.centralBegin,
    event.peak,
    event.centralEnd,
    event.partialEnd,
  ].some(contactAboveHorizon);
}

export function totalityAboveHorizon(event: LocalEclipse): boolean {
  return event.kind === "total" &&
    [event.centralBegin, event.peak, event.centralEnd].some(
      contactAboveHorizon,
    );
}
