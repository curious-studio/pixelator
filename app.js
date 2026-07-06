function trackEvent() {}

function debouncedTrack() {}

const SETTINGS_KEYS = ['contrast', 'brightness'];

function saveSettings() {
  try {
    const settings = {};
    for (const key of SETTINGS_KEYS) {
      settings[key] = state[key];
    }
    localStorage.setItem('mosaic_settings', JSON.stringify(settings));
  } catch {
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('mosaic_settings');
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const key of SETTINGS_KEYS) {
      if (key in saved) {
        state[key] = saved[key];
      }
    }
    syncControls();
  } catch {
  }
}

const els = {
  imageInput: document.getElementById("imageInput"),
  uploadButton: document.getElementById("uploadButton"),
  downloadPngButton: document.getElementById("downloadPngButton"),
  downloadButton: document.getElementById("downloadButton"),
  resetButton: document.getElementById("resetButton"),
  dropZone: document.getElementById("dropZone"),
  sourcePreview: document.getElementById("sourcePreview"),
  outputCanvas: document.getElementById("outputCanvas"),
  emptyState: document.getElementById("emptyState"),
  fileMeta: document.getElementById("fileMeta"),
  statusText: document.getElementById("statusText"),
  tilesPanel: document.querySelector(".tiles-panel"),
  cellSize: document.getElementById("cellSize"),
  maxOutput: document.getElementById("maxOutput"),
  showGrid: document.getElementById("showGrid"),
  brand: document.querySelector(".brand"),
  randomRotation: document.getElementById("randomRotation"),
  autoRender: document.getElementById("autoRender"),
  contrast: document.getElementById("contrast"),
  brightness: document.getElementById("brightness"),
  gamma: document.getElementById("gamma"),
  colorStrength: document.getElementById("colorStrength"),
  exportScale: document.getElementById("exportScale"),
  cellSizeValue: document.getElementById("cellSizeValue"),
  maxOutputValue: document.getElementById("maxOutputValue"),
  maxOutputPixels: document.getElementById("maxOutputPixels"),
  contrastValue: document.getElementById("contrastValue"),
  brightnessValue: document.getElementById("brightnessValue"),
  gammaValue: document.getElementById("gammaValue"),
  colorStrengthValue: document.getElementById("colorStrengthValue"),
  exportScaleValue: document.getElementById("exportScaleValue"),
  cellCount: document.getElementById("cellCount"),
  outputSize: document.getElementById("outputSize"),
  renderTime: document.getElementById("renderTime"),
  toneHistogram: document.getElementById("toneHistogram"),
  toneStrip: document.getElementById("toneStrip"),
  toneTilesSection: document.getElementById("toneTilesSection"),
  glyphValuesSection: document.getElementById("glyphValuesSection"),
  glyphValueGrid: document.getElementById("glyphValueGrid"),
  customTilesSection: document.getElementById("customTilesSection"),
  customTileInput: document.getElementById("customTileInput"),
  customTileUploadButton: document.getElementById("customTileUploadButton"),
  customTileGrid: document.getElementById("customTileGrid"),
  duoColors: document.getElementById("duoColors"),
  duoPaper: document.getElementById("duoPaper"),
  duoInk: document.getElementById("duoInk")
};
const DEFAULT_GLYPH_VALUES = [" ", ".", ",", "-", "+", "%", "o", "&", "@", "W"];
const GLYPH_SPACE_DISPLAY = "␣";

const defaults = {
  cellSize: 50,
  maxOutput: 1000,
  contrast: 1.00,
  brightness: 0,
  gamma: 1,
  colorStrength: 100,
  exportScale: 3,
  duoPaper: "#d6fffc",
  duoInk: "#982e8e",
  glyphValues: DEFAULT_GLYPH_VALUES,
  showGrid: false,
  randomRotation: false,
  autoRender: true,
  pack: "hatch",
  mode: "pixelate"
};

const DEFAULT_IMAGE_SRC = "gradient-400x400.jpg";
const DEFAULT_IMAGE_NAME = "gradient-400x400.jpg";
const PNG_EXPORT_MAX_EDGE = 10000;
const BLOCK_SIZE_OPTIONS = [5, 10, 15, 20, 25, 50, 100];
const CANVAS_SIZE_MIN = 100;
const CANVAS_SIZE_MAX = 2500;
const TILE_BASE_SIZE = 96;
const FIXED_TILE_COUNT = 20;

const state = {
  ...defaults,
  image: null,
  hasUploadedImage: false,
  fileName: DEFAULT_IMAGE_NAME,
  tileCache: new Map(),
  tintedTileCache: new Map(),
  glyphValues: [...DEFAULT_GLYPH_VALUES],
  customTiles: Array(10).fill(null),
  customTileVersion: 0,
  customTileInputTarget: null,
  customTileInputDirection: -1,
  draggedCustomTileIndex: null,
  cellSizeOptions: [],
  cells: [],
  histogram: Array(10).fill(0),
  renderTimer: 0,
  lastTileRenderMode: defaults.mode,
  lastRender: null
};

