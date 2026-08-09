import { describe, expect, it } from "vitest";
import { parseCoordinatePair } from "../apps/visualizer/src/location-input.js";

describe("manual location coordinate paste", () => {
  it("parses a Google Maps latitude and longitude pair", () => {
    expect(
      parseCoordinatePair("52.17165814560727, 4.481946799114639"),
    ).toEqual({
      latitude: 52.17165814560727,
      longitude: 4.481946799114639,
    });
  });

  it("accepts signed coordinates and surrounding whitespace", () => {
    expect(parseCoordinatePair("  -33.8688, +151.2093\n")).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
    });
  });

  it.each([
    "52.17165814560727",
    "52.17165814560727 4.481946799114639",
    "91, 4.481946799114639",
    "52.17165814560727, 181",
    "52.17165814560727, 4.481946799114639, 10",
  ])("does not treat %j as a valid coordinate pair", (value) => {
    expect(parseCoordinatePair(value)).toBeNull();
  });
});
