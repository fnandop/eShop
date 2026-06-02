#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import GIFEncoder from "gif-encoder-2";
import { PNG } from "pngjs";
import sharp from "sharp";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = resolve(repoRoot, ".codex-tmp", "mermaid-animation");

const palette = [
  { lane: "#e0f2fe", actor: "#bae6fd", stroke: "#0284c7" },
  { lane: "#dcfce7", actor: "#bbf7d0", stroke: "#16a34a" },
  { lane: "#fef3c7", actor: "#fde68a", stroke: "#d97706" },
  { lane: "#ede9fe", actor: "#ddd6fe", stroke: "#7c3aed" },
  { lane: "#fee2e2", actor: "#fecaca", stroke: "#dc2626" },
  { lane: "#ccfbf1", actor: "#99f6e4", stroke: "#0f766e" },
];

function printHelp() {
  console.log(`Usage: mermaid-animate [options] <diagram.mmd> [...]

Render animated GIFs from Mermaid sequence diagrams with %% frame markers.

Options:
  -o, --output <file>   Output file. Only valid with one input file.
      --out-dir <dir>   Directory for generated files. Overrides each %% output path.
      --png             Also write individual PNG frames beside the GIF.
  -h, --help            Show this help.

The renderer supports the sequenceDiagram subset used by diagrams/saga/*.mmd:
participants, messages, self messages, notes, and %% frame animation markers.`);
}

function parseArgs(argv) {
  const options = { inputs: [], output: null, outDir: null, png: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "-o" || arg === "--output") {
      options.output = argv[++i];
    } else if (arg === "--out-dir") {
      options.outDir = argv[++i];
    } else if (arg === "--png") {
      options.png = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.inputs.push(arg);
    }
  }

  if (options.inputs.length === 0) {
    throw new Error("No input files specified.");
  }

  if (options.output && options.inputs.length !== 1) {
    throw new Error("--output can only be used with one input file.");
  }

  return options;
}

function expandInputs(patterns) {
  const results = [];

  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      results.push(pattern);
      continue;
    }

    const normalized = pattern.replaceAll("\\", "/");
    const slash = normalized.lastIndexOf("/");
    const directory = slash >= 0 ? normalized.slice(0, slash) : ".";
    const filePattern = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const expression = new RegExp(`^${filePattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);

    for (const entry of readdirSync(resolve(repoRoot, directory))) {
      if (expression.test(entry)) {
        results.push(`${directory}/${entry}`);
      }
    }
  }

  return results.sort();
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseSource(file, cliOptions) {
  const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  const options = {
    output: null,
    delay: 900,
    width: 1500,
    height: 960,
    background: "#f8fbff",
    title: basename(file, extname(file)),
  };

  const headerLines = [];
  const frames = [];
  let currentFrame = null;

  for (const line of lines) {
    const optionMatch = line.match(/^\s*%%\s*([a-zA-Z]+):\s*(.+?)\s*$/);
    if (optionMatch && ["output", "delay", "width", "height", "background", "title"].includes(optionMatch[1])) {
      options[optionMatch[1]] = optionMatch[2];
      continue;
    }

    const frameMatch = line.match(/^\s*%%\s*frame:\s*(.+?)\s*$/);
    if (frameMatch) {
      currentFrame = { label: frameMatch[1], lines: [] };
      frames.push(currentFrame);
      continue;
    }

    if (currentFrame) {
      currentFrame.lines.push(line);
    } else {
      headerLines.push(line);
    }
  }

  if (!options.output) {
    options.output = `../../img/${basename(file, extname(file))}.gif`;
  }

  options.delay = Number(options.delay);
  options.width = Number(options.width);
  options.height = Number(options.height);
  options.output = cliOptions.output
    ? resolve(repoRoot, cliOptions.output)
    : cliOptions.outDir
      ? resolve(repoRoot, cliOptions.outDir, `${basename(file, extname(file))}.gif`)
      : resolve(dirname(file), options.output);

  if (frames.length === 0) {
    throw new Error(`${file} does not define any "%% frame:" markers.`);
  }

  const participants = parseParticipants(headerLines);
  if (participants.length === 0) {
    throw new Error(`${file} does not define any participants.`);
  }

  return { options, participants, frames };
}

function parseParticipants(lines) {
  const participants = [];

  for (const line of lines) {
    const match = line.match(/^\s*participant\s+(\w+)\s+as\s+(.+?)\s*$/);
    if (match) {
      participants.push({ id: match[1], label: match[2] });
    }
  }

  return participants;
}

function parseOperation(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("%%") || trimmed === "sequenceDiagram" || trimmed === "autonumber") {
    return null;
  }

  const note = trimmed.match(/^Note\s+over\s+([\w,]+):\s*(.+?)\s*$/);
  if (note) {
    return { type: "note", participants: note[1].split(","), text: note[2] };
  }

  const message = trimmed.match(/^(\w+)\s*([-.]*>>?|-\))\s*(\w+):\s*(.+?)\s*$/);
  if (message) {
    return {
      type: "message",
      from: message[1],
      arrow: message[2],
      to: message[3],
      text: message[4],
      dashed: message[2].includes("--"),
    };
  }

  throw new Error(`Unsupported Mermaid line: ${line}`);
}

function buildFrameOperations(frames) {
  const operations = [];
  const frameOperations = [];

  for (const frame of frames) {
    for (const line of frame.lines) {
      const operation = parseOperation(line);
      if (operation) {
        operations.push(operation);
      }
    }

    frameOperations.push({ label: frame.label, operations: [...operations] });
  }

  return frameOperations;
}

function layout(participants, operations, width, height) {
  const top = 84;
  const actorY = 150;
  const actorWidth = participants.length > 4 ? 150 : 200;
  const actorHeight = 64;
  const left = participants.length > 4 ? 120 : 230;
  const right = width - left;
  const bottom = height - 48;
  const startY = 245;
  const available = bottom - startY - 42;
  const rowGap = Math.max(42, Math.min(64, available / Math.max(1, operations.length - 1)));
  const xStep = participants.length === 1 ? 0 : (right - left) / (participants.length - 1);
  const positions = new Map();

  participants.forEach((participant, index) => {
    positions.set(participant.id, left + xStep * index);
  });

  return { top, actorY, actorWidth, actorHeight, left, right, bottom, startY, rowGap, positions };
}

function operationYPositions(operations, state) {
  const positions = [];
  let y = state.startY;

  for (let index = 0; index < operations.length; index++) {
    const previous = operations[index - 1];
    if (index > 0) {
      y += state.rowGap;
      if (previous?.type === "message" && previous.from === previous.to) {
        y += 46;
      }
    }

    positions.push(y);
  }

  return positions;
}

function textColor(text) {
  if (text.includes("✉")) return "#0f766e";
  if (text.includes("⚡")) return "#7c3aed";
  if (text.includes("API") || text.includes("🔗") || text.includes("🛒")) return "#2563eb";
  if (text.includes("✅")) return "#15803d";
  if (text.includes("❌")) return "#dc2626";
  if (text.includes("⏱")) return "#b45309";
  return "#172033";
}

function drawText(text, x, y, { anchor = "middle", size = 18, weight = 500, fill = "#172033" } = {}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(text)}</text>`;
}