const ctx = els.outputCanvas.getContext("2d", { alpha: false });
const previewCtx = els.sourcePreview.getContext("2d", { alpha: false });

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function getImageDimensions(image) {
  return {
    width: image?.naturalWidth || image?.videoWidth || image?.width || 0,
    height: image?.naturalHeight || image?.videoHeight || image?.height || 0
  };
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function rgb(color) {
  return `rgb(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])})`;
}

function rgba(color, alpha) {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixColor(a, b, amount) {
  return [
    lerp(a[0], b[0], amount),
    lerp(a[1], b[1], amount),
    lerp(a[2], b[2], amount)
  ];
}

function glyphValueIndexForTone(tone) {
  return 10 - tone;
}

function glyphValueForTone(tone) {
  const index = glyphValueIndexForTone(tone);
  return state.glyphValues[index] ?? DEFAULT_GLYPH_VALUES[index];
}

function glyphFontScale(glyph) {
  const glyphLength = Array.from(glyph || "").length;
  if (glyphLength >= 3) return 0.48;
  if (glyphLength === 2) return 0.68;
  return 1;
}

function glyphFontSize(tone, scaleValue, glyph) {
  const baseSize = (88 - tone * 2.2) * 1.1 * glyphFontScale(glyph);
  return Math.max(scaleValue(22), Math.round(scaleValue(baseSize)));
}

function glyphInputSize(glyph) {
  const glyphLength = Array.from(glyph || "").length;
  if (glyphLength >= 3) return "0.92rem";
  if (glyphLength === 2) return "1.15rem";
  return "1.55rem";
}

function updateGlyphInputDisplay(input, glyph) {
  const isSpace = glyph === " ";
  const displayGlyph = isSpace ? GLYPH_SPACE_DISPLAY : glyph;
  input.value = displayGlyph;
  input.classList.toggle("is-space-placeholder", isSpace);
  input.style.fontSize = glyphInputSize(displayGlyph);
}

function normalizeGlyphInput(value) {
  const rawValue = value || "";
  if (!rawValue.length) return "";
  const collapsed = rawValue.replace(/\s/g, " ");
  const normalized = Array.from(collapsed).slice(0, 3).join("");
  if (/^ +$/.test(normalized)) return " ";
  return normalized;
}

function setStatus(text) {
  els.statusText.textContent = text;
  showStatus();
}

function showStatus() {
  els.statusText.classList.add("is-visible");
  clearTimeout(els.statusText._fadeTimer);
  els.statusText._fadeTimer = setTimeout(() => {
    if (!els.statusText.matches(":hover")) {
      els.statusText.classList.remove("is-visible");
    }
  }, 1000);
}

function closestOptionIndex(options, value) {
  const target = Number(value);
  return options.reduce((bestIndex, option, index) => {
    const best = options[bestIndex];
    const distance = Math.abs(option - target);
    const bestDistance = Math.abs(best - target);
    return distance < bestDistance ? index : bestIndex;
  }, 0);
}

function getCanvasSizeRange(blockSize = state.cellSize) {
  const min = Math.ceil(CANVAS_SIZE_MIN / blockSize) * blockSize;
  const max = Math.max(min, Math.floor(CANVAS_SIZE_MAX / blockSize) * blockSize);
  return { min, max };
}

function snapCanvasSize(value, blockSize = state.cellSize) {
  const { min, max } = getCanvasSizeRange(blockSize);
  const snapped = Math.round(Number(value) / blockSize) * blockSize;
  return clamp(snapped, min, max);
}

function refreshCanvasSizeControl() {
  const { min, max } = getCanvasSizeRange();
  state.maxOutput = snapCanvasSize(state.maxOutput);
  els.maxOutput.min = String(min);
  els.maxOutput.max = String(max);
  els.maxOutput.step = String(state.cellSize);
  els.maxOutput.value = String(state.maxOutput);
  els.maxOutput.title = `Canvas size adjusts in ${state.cellSize}px steps`;
}

function refreshCellSizeControl() {
  const options = BLOCK_SIZE_OPTIONS;
  const index = closestOptionIndex(options, state.cellSize);

  state.cellSizeOptions = options;
  state.cellSize = options[index];
  els.cellSize.min = "0";
  els.cellSize.max = String(Math.max(0, options.length - 1));
  els.cellSize.step = "1";
  els.cellSize.value = String(index);
  els.cellSize.disabled = false;
  els.cellSize.title = `Block size options: ${options.map((size) => `${size}px`).join(", ")}`;
  els.cellSizeValue.value = `${state.cellSize} px`;
  refreshCanvasSizeControl();
}

function updateLabels() {
  els.contrastValue.value = state.contrast.toFixed(2);
  els.brightnessValue.value = state.brightness.toFixed(2);
}

function syncControls() {
  els.contrast.value = state.contrast;
  els.brightness.value = state.brightness;
  updateLabels();
}

function scheduleRender() {
  saveSettings();
  updateLabels();
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderMosaic, 90);
}

function loadImageFromUrl(src, name) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
    image.dataset.name = name;
  });
}

