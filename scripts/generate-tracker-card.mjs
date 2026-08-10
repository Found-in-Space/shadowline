#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { EclipseEngine } from "@found-in-space/shadowline";
import {
  AstronomyEngineProvider,
  astronomyEngineCapabilities,
} from "@found-in-space/shadowline-astronomy-engine";
import {
  calculateTrackViewport,
  projectGeographicPoint,
} from "./tracker-card-geometry.mjs";
import {
  countryDataset,
  countryNamesForShadow,
  loadCountryFeatures,
} from "./tracker-card-countries.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_BLUE_MARBLE = path.join(
  REPOSITORY_ROOT,
  "apps/visualizer/public/bluemarble-2048.png",
);
const DEFAULT_ROBOT = path.join(
  REPOSITORY_ROOT,
  "apps/visualizer/public/tracker/assets/icon-512.png",
);
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 630;

function usage() {
  return `Generate a deterministic eclipse-track PNG and, optionally, a creative card.

Usage:
  npm run generate:tracker-card -- --event solar-2026-08-12-total [options]

Required:
  --event <event-id>           Shadowline eclipse event ID

Options:
  --output-dir <path>          Defaults to dist/tracker-cards/<event-id>
  --bluemarble <path>          Override the bundled Blue Marble PNG
  --robot <path>               Override the single bundled Robot PNG
  --sample-interval <seconds>  Central-path sampling interval (default: 60)
  --model <model>              Image model (default: gpt-image-2)
  --size <width>x<height>      API working size (default: 1920x1008)
  --quality <quality>          API quality (default: high)
  --base-only                  Stop after deterministic inputs are written
  --help                       Show this help

The OpenAI step reads OPENAI_API_KEY from the environment. It never runs in a
browser. shadow-base.png is always generated before any API request.`;
}

function parseArguments(argv) {
  const options = {
    blueMarble: DEFAULT_BLUE_MARBLE,
    robot: DEFAULT_ROBOT,
    sampleIntervalSeconds: 60,
    model: "gpt-image-2",
    size: "1920x1008",
    quality: "high",
    baseOnly: false,
  };

  const valueOptions = new Map([
    ["--event", "eventId"],
    ["--output-dir", "outputDirectory"],
    ["--bluemarble", "blueMarble"],
    ["--robot", "robot"],
    ["--sample-interval", "sampleIntervalSeconds"],
    ["--model", "model"],
    ["--size", "size"],
    ["--quality", "quality"],
  ]);
  const seenValueOptions = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") options.help = true;
    else if (argument === "--base-only") options.baseOnly = true;
    else if (valueOptions.has(argument)) {
      if (seenValueOptions.has(argument)) {
        throw new Error(`${argument} may only be supplied once.`);
      }
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      options[valueOptions.get(argument)] = value;
      seenValueOptions.add(argument);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  options.sampleIntervalSeconds = Number(options.sampleIntervalSeconds);
  if (!Number.isFinite(options.sampleIntervalSeconds) ||
      options.sampleIntervalSeconds <= 0) {
    throw new Error("--sample-interval must be a positive number.");
  }
  if (!options.eventId && !options.help) {
    throw new Error("--event is required.");
  }
  options.outputDirectory = path.resolve(
    options.outputDirectory ??
      path.join(REPOSITORY_ROOT, "dist/tracker-cards", options.eventId ?? "help"),
  );
  options.blueMarble = path.resolve(options.blueMarble);
  options.robot = path.resolve(options.robot);
  return options;
}

function eventYear(eventId) {
  const match = /^solar-(\d{4})-\d{2}-\d{2}-(partial|annular|total|hybrid)$/.exec(
    eventId,
  );
  if (!match) {
    throw new Error(`Invalid Shadowline event ID: ${eventId}`);
  }
  return Number(match[1]);
}

function svgPath(points, viewport, width, height, close = false) {
  const commands = points.map((point, index) => {
    const projected = projectGeographicPoint(
      point.geographic,
      viewport,
      width,
      height,
    );
    return `${index === 0 ? "M" : "L"}${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`;
  });
  return `${commands.join(" ")}${close ? " Z" : ""}`;
}

function centralPathOverlaySvg(pathSurface, viewport, width, height) {
  const boundary = svgPath(
    pathSurface.boundary.points,
    viewport,
    width,
    height,
    true,
  );
  const centreline = svgPath(
    pathSurface.centerline.points,
    viewport,
    width,
    height,
  );
  const start = projectGeographicPoint(
    pathSurface.centerline.points[0].geographic,
    viewport,
    width,
    height,
  );
  const end = projectGeographicPoint(
    pathSurface.centerline.points.at(-1).geographic,
    viewport,
    width,
    height,
  );
  const scale = width / DEFAULT_WIDTH;

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="${(5 * scale).toFixed(2)}" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#061125" stop-opacity="0.16"/>
          <stop offset="1" stop-color="#020713" stop-opacity="0.36"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <path d="${boundary}" fill="#b875d1" fill-opacity="0.48" stroke="#f0adff" stroke-width="${(3 * scale).toFixed(2)}" stroke-linejoin="round"/>
      <path d="${centreline}" fill="none" stroke="#43185c" stroke-opacity="0.9" stroke-width="${(10 * scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
      <path d="${centreline}" fill="none" stroke="#ffffff" stroke-width="${(3 * scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>
      <g fill="#ffffff" stroke="#43185c" stroke-width="${(3 * scale).toFixed(2)}">
        <circle cx="${start.x.toFixed(2)}" cy="${start.y.toFixed(2)}" r="${(8 * scale).toFixed(2)}"/>
        <circle cx="${end.x.toFixed(2)}" cy="${end.y.toFixed(2)}" r="${(8 * scale).toFixed(2)}"/>
      </g>
    </svg>
  `);
}

function partialShadowOverlaySvg(shadow, viewport, width, height) {
  const scale = width / DEFAULT_WIDTH;
  const paths = shadow.penumbra.rings.map((ring) =>
    svgPath(ring.points, viewport, width, height, true),
  );
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="${(5 * scale).toFixed(2)}" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#061125" stop-opacity="0.16"/>
          <stop offset="1" stop-color="#020713" stop-opacity="0.36"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <g fill="#8f56aa" fill-opacity="0.46" stroke="#f0adff" stroke-width="${(3 * scale).toFixed(2)}" stroke-linejoin="round" filter="url(#glow)" fill-rule="evenodd">
        ${paths.map((pathData) => `<path d="${pathData}"/>`).join("\n")}
      </g>
    </svg>
  `);
}

