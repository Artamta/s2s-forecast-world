import type { FieldData } from "../lib/data";
import { formatLatitude, formatLongitude } from "../lib/format";
import type { View } from "../types";
import { contourSegments } from "./contours";
import type { Geography } from "./geography";
import { strokeLines, type Line } from "./lines";
import type { Shader } from "./shading";
import {
  clampViewport,
  fitView,
  panBy,
  projectX,
  projectY,
  unproject,
  visibleBox,
  zoomAt,
  type Viewport,
} from "./viewport";

const NO_DATA = "#f7f9fa";
const INK = "#162033";
const CONTOUR_STEP = 8;
const SEA_OPACITY = 0.3;
const GRATICULE_STEPS = [1.5, 3, 5, 10, 15, 30, 45];

export interface MapPoint {
  latitude: number;
  longitude: number;
}

export interface MapOptions {
  interactive: boolean;
  onHover?: (point: MapPoint | null, x: number, y: number) => void;
  onSelect?: (point: MapPoint) => void;
}

interface Layers {
  shader: Shader | null;
  week: number;
  smooth: boolean;
  wind: FieldData | null;
  outline: Line[];
  selection: MapPoint | null;
  /** Draw isolines of the shaded value at the shader's levels. */
  contours: boolean;
  /** Outline of the country under the pointer. */
  highlight: Line[];
  /** Land share at a position; when set, shading over sea is drawn faint. */
  land: ((latitude: number, longitude: number) => number) | null;
}