function rasterizeImageSource(image, name = image?.dataset?.name || "") {
  const { width, height } = getImageDimensions(image);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  canvas.dataset.name = name;
  return canvas;
}

async function loadUploadedImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = rasterizeImageSource(bitmap, file.name);
      if (typeof bitmap.close === "function") bitmap.close();
      return canvas;
    } catch {
      // Fall back to the data URL path below.
    }
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromUrl(dataUrl, file.name);
  return rasterizeImageSource(image, file.name);
}

function imageCanBeSampled(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  try {
    context.drawImage(image, 0, 0, 1, 1);
    context.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

function makeDefaultGradientImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;
  const context = canvas.getContext("2d");

  // Updated: Radial gradient starting from (0,0)
  // Arguments: x0, y0, r0, x1, y1, r1
  // Inner circle at (0,0) with radius 0, 
  // Outer circle at (0,0) with radius 566 (approx. distance to opposite corner)
  const base = context.createRadialGradient(0, 0, 0, 0, 0, 566);
  base.addColorStop(0, "#f9f9f9");
  base.addColorStop(0.36, "#cfcfcf");
  base.addColorStop(0.68, "#272727");
  base.addColorStop(1, "#020202");
  context.fillStyle = base;
  context.fillRect(0, 0, 400, 400);

  // Glow and Shadow layers (kept as per your original logic)
  const glow = context.createRadialGradient(78, 58, 0, 78, 58, 340);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.96)");
  glow.addColorStop(0.48, "rgba(255, 255, 255, 0.32)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 400, 400);

  const shadow = context.createRadialGradient(398, 355, 0, 398, 355, 310);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.72)");
  shadow.addColorStop(0.6, "rgba(0, 0, 0, 0.2)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = shadow;
  context.fillRect(0, 0, 400, 400);

  return loadImageFromUrl(canvas.toDataURL("image/jpeg", 0.92), DEFAULT_IMAGE_NAME);
}

async function loadDefaultImage() {
  try {
    const image = await loadImageFromUrl(DEFAULT_IMAGE_SRC, DEFAULT_IMAGE_NAME);
    if (imageCanBeSampled(image)) return image;
  } catch {
    // Fall back below when the local file cannot be loaded directly.
  }
  return makeDefaultGradientImage();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageHasTransparency(image) {
  const { width, height } = getImageDimensions(image);
  if (!width || !height) return false;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true;
  }
  return false;
}

function makeCustomTileId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function makeCustomTile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromUrl(dataUrl, file.name);
  return {
    id: makeCustomTileId(),
    name: file.name,
    dataUrl,
    image,
    hasTransparency: imageHasTransparency(image)
  };
}

function dataTransferHasFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function clearCustomTileDropTargets() {
  els.customTileGrid.querySelectorAll(".is-drop-target").forEach((slot) => {
    slot.classList.remove("is-drop-target");
  });
}

function commitCustomTileChange(statusText) {
  state.customTileVersion += 1;
  state.tileCache.clear();
  state.tintedTileCache.clear();
  syncControls();
  scheduleRender();
  if (statusText) setStatus(statusText);
}

async function handleCustomTileFiles(fileList, startIndex = 9, direction = -1) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  const start = Math.max(0, Math.min(9, Number.isInteger(startIndex) ? startIndex : 0));
  const step = direction < 0 ? -1 : 1;
  const slotCount = step < 0 ? start + 1 : 10 - start;
  const selected = files.slice(0, slotCount);

  if (!selected.length) {
    setStatus("Choose image files");
    return;
  }

  setStatus("Loading custom tiles");
  const loaded = [];
  for (const file of selected) {
    try {
      loaded.push(await makeCustomTile(file));
    } catch {
      setStatus(`${file.name} could not be loaded`);
    }
  }

  if (!loaded.length) return;

  loaded.forEach((tile, offset) => {
    state.customTiles[start + offset * step] = tile;
  });
  state.pack = "custom";
  commitCustomTileChange(`${loaded.length} custom tile${loaded.length === 1 ? "" : "s"} loaded`);
}