async function renderShadowBase({
  blueMarble,
  outputPath,
  centralPath,
  partialShadow,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}) {
  const metadata = await sharp(blueMarble).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read Blue Marble dimensions from ${blueMarble}`);
  }

  const geographicPoints = centralPath
    ? [
        ...centralPath.boundary.points.map((point) => point.geographic),
        ...centralPath.centerline.points.map((point) => point.geographic),
      ]
    : partialShadow.penumbra.rings.flatMap((ring) =>
        ring.points.map((point) => point.geographic),
      );
  if (geographicPoints.length === 0) {
    throw new Error("The eclipse produced no surface shadow geometry.");
  }
  const viewport = calculateTrackViewport(geographicPoints);

  // Three copies make antimeridian-spanning crops deterministic without a
  // browser map renderer. The tiled image covers longitudes -540...+540.
  const blueMarbleBuffer = await readFile(blueMarble);
  const tiled = await sharp({
    create: {
      width: metadata.width * 3,
      height: metadata.height,
      channels: 3,
      background: "#000000",
    },
  })
    .composite([
      { input: blueMarbleBuffer, left: 0, top: 0 },
      { input: blueMarbleBuffer, left: metadata.width, top: 0 },
      { input: blueMarbleBuffer, left: metadata.width * 2, top: 0 },
    ])
    .png()
    .toBuffer();

  const west = viewport.west;
  const east = viewport.east;
  const left = Math.max(
    0,
    Math.floor(((west + 540) / 360) * metadata.width),
  );
  const right = Math.min(
    metadata.width * 3,
    Math.ceil(((east + 540) / 360) * metadata.width),
  );
  const top = Math.max(
    0,
    Math.floor(((90 - viewport.north) / 180) * metadata.height),
  );
  const bottom = Math.min(
    metadata.height,
    Math.ceil(((90 - viewport.south) / 180) * metadata.height),
  );

  const actualViewport = {
    west: (left / metadata.width) * 360 - 540,
    east: (right / metadata.width) * 360 - 540,
    north: 90 - (top / metadata.height) * 180,
    south: 90 - (bottom / metadata.height) * 180,
    centreLongitudeDeg: viewport.centreLongitudeDeg,
    centreLatitudeDeg: viewport.centreLatitudeDeg,
  };
  const overlay = centralPath
    ? centralPathOverlaySvg(centralPath, actualViewport, width, height)
    : partialShadowOverlaySvg(partialShadow, actualViewport, width, height);

  await sharp(tiled)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize(width, height, { fit: "fill" })
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  return {
    viewport: actualViewport,
    kind: centralPath ? "central-track" : "peak-partial-shadow",
  };
}

function eventDate(event) {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(event.peakUtc));
  return date;
}

function buildPrompt({ event, countries }) {
  const countryList = countries.length > 0
    ? countries.join(", ")
    : "No sovereign land or named territory in the pinned boundary dataset";
  const shadowDescription = event.kind === "partial"
    ? "the complete rendered partial-eclipse shadow area"
    : "the complete violet eclipse boundary, white centreline, both endpoints, curvature, and every land/ocean crossing";
  return `Create a restrained, funny editorial illustration about this solar eclipse by EDITING the supplied images.

NON-NEGOTIABLE CARTOGRAPHIC ACCURACY
The FIRST supplied PNG is the locked geographic base plate and the authority for all geography. Preserve its map projection, crop, orientation, coastlines, land shapes, islands, oceans, country positions, scale, and spatial relationships. Do not redraw, reinterpret, replace, rotate, mirror, warp, bend, or convert the map into a globe or perspective view.

Preserve ${shadowDescription} in exactly the same geographic position and with the same shape, width, curvature, endpoints, and crossings shown in the FIRST image. Keep the entire shadow and track visible with their existing breathing room. Do not invent, move, shorten, straighten, widen, narrow, decorate, duplicate, or reroute the eclipse geometry.

Treat the FIRST image as a fixed scientific map with decorative additions layered onto it. It is acceptable to harmonise colour, lighting, and texture, but not to alter geographic or eclipse geometry. If a creative idea conflicts with the map, discard the creative idea and keep the map accurate.

THE THREE CREATIVE ELEMENTS
1. SHADOW IMAGE: The locked scientific base plate for ${event.id}, governed by the accuracy rules above.
2. A MASCOT: The SECOND supplied PNG is the project mascot character reference. Keep it recognisable. You are free to show one or several instances of it if that makes the scene funnier.
3. COUNTRIES: ${countryList}.

EVENT FACTS
Date: ${eventDate(event)}. Eclipse type: ${event.kind} solar eclipse.

CREATIVE DIRECTION
Use the elements to create a friendly, possibly funny, but geographically accurate splash image to be used as a social media preview.

Do not add invented scientific facts, durations, times, routes, borders, place names, or extra eclipse paths. Any displayed factual text is limited to the supplied date, eclipse type, event ID, and country list. Do not introduce another event, location, mascot, or brand.

FINAL ACCURACY CHECK
Before completing the image, compare it with the FIRST supplied PNG. The map and eclipse geometry must still align with that reference. Geographic fidelity is the highest-priority acceptance criterion; humour and visual style are secondary.`;
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function writeManifest(manifestPath, manifest) {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function runImageEdit({
  model,
  size,
  quality,
  prompt,
  shadowBasePath,
  robotPath,
  sourceOutputPath,
  finalOutputPath,
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. The deterministic inputs are ready; set the variable and rerun without --base-only.",
    );
  }

  const client = new OpenAI();
  const images = await Promise.all([
    toFile(createReadStream(shadowBasePath), "shadow-base.png", {
      type: "image/png",
    }),
    toFile(createReadStream(robotPath), "robot-reference.png", {
      type: "image/png",
    }),
  ]);
  const response = await client.images.edit({
    model,
    image: images,
    prompt,
    size,
    quality,
    output_format: "png",
  });
  const result = response.data?.[0];
  let generated;
  if (result?.b64_json) {
    generated = Buffer.from(result.b64_json, "base64");
  } else if (result?.url) {
    const download = await fetch(result.url);
    if (!download.ok) {
      throw new Error(`Could not download generated image: ${download.status}`);
    }
    generated = Buffer.from(await download.arrayBuffer());
  } else {
    throw new Error("The image API returned no image data.");
  }

  await writeFile(sourceOutputPath, generated);
  await sharp(generated)
    .resize(DEFAULT_WIDTH, DEFAULT_HEIGHT, {
      fit: "contain",
      background: "#020713",
    })
    .png({
      compressionLevel: 9,
      palette: true,
      quality: 90,
      effort: 10,
      dither: 1,
    })
    .toFile(finalOutputPath);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const engine = new EclipseEngine(
    astronomyEngineCapabilities(new AstronomyEngineProvider()),
  );
  const event = engine
    .eventsForYear(eventYear(options.eventId))
    .find((candidate) => candidate.id === options.eventId);
  if (!event) {
    throw new Error(`Eclipse event not found: ${options.eventId}`);
  }
  const centralPath = event.kind === "partial"
    ? null
    : engine.calculateCentralPath(event, {
        sampleIntervalSeconds: options.sampleIntervalSeconds,
      });
  const partialShadow = event.kind === "partial"
    ? engine.calculateInstantaneousShadow(event, event.peakUtc)
    : null;
  const shadowBoundaries = centralPath
    ? [centralPath.boundary.points]
    : partialShadow.penumbra.rings.map((ring) => ring.points);
  const countries = countryNamesForShadow(
    shadowBoundaries,
    await loadCountryFeatures(),
  );
  await mkdir(options.outputDirectory, { recursive: true });

  const shadowBasePath = path.join(options.outputDirectory, "shadow-base.png");
  const robotReferencePath = path.join(
    options.outputDirectory,
    "robot-reference.png",
  );
  const promptPath = path.join(options.outputDirectory, "prompt.txt");
  const sourceOutputPath = path.join(
    options.outputDirectory,
    "card-generated-source.png",
  );
  const finalOutputPath = path.join(options.outputDirectory, "card.png");
  const manifestPath = path.join(options.outputDirectory, "manifest.json");

  const renderedShadow = await renderShadowBase({
    blueMarble: options.blueMarble,
    outputPath: shadowBasePath,
    centralPath,
    partialShadow,
  });
  await sharp(options.robot)
    .png({ compressionLevel: 9 })
    .toFile(robotReferencePath);

  const prompt = buildPrompt({
    event,
    countries,
  });
  await writeFile(promptPath, `${prompt}\n`);

  const manifest = {
    schemaVersion: 1,
    event: {
      id: event.id,
      kind: event.kind,
      peakUtc: event.peakUtc,
      ...(centralPath
        ? {
            centralBeginUtc: centralPath.centralBeginUtc,
            centralEndUtc: centralPath.centralEndUtc,
          }
        : { shadowAtUtc: event.peakUtc }),
      countries,
      countryDataset,
    },
    renderer: {
      kind: `headless-equirectangular-${renderedShadow.kind}-png`,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      sampleIntervalSeconds: options.sampleIntervalSeconds,
      viewport: renderedShadow.viewport,
    },
    inputs: {
      blueMarble: path.relative(REPOSITORY_ROOT, options.blueMarble),
      shadowBase: path.basename(shadowBasePath),
      shadowBaseSha256: await sha256(shadowBasePath),
      robotReference: path.basename(robotReferencePath),
      robotReferenceSha256: await sha256(robotReferencePath),
      prompt: path.basename(promptPath),
    },
    generation: {
      status: options.baseOnly ? "skipped" : "pending",
      model: options.model,
      size: options.size,
      quality: options.quality,
    },
  };
  await writeManifest(manifestPath, manifest);

  console.log(`Shadow base: ${shadowBasePath}`);
  console.log(`Countries/territories: ${countries.join(", ") || "none"}`);
  console.log(`Robot reference: ${robotReferencePath}`);
  console.log(`Prompt: ${promptPath}`);

  if (options.baseOnly) {
    console.log("OpenAI edit skipped (--base-only).");
    return;
  }

  await runImageEdit({
    model: options.model,
    size: options.size,
    quality: options.quality,
    prompt,
    shadowBasePath,
    robotPath: robotReferencePath,
    sourceOutputPath,
    finalOutputPath,
  });
  manifest.generation.status = "complete";
  manifest.generation.sourceOutput = path.basename(sourceOutputPath);
  manifest.generation.output = path.basename(finalOutputPath);
  manifest.generation.outputSha256 = await sha256(finalOutputPath);
  await writeManifest(manifestPath, manifest);
  console.log(`Generated card: ${finalOutputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
