import { describe, expect, it } from "vitest";
import worker from "../apps/visualizer/src/sites-worker.mjs";

describe("Sites static worker routing", () => {
  it.each([
    ["/browse", "/browse/"],
    ["/deployment/prefix/browse", "/deployment/prefix/browse/"],
    ["/spacefarer", "/spacefarer/"],
    ["/tracker/202608", "/tracker/202608/"],
    ["/deployment/prefix/tracker/202608", "/deployment/prefix/tracker/202608/"],
  ])("preserves prefixes when redirecting %s", async (path, expected) => {
    const response = await worker.fetch(
      new Request(`https://example.test${path}?keep=yes`),
      { ASSETS: { fetch: (_request) => Promise.resolve(new Response("unused")) } },
    );

    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe(expected);
    expect(location.search).toBe("?keep=yes");
  });
});