function reorderCustomTile(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || fromIndex > 9 || toIndex < 0 || toIndex > 9) return;

  const [tile] = state.customTiles.splice(fromIndex, 1);
  state.customTiles.splice(toIndex, 0, tile);
  state.customTiles.length = 10;
  state.pack = "custom";
  commitCustomTileChange("Custom tiles reordered");
}

function commitGlyphValueChange(statusText) {
  state.tileCache.clear();
  state.tintedTileCache.clear();
  scheduleRender();
  if (statusText) setStatus(statusText);
}

function renderGlyphValueGrid() {
  els.glyphValueGrid.innerHTML = "";
  state.glyphValues.forEach((glyph, index) => {
    const valueNumber = index + 1;
    const slot = document.createElement("label");
    slot.className = "glyph-value-slot";
    slot.setAttribute("aria-label", `Value ${valueNumber} glyph`);

    const number = document.createElement("span");
    number.className = "custom-tile-number";
    number.textContent = String(valueNumber);

    const input = document.createElement("input");
    input.className = "glyph-value-input";
    input.type = "text";
    input.inputMode = "text";
    input.spellcheck = false;
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.maxLength = 3;
    input.setAttribute("aria-label", `Glyph for value ${valueNumber}`);
    updateGlyphInputDisplay(input, glyph);

    input.addEventListener("focus", () => {
      if (input.classList.contains("is-space-placeholder")) input.select();
    });

    input.addEventListener("input", () => {
      const nextGlyph = normalizeGlyphInput(input.value);
      state.glyphValues[index] = nextGlyph;
      updateGlyphInputDisplay(input, nextGlyph);
      commitGlyphValueChange("Glyph values updated");
    });

    input.addEventListener("blur", () => {
      if (input.value.length) return;
      state.glyphValues[index] = " ";
      updateGlyphInputDisplay(input, state.glyphValues[index]);
      commitGlyphValueChange("Glyph values updated");
    });

    slot.append(number, input);
    els.glyphValueGrid.append(slot);
  });
}