function drawArrow(x1, y1, x2, y2, { dashed = false } = {}) {
  const marker = x2 >= x1 ? "arrowEnd" : "arrowStart";
  const dash = dashed ? ' stroke-dasharray="5 5"' : "";
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1f3a5f" stroke-width="2.2"${dash} marker-end="url(#${marker})" />`;
}

function renderSvg({ options, participants, operations }) {
  const { width, height, background, title } = options;
  const state = layout(participants, operations, width, height);
  const yPositions = operationYPositions(operations, state);
  const parts = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  parts.push(`<defs>
    <marker id="arrowEnd" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f3a5f" />
    </marker>
    <marker id="arrowStart" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f3a5f" />
    </marker>
  </defs>`);
  parts.push(`<rect width="100%" height="100%" fill="${background}" />`);
  parts.push(drawText(title, width / 2, 54, { size: 30, weight: 750, fill: "#172033" }));

  participants.forEach((participant, index) => {
    const x = state.positions.get(participant.id);
    const previousX = index === 0 ? 0 : (state.positions.get(participants[index - 1].id) + x) / 2;
    const nextX = index === participants.length - 1 ? width : (x + state.positions.get(participants[index + 1].id)) / 2;
    const color = palette[index % palette.length];

    parts.push(`<rect x="${previousX + 2}" y="${state.actorY - 12}" width="${nextX - previousX - 4}" height="${state.bottom - state.actorY + 2}" rx="8" fill="${color.lane}" opacity="0.55" />`);
  });

  participants.forEach((participant, index) => {
    const x = state.positions.get(participant.id);
    const color = palette[index % palette.length];

    parts.push(`<rect x="${x - state.actorWidth / 2}" y="${state.actorY}" width="${state.actorWidth}" height="${state.actorHeight}" rx="9" fill="${color.actor}" stroke="${color.stroke}" stroke-width="2" />`);
    parts.push(drawText(participant.label, x, state.actorY + 40, { size: participants.length > 4 ? 16 : 20, weight: 650 }));
    parts.push(`<line x1="${x}" y1="${state.actorY + state.actorHeight}" x2="${x}" y2="${state.bottom}" stroke="${color.stroke}" stroke-width="2.3" opacity="0.78" />`);
  });

  operations.forEach((operation, index) => {
    const y = yPositions[index];

    if (operation.type === "note") {
      const xs = operation.participants.map((id) => state.positions.get(id)).filter((x) => Number.isFinite(x));
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const noteMargin = 60;
      const noteWidth = Math.min(width - noteMargin * 2, Math.max(250, maxX - minX + 200));
      const preferredX = (minX + maxX) / 2;
      const x = Math.max(noteMargin + noteWidth / 2, Math.min(width - noteMargin - noteWidth / 2, preferredX));
      parts.push(`<rect x="${x - noteWidth / 2}" y="${y - 30}" width="${noteWidth}" height="42" rx="4" fill="#fffbeb" stroke="#f59e0b" stroke-width="2" />`);
      parts.push(drawText(operation.text, x, y - 3, { size: 18, weight: 650, fill: textColor(operation.text) }));
      return;
    }

    const x1 = state.positions.get(operation.from);
    const x2 = state.positions.get(operation.to);
    const labelY = y - 10;
    const fill = textColor(operation.text);

    if (operation.from === operation.to) {
      const loopWidth = 48;
      parts.push(`<path d="M ${x1} ${y} h ${loopWidth} q 24 0 24 24 q 0 24 -24 24 h -${loopWidth}" fill="none" stroke="#1f3a5f" stroke-width="2.2" marker-end="url(#arrowStart)" />`);
      parts.push(drawText(operation.text, x1 + loopWidth + 85, y - 5, { anchor: "middle", size: 16, weight: 650, fill }));
    } else {
      const start = x1 < x2 ? x1 + 10 : x1 - 10;
      const end = x1 < x2 ? x2 - 10 : x2 + 10;
      parts.push(drawArrow(start, y, end, y, { dashed: operation.dashed }));
      parts.push(drawText(operation.text, (x1 + x2) / 2, labelY, { size: participants.length > 4 ? 15 : 20, weight: 650, fill }));
    }

    parts.push(`<circle cx="${x1}" cy="${y}" r="13" fill="#1f3a5f" />`);
    parts.push(drawText(String(index + 1), x1, y + 5, { size: 12, weight: 750, fill: "#ffffff" }));
  });

  parts.push("</svg>");
  return parts.join("\n");
}

async function svgToPng(svg) {
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderFrames(sourceFile, parsed, cliOptions) {
  const frameDefs = buildFrameOperations(parsed.frames);
  const frameDir = resolve(tempRoot, basename(sourceFile, extname(sourceFile)));
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  const frameFiles = [];
  for (let i = 0; i < frameDefs.length; i++) {
    const frame = frameDefs[i];
    const svg = renderSvg({
      options: parsed.options,
      participants: parsed.participants,
      operations: frame.operations,
    });
    const png = await svgToPng(svg);
    const frameFile = join(frameDir, `${String(i).padStart(3, "0")}.png`);
    writeFileSync(frameFile, png);
    frameFiles.push(frameFile);
    console.log(`  frame ${i + 1}/${frameDefs.length}: ${frame.label}`);
  }

  if (cliOptions.png) {
    const pngDir = parsed.options.output.replace(/\.gif$/i, "-frames");
    rmSync(pngDir, { recursive: true, force: true });
    mkdirSync(pngDir, { recursive: true });
    frameFiles.forEach((frameFile, index) => {
      writeFileSync(join(pngDir, `${String(index).padStart(3, "0")}.png`), readFileSync(frameFile));
    });
  }

  return frameFiles;
}

async function encodeGif(frameFiles, output, width, height, delay) {
  mkdirSync(dirname(output), { recursive: true });
  const encoder = new GIFEncoder(width, height, "neuquant", true);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(delay);
  encoder.setQuality(10);

  for (const frameFile of frameFiles) {
    const png = PNG.sync.read(readFileSync(frameFile));
    encoder.addFrame(png.data);
  }

  encoder.finish();
  writeFileSync(output, encoder.out.getData());
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2));
  const inputs = expandInputs(cliOptions.inputs);
  if (inputs.length === 0) {
    throw new Error(`No Mermaid files matched: ${cliOptions.inputs.join(", ")}`);
  }

  try {
    for (const input of inputs) {
      const sourceFile = resolve(repoRoot, input);
      const parsed = parseSource(sourceFile, cliOptions);
      console.log(`Rendering ${input} -> ${parsed.options.output}`);
      const frameFiles = await renderFrames(sourceFile, parsed, cliOptions);
      await encodeGif(frameFiles, parsed.options.output, parsed.options.width, parsed.options.height, parsed.options.delay);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
