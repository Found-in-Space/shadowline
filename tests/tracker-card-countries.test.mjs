import { describe, expect, it } from "vitest";
import { countryNamesForTrack } from "../scripts/tracker-card-countries.mjs";

function boundary(coordinates) {
  return coordinates.map(([longitudeDeg, latitudeDeg]) => ({
    geographic: { longitudeDeg, latitudeDeg },
  }));
}

function country(name, coordinates) {
  return {
    type: "Feature",
    properties: { name },
    geometry: { type: "Polygon", coordinates: [coordinates] },
  };
}

describe("tracker card country intersections", () => {
  it("finds countries crossed by the path and sorts their names", () => {
    const path = boundary([
      [0, 0], [10, 0], [10, 2], [0, 2], [0, 0],
    ]);
    const countries = [
      country("Westland", [[1, -1], [3, -1], [3, 3], [1, 3], [1, -1]]),
      country("Eastland", [[7, -1], [9, -1], [9, 3], [7, 3], [7, -1]]),
      country("Elsewhere", [[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]),
    ];
    expect(countryNamesForTrack(path, countries)).toEqual([
      "Eastland",
      "Westland",
    ]);
  });

  it("detects a crossing when neither polygon contains the other's vertices", () => {
    const path = boundary([
      [0, 4], [10, 4], [10, 6], [0, 6], [0, 4],
    ]);
    const crossingCountry = country("Crossing", [
      [4, 0], [6, 0], [6, 10], [4, 10], [4, 0],
    ]);
    expect(countryNamesForTrack(path, [crossingCountry])).toEqual([
      "Crossing",
    ]);
  });
});