function renderCustomTileGrid() {
  els.customTileGrid.innerHTML = "";
  const displayOrder = Array.from({ length: 10 }, (_, index) => 9 - index);
  displayOrder.forEach((index) => {
    const tile = state.customTiles[index];
    const valueNumber = 10 - index;
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = `custom-tile-slot${tile ? " is-filled" : ""}`;
    slot.draggable = true;
    slot.dataset.index = String(index);
    slot.title = tile ? tile.name : `Value ${valueNumber}`;
    slot.setAttribute("aria-label", tile ? `Value ${valueNumber}: ${tile.name}` : `Value ${valueNumber}: empty custom tile`);

    const number = document.createElement("span");
    number.className = "custom-tile-number";
    number.textContent = String(valueNumber);

    const thumb = document.createElement("span");
    thumb.className = "custom-tile-thumb";
    if (tile) {
      const image = document.createElement("img");
      image.src = tile.dataUrl;
      image.alt = "";
      thumb.append(image);
    }

    const overlay = document.createElement("span");
    overlay.className = "thumbnail-upload-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 16V4"></path>
        <path d="m7 9 5-5 5 5"></path>
        <path d="M5 20h14"></path>
      </svg>
    `;
    thumb.append(overlay);

    const handle = document.createElement("span");
    handle.className = "custom-tile-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.innerHTML = `
      <svg viewBox="0 0 24 24">
        <circle cx="8" cy="7" r="1.7"></circle>
        <circle cx="16" cy="7" r="1.7"></circle>
        <circle cx="8" cy="12" r="1.7"></circle>
        <circle cx="16" cy="12" r="1.7"></circle>
        <circle cx="8" cy="17" r="1.7"></circle>
        <circle cx="16" cy="17" r="1.7"></circle>
      </svg>
    `;

    const name = document.createElement("span");
    name.className = "custom-tile-name";
    name.textContent = tile ? tile.name : "Empty";

    slot.append(number, thumb, handle, name);

    slot.addEventListener("click", () => {
      state.customTileInputTarget = index;
      state.customTileInputDirection = -1;
      els.customTileInput.multiple = false;
      els.customTileInput.click();
    });

    slot.addEventListener("dragstart", (event) => {
      state.draggedCustomTileIndex = index;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      slot.classList.add("is-dragging");
    });

    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = dataTransferHasFiles(event) ? "copy" : "move";
      clearCustomTileDropTargets();
      slot.classList.add("is-drop-target");
    });

    slot.addEventListener("dragleave", () => {
      slot.classList.remove("is-drop-target");
    });

    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearCustomTileDropTargets();

      if (event.dataTransfer.files.length) {
        handleCustomTileFiles(event.dataTransfer.files, index, -1);
        return;
      }

      const from = Number(event.dataTransfer.getData("text/plain") || state.draggedCustomTileIndex);
      if (Number.isInteger(from)) reorderCustomTile(from, index);
    });

    slot.addEventListener("dragend", () => {
      state.draggedCustomTileIndex = null;
      slot.classList.remove("is-dragging");
      clearCustomTileDropTargets();
    });

    els.customTileGrid.append(slot);
  });
}

function drawImageCropped(context, image, x, y, width, height) {
  const { width: imageWidth, height: imageHeight } = getImageDimensions(image);
  if (!imageWidth || !imageHeight) return;

  const scale = Math.max(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawImageContained(context, image, width, height) {
  context.fillStyle = "#eef1f2";
  context.fillRect(0, 0, width, height);
  const { width: imageWidth, height: imageHeight } = getImageDimensions(image);
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  context.drawImage(image, x, y, drawWidth, drawHeight);
}

function drawPreview() {
  if (!state.image) return;
  drawImageContained(previewCtx, state.image, els.sourcePreview.width, els.sourcePreview.height);
  els.fileMeta.hidden = !state.hasUploadedImage;
  els.fileMeta.textContent = state.hasUploadedImage ? state.fileName : "";
}

function getSnappedOutputDimensions(sourceWidth, sourceHeight, maxSide, blockSize) {
  const snappedMaxSide = snapCanvasSize(maxSide, blockSize);
  if (!sourceWidth || !sourceHeight) {
    return {
      width: snappedMaxSide,
      height: snappedMaxSide
    };
  }

  const scale = snappedMaxSide / Math.max(sourceWidth, sourceHeight);
  const snappedWidth = Math.max(blockSize, Math.round((sourceWidth * scale) / blockSize) * blockSize);
  const snappedHeight = Math.max(blockSize, Math.round((sourceHeight * scale) / blockSize) * blockSize);

  if (sourceWidth >= sourceHeight) {
    return {
      width: snappedMaxSide,
      height: snappedHeight
    };
  }

  return {
    width: snappedWidth,
    height: snappedMaxSide
  };
}

function getOutputDimensions(image) {
  const fixedSize = state.cellSize * FIXED_TILE_COUNT;
  return {
    width: fixedSize,
    height: fixedSize
  };
}

function applyToneCurve(luminance) {
  let value = clamp(luminance);
  value = (value - 0.5) * state.contrast + 0.5 + state.brightness;
  value = clamp(value);
  value = Math.pow(value, state.gamma);
  return clamp(value);
}

function createCustomTileCanvas(tone, size = TILE_BASE_SIZE) {
  const customTile = state.customTiles[tone - 1];
  if (!customTile?.image) return createTileCanvas(tone, "hatch", size);

  const key = `custom-${tone}-${size}-${state.customTileVersion}`;
  if (state.tileCache.has(key)) return state.tileCache.get(key);

  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tileCtx = tile.getContext("2d");
  if (customTile.hasTransparency) {
    tileCtx.clearRect(0, 0, size, size);
  } else {
    tileCtx.fillStyle = "#fff";
    tileCtx.fillRect(0, 0, size, size);
  }
  drawImageCropped(tileCtx, customTile.image, 0, 0, size, size);

  const imageData = tileCtx.getImageData(0, 0, size, size);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const sourceAlpha = data[i + 3] / 255;
    const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    const mask = customTile.hasTransparency ? sourceAlpha : 1 - luminance;
    data[i] = 5;
    data[i + 1] = 5;
    data[i + 2] = 5;
    data[i + 3] = Math.round(clamp(mask) * 255);
  }

  tileCtx.putImageData(imageData, 0, 0);
  state.tileCache.set(key, tile);
  return tile;
}

function createTileCanvas(tone, pack, size = TILE_BASE_SIZE) {
  if (pack === "custom") return createCustomTileCanvas(tone, size);

  const key = `${pack}-${tone}-${size}`;
  if (state.tileCache.has(key)) return state.tileCache.get(key);

  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const t = tile.getContext("2d");
  const density = (11 - tone) / 10;
  const scale = size / TILE_BASE_SIZE;
  const scaled = (value) => value * scale;
  t.clearRect(0, 0, size, size);
  t.fillStyle = "#050505";
  t.strokeStyle = "#050505";
  t.lineCap = "round";
  t.lineJoin = "round";

  if (pack === "glyph") {
    const glyph = glyphValueForTone(tone);
    t.globalAlpha = 0.9;
    t.font = `800 ${glyphFontSize(tone, scaled, glyph)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    t.textAlign = "center";
    t.textBaseline = "middle";
    t.fillText(glyph, scaled(48), scaled(52));
  }

if (pack === "hatch") {
    const spacing = scaled(5 + tone * 5.2);
    const hatchOffset = 6; 
    
    t.lineWidth = Math.max(scaled(0.05), scaled(9 - tone * 0.99));
        for (let i = (-size + hatchOffset); i < size * 2; i += spacing) {
      t.beginPath();
      t.moveTo(i, scaled(98));
      t.lineTo(i + scaled(98), 0);
      t.stroke();
    }
    
    if (tone <= 5) {
      t.globalAlpha = 1.00;
      for (let i = (-scaled(72) - (hatchOffset * 0.5)); i < size * 2; i += spacing * 1.35) {
        t.beginPath();
        t.moveTo(i, 0);
        t.lineTo(i + scaled(98), scaled(98));
        t.stroke();
      }
    }
  }

  if (pack === "dot") {
    const radius = Math.max(scaled(3), scaled(density * 22));
    const positions = [
      [26, 26],
      [70, 26],
      [26, 70],
      [70, 70],
      [48, 48]
    ];
    positions.forEach(([x, y], index) => {
      const dotSize = index === 4 ? radius * 1.25 : radius;
      t.beginPath();
      t.arc(scaled(x), scaled(y), dotSize, 0, Math.PI * 2);
      t.fill();
    });
  }

  if (pack === "block") {
    const inset = scaled(tone * 3.8);
    t.fillRect(inset, inset, size - inset * 2, size - inset * 2);
    if (tone <= 6) {
      t.globalAlpha = 0.48;
      const bar = Math.max(scaled(5), scaled(22 - tone * 2));
      t.fillRect(0, 0, size, bar);
      t.fillRect(0, size - bar, size, bar);
    }
  }

  state.tileCache.set(key, tile);
  return tile;
}

function getPaintForCell(cell) {
  const luminance = (0.2126 * cell.color[0] + 0.7152 * cell.color[1] + 0.0722 * cell.color[2]) / 255;
  const grey = Math.round(luminance * 255);
  return {
    base: [grey, grey, grey],
    ink: [0, 0, 0],
    opacity: 0.86
  };
}

function createTintedTile(tone, width, height) {
  const paint = getPaintForCell({ tone, color: [0, 0, 0] });
  const sourceSize = Math.max(TILE_BASE_SIZE, width, height);
  const key = `${state.pack}-${state.mode}-${tone}-${width}x${height}-${sourceSize}-${paint.ink.join("-")}-${paint.opacity}`;
  if (state.tintedTileCache.has(key)) return state.tintedTileCache.get(key);

  const tile = createTileCanvas(tone, state.pack, sourceSize);
  const tinted = document.createElement("canvas");
  tinted.width = width;
  tinted.height = height;
  const tintedCtx = tinted.getContext("2d");
  tintedCtx.drawImage(tile, 0, 0, width, height);
  tintedCtx.globalCompositeOperation = "source-in";
  tintedCtx.fillStyle = rgba(paint.ink, paint.opacity);
  tintedCtx.fillRect(0, 0, width, height);
  state.tintedTileCache.set(key, tinted);
  return tinted;
}

function customTileDataUrl(tone, size, ink, opacity, cache) {
  const key = `${tone}-${size}-${ink.join("-")}-${opacity}-${state.customTileVersion}`;
  if (cache.has(key)) return cache.get(key);

  const tile = createTileCanvas(tone, "custom", size);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const canvasCtx = canvas.getContext("2d");
  canvasCtx.drawImage(tile, 0, 0, size, size);
  canvasCtx.globalCompositeOperation = "source-in";
  canvasCtx.fillStyle = rgba(ink, opacity);
  canvasCtx.fillRect(0, 0, size, size);
  const dataUrl = canvas.toDataURL("image/png");
  cache.set(key, dataUrl);
  return dataUrl;
}

function drawToneStrip() {
  els.toneStrip.innerHTML = "";
  for (let value = 1; value <= 10; value += 1) {
    const tone = 11 - value;
    const wrapper = document.createElement("div");
    wrapper.className = "tone-tile";
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const tileCtx = canvas.getContext("2d");
    tileCtx.fillStyle = "#fff";
    tileCtx.fillRect(0, 0, 96, 96);
    tileCtx.drawImage(createTileCanvas(tone, state.pack), 0, 0);
    const label = document.createElement("span");
    label.textContent = value;
    wrapper.append(canvas, label);
    els.toneStrip.append(wrapper);
  }
}

function readCellAverage(data, imageWidth, x, y, width, height) {
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 7));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let yy = y; yy < y + height; yy += stride) {
    const row = yy * imageWidth;
    for (let xx = x; xx < x + width; xx += stride) {
      const i = (row + xx) * 4;
      const alpha = data[i + 3] / 255;
      r += data[i] * alpha + 255 * (1 - alpha);
      g += data[i + 1] * alpha + 255 * (1 - alpha);
      b += data[i + 2] * alpha + 255 * (1 - alpha);
      count += 1;
    }
  }

  return [r / count, g / count, b / count];
}