/** A canvas map of one field over any window of the globe. */
export class RegionMap {
  readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly raster = document.createElement("canvas");
  private viewport: Viewport = { lon: 0, lat: 0, scale: 1, aspect: 1, width: 1, height: 1 };
  private view: View = { west: -180, east: 180, south: -90, north: 90 };
  private layers: Layers = { shader: null, week: 0, smooth: true, wind: null, outline: [], selection: null, contours: false, highlight: [], land: null };
  private frame = 0;
  private timer = 0;
  private readonly observer: ResizeObserver;
  private readonly stopGeography: () => void;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragged = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly geography: Geography,
    private readonly options: MapOptions,
  ) {
    this.context = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    this.canvas.className = "wmap__canvas";
    host.append(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.stopGeography = geography.onChange(() => this.requestRender());
    if (options.interactive) this.bindInteraction();
    this.resize();
  }

  destroy(): void {
    this.observer.disconnect();
    this.stopGeography();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timer);
    this.canvas.remove();
  }

  /** Show a region's view box, replacing any pan or zoom. */
  setView(view: View): void {
    this.view = view;
    this.viewport = fitView(view, this.viewport.width, this.viewport.height);
    this.requestRender();
  }

  resetView(): void {
    this.setView(this.view);
  }

  update(layers: Partial<Layers>): void {
    this.layers = { ...this.layers, ...layers };
    this.requestRender();
  }

  zoom(factor: number): void {
    this.viewport = zoomAt(this.viewport, this.viewport.width / 2, this.viewport.height / 2, factor);
    this.requestRender();
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const fitted = this.viewport.width === 1;
    this.viewport = fitted
      ? fitView(this.view, width, height)
      : clampViewport({ ...this.viewport, width, height });
    this.requestRender();
  }

  /** Draw on the next frame; the timer covers pages whose frames are paused (headless, hidden tab). */
  private requestRender(): void {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timer);
    this.frame = requestAnimationFrame(() => this.render());
    this.timer = window.setTimeout(() => this.render(), 80);
  }

  private render(): void {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timer);
    const ratio = this.canvas.width / this.viewport.width;
    const context = this.context;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = NO_DATA;
    context.fillRect(0, 0, this.viewport.width, this.viewport.height);
    this.drawField();
    if (this.layers.contours) this.drawContours();
    this.drawGraticule();
    const coast = this.geography.detailedCoast(this.viewport) ?? this.geography.coast;
    strokeLines(context, this.viewport, this.geography.borders, "rgb(255 255 255 / 35%)", 1.8);
    strokeLines(context, this.viewport, this.geography.borders, "rgb(28 43 54 / 72%)", 0.9);
    strokeLines(context, this.viewport, coast, "rgb(255 255 255 / 40%)", 2);
    strokeLines(context, this.viewport, coast, "rgb(28 43 54 / 95%)", 1.1);
    if (this.layers.wind) this.drawWind(this.layers.wind);
    if (this.layers.highlight.length) {
      strokeLines(context, this.viewport, this.layers.highlight, "rgb(255 255 255 / 90%)", 3.2);
      strokeLines(context, this.viewport, this.layers.highlight, "#117c7e", 1.6);
    }
    if (this.layers.outline.length) {
      strokeLines(context, this.viewport, this.layers.outline, "rgb(255 255 255 / 80%)", 3.4);
      strokeLines(context, this.viewport, this.layers.outline, INK, 1.4);
    }
    if (this.layers.selection) this.drawSelection(this.layers.selection);
  }

  private drawField(): void {
    const { shader, week, smooth, land } = this.layers;
    if (!shader) return;
    const step = smooth ? 2 : 1;
    const cols = Math.ceil(this.viewport.width / step);
    const rows = Math.ceil(this.viewport.height / step);
    this.raster.width = cols;
    this.raster.height = rows;
    const rasterContext = this.raster.getContext("2d") as CanvasRenderingContext2D;
    const image = rasterContext.createImageData(cols, rows);
    const longitudes = new Float64Array(cols);
    for (let col = 0; col < cols; col += 1) {
      longitudes[col] = unproject(this.viewport, (col + 0.5) * step, 0).longitude;
    }
    for (let row = 0; row < rows; row += 1) {
      const latitude = unproject(this.viewport, 0, (row + 0.5) * step).latitude;
      if (latitude > 90 || latitude < -90) continue;
      for (let col = 0; col < cols; col += 1) {
        const rgb = shader.rgbAt(week, latitude, longitudes[col], smooth);
        if (!rgb) continue;
        const offset = (row * cols + col) * 4;
        image.data[offset] = rgb[0];
        image.data[offset + 1] = rgb[1];
        image.data[offset + 2] = rgb[2];
        const opacity = land ? SEA_OPACITY + (1 - SEA_OPACITY) * land(latitude, longitudes[col]) : 1;
        image.data[offset + 3] = Math.round(255 * opacity);
      }
    }
    rasterContext.putImageData(image, 0, 0);
    this.context.imageSmoothingEnabled = smooth;
    this.context.drawImage(this.raster, 0, 0, cols * step, rows * step);
  }

  /** Thin isolines of the shaded value, sampled on a coarse screen grid. */
  private drawContours(): void {
    const { shader, week } = this.layers;
    if (!shader?.valueAt || !shader.levels) return;
    const cols = Math.ceil(this.viewport.width / CONTOUR_STEP) + 1;
    const rows = Math.ceil(this.viewport.height / CONTOUR_STEP) + 1;
    const values = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const { latitude, longitude } = unproject(this.viewport, col * CONTOUR_STEP, row * CONTOUR_STEP);
        values[row * cols + col] = Math.abs(latitude) > 90 ? Number.NaN : shader.valueAt(week, latitude, longitude);
      }
    }
    const context = this.context;
    context.beginPath();
    for (const level of shader.levels) {
      const segments = contourSegments(values, cols, rows, level);
      for (let index = 0; index < segments.length; index += 4) {
        context.moveTo(segments[index] * CONTOUR_STEP, segments[index + 1] * CONTOUR_STEP);
        context.lineTo(segments[index + 2] * CONTOUR_STEP, segments[index + 3] * CONTOUR_STEP);
      }
    }
    context.strokeStyle = "rgb(22 32 51 / 34%)";
    context.lineWidth = 0.7;
    context.lineCap = "round";
    context.stroke();
  }

  private drawGraticule(): void {
    const box = visibleBox(this.viewport);
    const span = Math.max(box.east - box.west, box.north - box.south);
    const step = GRATICULE_STEPS.find((candidate) => span / candidate <= 5) ?? 60;
    const context = this.context;
    context.beginPath();
    const labels: Array<[string, number, number]> = [];
    context.font = "10.5px system-ui, sans-serif";
    context.fillStyle = "rgb(28 43 54 / 70%)";
    context.textBaseline = "bottom";
    for (let lon = Math.ceil(box.west / step) * step; lon <= box.east; lon += step) {
      const x = projectX(this.viewport, lon);
      context.moveTo(x, 0);
      context.lineTo(x, this.viewport.height);
      if (this.options.interactive) labels.push([formatLongitude(lon), x + 3, this.viewport.height - 3]);
    }
    for (let lat = Math.ceil(box.south / step) * step; lat <= box.north; lat += step) {
      const y = projectY(this.viewport, lat);
      context.moveTo(0, y);
      context.lineTo(this.viewport.width, y);
      if (this.options.interactive) labels.push([formatLatitude(lat), 4, y - 2]);
    }
    context.strokeStyle = "rgb(28 43 54 / 9%)";
    context.lineWidth = 1;
    context.stroke();
    context.lineJoin = "round";
    context.strokeStyle = "rgb(255 255 255 / 75%)";
    context.lineWidth = 2;
    for (const [text, x, y] of labels) {
      context.strokeText(text, x, y);
      context.fillText(text, x, y);
    }
  }

  private drawWind(field: FieldData): void {
    const [u, v] = [field.layerIndex("u"), field.layerIndex("v")];
    const spacing = 34;
    const context = this.context;
    context.beginPath();
    for (let y = spacing / 2; y < this.viewport.height; y += spacing) {
      for (let x = spacing / 2; x < this.viewport.width; x += spacing) {
        const { latitude, longitude } = unproject(this.viewport, x, y);
        if (Math.abs(latitude) > 88) continue;
        const east = field.sample(u, this.layers.week, latitude, longitude, true);
        const north = field.sample(v, this.layers.week, latitude, longitude, true);
        const speed = Math.hypot(east, north);
        if (!(speed > 0.5)) continue;
        const length = Math.min(spacing * 0.8, 5 + speed * 1.4);
        const [dx, dy] = [(east / speed) * length, (-north / speed) * length];
        const [tipX, tipY] = [x + dx / 2, y + dy / 2];
        context.moveTo(x - dx / 2, y - dy / 2);
        context.lineTo(tipX, tipY);
        const angle = Math.atan2(dy, dx);
        context.moveTo(tipX, tipY);
        context.lineTo(tipX - 5 * Math.cos(angle - 0.5), tipY - 5 * Math.sin(angle - 0.5));
        context.moveTo(tipX, tipY);
        context.lineTo(tipX - 5 * Math.cos(angle + 0.5), tipY - 5 * Math.sin(angle + 0.5));
      }
    }
    context.strokeStyle = "rgb(28 43 54 / 70%)";
    context.lineWidth = 1;
    context.stroke();
  }

  private drawSelection(point: MapPoint): void {
    const box = visibleBox(this.viewport);
    const context = this.context;
    for (const shift of [-360, 0, 360]) {
      if (point.longitude + shift < box.west || point.longitude + shift > box.east) continue;
      const x = projectX(this.viewport, point.longitude + shift);
      const y = projectY(this.viewport, point.latitude);
      context.beginPath();
      context.arc(x, y, 7, 0, 2 * Math.PI);
      context.strokeStyle = "#ffffff";
      context.lineWidth = 4;
      context.stroke();
      context.strokeStyle = INK;
      context.lineWidth = 2;
      context.stroke();
    }
  }

  private pointAt(event: PointerEvent | MouseEvent): { point: MapPoint; x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    const [x, y] = [event.clientX - bounds.left, event.clientY - bounds.top];
    const { latitude, longitude } = unproject(this.viewport, x, y);
    return { point: { latitude, longitude: ((longitude % 360) + 360) % 360 }, x, y };
  }

  private bindInteraction(): void {
    const canvas = this.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.setAttribute("aria-label", "Forecast map. Drag to pan, scroll to zoom, click a place for its forecast.");
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragged = 0;
    });
    canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    const release = (event: PointerEvent): void => {
      const wasDown = this.pointers.delete(event.pointerId);
      if (wasDown && event.type === "pointerup" && this.dragged < 5 && this.pointers.size === 0) {
        const { point } = this.pointAt(event);
        if (Math.abs(point.latitude) <= 90) this.options.onSelect?.(point);
      }
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", () => this.options.onHover?.(null, 0, 0));
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const { x, y } = this.pointAt(event);
        this.viewport = zoomAt(this.viewport, x, y, Math.exp(-event.deltaY * 0.0015));
        this.requestRender();
      },
      { passive: false },
    );
    canvas.addEventListener("dblclick", (event) => {
      const { x, y } = this.pointAt(event);
      this.viewport = zoomAt(this.viewport, x, y, 1.8);
      this.requestRender();
    });
    canvas.addEventListener("keydown", (event) => this.onKey(event));
  }

  private onPointerMove(event: PointerEvent): void {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      const { point, x, y } = this.pointAt(event);
      this.options.onHover?.(Math.abs(point.latitude) <= 90 ? point : null, x, y);
      return;
    }
    const [dx, dy] = [event.clientX - previous.x, event.clientY - previous.y];
    if (this.pointers.size === 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        const bounds = this.canvas.getBoundingClientRect();
        const [cx, cy] = [(event.clientX + other.x) / 2 - bounds.left, (event.clientY + other.y) / 2 - bounds.top];
        if (before > 0) this.viewport = zoomAt(this.viewport, cx, cy, after / before);
      }
    } else {
      this.viewport = panBy(this.viewport, dx, dy);
    }
    this.dragged += Math.abs(dx) + Math.abs(dy);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.options.onHover?.(null, 0, 0);
    this.requestRender();
  }

  private onKey(event: KeyboardEvent): void {
    const pans: Record<string, [number, number]> = {
      ArrowLeft: [60, 0],
      ArrowRight: [-60, 0],
      ArrowUp: [0, 60],
      ArrowDown: [0, -60],
    };
    if (event.key in pans) this.viewport = panBy(this.viewport, ...pans[event.key]);
    else if (event.key === "+" || event.key === "=") this.zoom(1.4);
    else if (event.key === "-") this.zoom(1 / 1.4);
    else if (event.key === "0") this.resetView();
    else if (event.key === "Enter") {
      this.options.onSelect?.({ latitude: this.viewport.lat, longitude: this.viewport.lon });
    } else return;
    event.preventDefault();
    this.requestRender();
  }
}
