#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const trackerRoot = path.join(repositoryRoot, "apps/visualizer/tracker");
const publicTrackerRoot = path.join(
  repositoryRoot,
  "apps/visualizer/public/tracker",
);
const eventsPath = path.join(trackerRoot, "events.json");
const templatePath = path.join(trackerRoot, "page.template.html");

const events = JSON.parse(await readFile(eventsPath, "utf8"));
const template = await readFile(templatePath, "utf8");

function eclipseTypeLabel(kind) {
  if (kind === "total") return "Total solar eclipse";
  if (kind === "annular") return "Annular solar eclipse";
  if (kind === "partial") return "Partial solar eclipse";
  throw new Error(`Unsupported eclipse kind: ${kind}`);
}

function assertEvent(event, seenSlugs, seenIds) {
  if (!/^\d{6}$/.test(event.slug)) {
    throw new Error(`Invalid tracker slug: ${event.slug}`);
  }
  if (!/^solar-\d{4}-\d{2}-\d{2}-(total|annular|partial|hybrid)$/.test(event.eventId)) {
    throw new Error(`Invalid eclipse event ID: ${event.eventId}`);
  }
  if (!Number.isFinite(Date.parse(event.peakUtc))) {
    throw new Error(`Invalid peak time for ${event.eventId}`);
  }
  if (seenSlugs.has(event.slug) || seenIds.has(event.eventId)) {
    throw new Error(`Duplicate tracker configuration: ${event.slug}`);
  }
  seenSlugs.add(event.slug);
  seenIds.add(event.eventId);
}

function replaceAll(source, replacements) {
  let output = source;
  for (const [name, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${name}}}`, value);
  }
  const unresolved = output.match(/{{[A-Z0-9_]+}}/g);
  if (unresolved) {
    throw new Error(`Unresolved page tokens: ${unresolved.join(", ")}`);
  }
  return output;
}

const seenSlugs = new Set();
const seenIds = new Set();
for (const event of events) {
  assertEvent(event, seenSlugs, seenIds);
  const typeLabel = eclipseTypeLabel(event.kind);
  const title = `${event.dateLabel} Eclipse Tracker — Found in Space`;
  const description = `Follow the Moon’s shadow and see what the ${event.dateLabel} eclipse will look like where you are, even with a poor connection.`;
  const imageAlt = `${event.dateLabel} ${typeLabel.toLowerCase()} track with The Robot`;
  const pageUrl = `https://foundin.space/shadowline/tracker/${event.slug}/`;
  const page = replaceAll(template, {
    DESCRIPTION: description,
    TITLE: title,
    IMAGE_ALT: imageAlt,
    PAGE_URL: pageUrl,
    IMAGE_URL: `${pageUrl}og.png`,
    ECLIPSE_TYPE_LABEL: typeLabel,
    WEEKDAY: event.weekday,
    DATE_LABEL: event.dateLabel,
    PEAK_TIME_UTC: new Date(event.peakUtc).toISOString().slice(11, 19),
    TRACKER_CONFIG_JSON: JSON.stringify(event).replaceAll("<", "\\u003c"),
  });
  const pageDirectory = path.join(trackerRoot, event.slug);
  const publicDirectory = path.join(publicTrackerRoot, event.slug);
  await Promise.all([
    mkdir(pageDirectory, { recursive: true }),
    mkdir(publicDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(pageDirectory, "index.html"), page),
    writeFile(
      path.join(publicDirectory, "manifest.webmanifest"),
      `${JSON.stringify({
        name: `Found in Space — ${event.dateLabel} Eclipse Tracker`,
        short_name: `Eclipse ${event.dateLabel.slice(-4)}`,
        description,
        id: "./",
        lang: "en",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        background_color: "#090d17",
        theme_color: "#090d17",
        icons: [
          {
            src: "../assets/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "../assets/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "../assets/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
        categories: ["education", "navigation", "utilities"],
      }, null, 2)}\n`,
    ),
  ]);
  console.log(`Generated tracker/${event.slug}/`);
}