function randomTileRotation() {
  if (!state.randomRotation) return 0;
  return [0, 90, 180, 270][Math.floor(Math.random() * 4)];
}

function drawTileCell(context, cell, scale = 1) {
  const { base } = getPaintForCell(cell);
  const x = Math.round(cell.x * scale);
  const y = Math.round(cell.y * scale);
  const width = Math.max(1, Math.round((cell.x + cell.width) * scale) - x);
  const height = Math.max(1, Math.round((cell.y + cell.height) * scale) - y);
  const rotation = cell.rotation || 0;
  const tileWidth = rotation % 180 === 0 ? width : Math.max(width, height);
  const tileHeight = rotation % 180 === 0 ? height : Math.max(width, height);

  if (state.mode === "pixelate") {
    const l = (0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]) / 255;
    const curved = applyToneCurve(l);
    const adjusted = l > 0
      ? base.map(c => Math.min(255, Math.max(0, Math.round(c * (curved / l)))))
      : [Math.round(curved * 255), Math.round(curved * 255), Math.round(curved * 255)];
    context.fillStyle = rgb(adjusted);
    context.fillRect(x, y, width, height);
    if (state.showGrid) {
      context.strokeStyle = "rgba(255, 255, 255, 0.42)";
      context.lineWidth = Math.max(1, Math.round(scale));
      context.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    }
    return;
  }

  context.fillStyle = rgb(base);
  context.fillRect(x, y, width, height);

  if (rotation) {
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.translate(x + width / 2, y + height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(createTintedTile(cell.tone, tileWidth, tileHeight), -tileWidth / 2, -tileHeight / 2);
    context.restore();
  } else {
    context.drawImage(createTintedTile(cell.tone, tileWidth, tileHeight), x, y);
  }

  if (state.showGrid) {
    context.strokeStyle = "rgba(255, 255, 255, 0.42)";
    context.lineWidth = Math.max(1, Math.round(scale));
    context.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
  }
}

function renderMosaic() {
  if (!state.image) return;
  const started = performance.now();
  setStatus("Rendering mosaic");
  els.emptyState.textContent = "Preparing canvas";
  els.emptyState.classList.remove("hidden");

  try {
    const { width, height } = getOutputDimensions(state.image);
    els.outputCanvas.width = width;
    els.outputCanvas.height = height;

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    sourceCtx.drawImage(state.image, 0, 0, width, height);
    const imageData = sourceCtx.getImageData(0, 0, width, height);
    const data = imageData.data;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    state.cells = [];
    state.histogram = Array(10).fill(0);
    state.tintedTileCache.clear();

    const cellSize = Number(state.cellSize);
    const rows = Math.floor(height / cellSize);
    const columns = Math.floor(width / cellSize);
    for (let row = 0; row < rows; row += 1) {
      const y = row * cellSize;
      for (let column = 0; column < columns; column += 1) {
        const x = column * cellSize;
        const cellWidth = cellSize;
        const cellHeight = cellSize;
        const color = readCellAverage(data, width, x, y, cellWidth, cellHeight);
        const luminance = (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) / 255;
        const curved = applyToneCurve(luminance);
        const tone = Math.min(10, Math.max(1, Math.ceil(curved * 10)));
        const cell = {
          x,
          y,
          width: cellWidth,
          height: cellHeight,
          color,
          luminance,
          tone,
          rotation: randomTileRotation()
        };
        state.cells.push(cell);
        state.histogram[tone - 1] += 1;
        drawTileCell(ctx, cell);
      }
    }

    state.lastRender = {
      width,
      height,
      cellSize,
      pack: state.pack,
      mode: state.mode
    };

    const elapsed = Math.max(1, Math.round(performance.now() - started));
    updateStats(elapsed);
    els.emptyState.classList.add("hidden");
    setStatus(`${state.fileName} mapped into ${state.cells.length.toLocaleString()} tiles`);
  } catch (error) {
    els.emptyState.textContent = "Image could not be rendered";
    setStatus("Image could not be rendered");
    console.error(error);
  }
}

function updateStats(elapsed) {
  if (els.cellCount) {
    els.cellCount.textContent = state.cells.length.toLocaleString();
  }
  if (els.outputSize) {
    els.outputSize.textContent = `${els.outputCanvas.width} x ${els.outputCanvas.height}`;
  }
  if (els.renderTime) {
    els.renderTime.textContent = `${elapsed} ms`;
  }
  if (els.toneHistogram) {
    const max = Math.max(1, ...state.histogram);
    els.toneHistogram.innerHTML = "";
    state.histogram.forEach((count, index) => {
      const bar = document.createElement("span");
      bar.dataset.tone = String(index + 1);
      bar.title = `Tone ${index + 1}: ${count.toLocaleString()} cells`;
      bar.style.height = `${Math.max(5, (count / max) * 58)}px`;
      els.toneHistogram.append(bar);
    });
  }
}

function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Choose an image file");
    return;
  }
  setStatus(`Loading ${file.name}`);
  loadUploadedImage(file)
    .then((image) => {
      state.image = image;
      state.hasUploadedImage = true;
      state.fileName = file.name;
      drawPreview();
      renderMosaic();
      trackEvent('image_upload', { file_name: file.name });
    })
    .catch(() => {
      setStatus("Image could not be loaded");
    });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function safeName() {
  return state.fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "mosaic";
}

function timestampSlug(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function exportFileName(extension) {
  return `Pixelator-${safeName()}-${timestampSlug()}.${extension}`;
}

function renderPngExportCanvas() {
  if (!state.cells.length || !els.outputCanvas.width || !els.outputCanvas.height) {
    renderMosaic();
  }
  if (!state.cells.length || !els.outputCanvas.width || !els.outputCanvas.height) return null;

  const requestedScale = Math.max(1, Number(state.exportScale) || defaults.exportScale);
  const scale = Math.min(
    requestedScale,
    PNG_EXPORT_MAX_EDGE / els.outputCanvas.width,
    PNG_EXPORT_MAX_EDGE / els.outputCanvas.height
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(els.outputCanvas.width * scale));
  canvas.height = Math.max(1, Math.round(els.outputCanvas.height * scale));
  const exportCtx = canvas.getContext("2d", { alpha: false });

  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, canvas.width, canvas.height);
  state.cells.forEach((cell) => drawTileCell(exportCtx, cell, scale));

  return canvas;
}

function exportPng() {
  const exportCanvas = renderPngExportCanvas();
  if (!exportCanvas) {
    setStatus("PNG could not be exported");
    return;
  }
  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, exportFileName("png"));
    setStatus(`PNG exported at ${exportCanvas.width} x ${exportCanvas.height}`);
    trackEvent('image_export', { format: 'PNG', pixels: exportCanvas.width * exportCanvas.height });
  }, "image/png");
}

function resetControls() {
  state.tileCache.clear();
  state.tintedTileCache.clear();
  Object.assign(state, {
    cellSize: defaults.cellSize,
    maxOutput: defaults.maxOutput,
    contrast: defaults.contrast,
    brightness: defaults.brightness,
    gamma: defaults.gamma,
    colorStrength: defaults.colorStrength,
    exportScale: defaults.exportScale,
    duoPaper: defaults.duoPaper,
    duoInk: defaults.duoInk,
    glyphValues: [...DEFAULT_GLYPH_VALUES],
    showGrid: defaults.showGrid,
    randomRotation: defaults.randomRotation,
    autoRender: defaults.autoRender,
    pack: defaults.pack,
    mode: defaults.mode,
    lastTileRenderMode: defaults.mode
  });
  syncControls();
  scheduleRender();
  trackEvent('reset', { source: 'button' });
}

function bindEvents() {
  els.uploadButton.addEventListener("click", () => els.imageInput.click());
  els.imageInput.addEventListener("change", (event) => handleFile(event.target.files[0]));
  els.downloadPngButton.addEventListener("click", exportPng);
  els.downloadButton.addEventListener("click", exportPng);
  els.resetButton.addEventListener("click", resetControls);
  [els.contrast, els.brightness].forEach((input) => {
    input.addEventListener("input", () => {
      state[input.id] = Number(input.value);
      scheduleRender();
      debouncedTrack('parameter_adjust', { parameter: input.id });
    });
  });

  ["dragenter", "dragover"].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    handleFile(event.dataTransfer.files[0]);
  });

  window.addEventListener("scroll", () => {
    if (window.scrollY > 0) {
      els.brand.classList.add("is-shrunk");
    }
  }, { once: true });

  els.statusText.addEventListener("mouseenter", () => {
    els.statusText.classList.add("is-visible");
    clearTimeout(els.statusText._fadeTimer);
  });

  els.statusText.addEventListener("mouseleave", () => {
    els.statusText.classList.remove("is-visible");
  });
}

async function init() {
  bindEvents();
  syncControls();
  loadSettings();
  try {
    state.image = await loadDefaultImage();
    state.hasUploadedImage = false;
    state.fileName = DEFAULT_IMAGE_NAME;
    drawPreview();
    renderMosaic();
  } catch {
    els.emptyState.textContent = "Default image could not be loaded";
    setStatus("Default image could not be loaded");
  }
}

init();
