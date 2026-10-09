import type { FieldRecord } from "../types";

export const DATA_ROOT = "./data/world/";
export const GEO_ROOT = "./geo/world/";
export const GRID_ROWS = 121;
export const GRID_COLS = 240;
export const GRID_SPACING = 1.5;

const jsonCache = new Map<string, Promise<unknown>>();

export function loadJson<T>(url: string, fresh = false): Promise<T> {
  if (fresh) return fetchJson<T>(url, "no-store");
  if (!jsonCache.has(url)) jsonCache.set(url, fetchJson<T>(url, "default"));
  return jsonCache.get(url) as Promise<T>;
}

/** The preview build publishes each folder of per-id JSON files as one bundle. */
const BUNDLED = document.getElementById("app")?.dataset.bundled === "true";
const bundles = new Map<string, Promise<Record<string, unknown>>>();

/** Load one JSON document from a folder of per-id files, or from that folder's bundle. */
export async function loadMember<T>(folderUrl: string, id: string, version = ""): Promise<T> {
  const suffix = version ? `?v=${encodeURIComponent(version)}` : "";
  if (!BUNDLED) return loadJson<T>(`${folderUrl}${id}.json${suffix}`);
  if (!bundles.has(folderUrl)) {
    bundles.set(folderUrl, loadJson<Record<string, unknown>>(`${folderUrl}_bundle.json`));
  }
  const item = (await (bundles.get(folderUrl) as Promise<Record<string, unknown>>))[id];
  if (item === undefined) throw new Error(`${folderUrl} has no ${id}`);
  return item as T;
}

/** Load a binary file; the preview build ships each one as base64 text beside its name. */
export async function loadBinary(url: string, version = ""): Promise<ArrayBuffer> {
  const suffix = version ? `?v=${encodeURIComponent(version)}` : "";
  if (!BUNDLED) {
    const response = await fetch(`${url}${suffix}`, version ? undefined : { cache: "no-store" });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.arrayBuffer();
  }
  const { base64 } = await loadJson<{ base64: string }>(`${url}.json`);
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes.buffer;
}

async function fetchJson<T>(url: string, cache: RequestCache): Promise<T> {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface Sample {
  value: number;
  dry: boolean;
}

/** One public field: layers x weeks x 121 x 240 fixed-point values. */
export class FieldData {
  readonly layers: number;
  readonly weeks: number;
  private readonly stored: Uint8Array | Uint16Array;

  constructor(readonly record: FieldRecord, buffer: ArrayBuffer) {
    [this.layers, this.weeks] = record.shape;
    this.stored = record.dtype === "u8" ? new Uint8Array(buffer) : new Uint16Array(buffer);
    if (this.stored.length !== this.layers * this.weeks * GRID_ROWS * GRID_COLS) {
      throw new Error(`${record.path} has an unexpected size`);
    }
  }

  layerIndex(name: string): number {
    const index = this.record.layers.indexOf(name);
    if (index < 0) throw new Error(`${this.record.path} has no layer ${name}`);
    return index;
  }

  private code(layer: number, week: number, row: number, col: number): number {
    return this.stored[((layer * this.weeks + week) * GRID_ROWS + row) * GRID_COLS + col];
  }

  /** Value at a grid cell; NaN when missing or flagged dry. */
  cell(layer: number, week: number, row: number, col: number): number {
    const code = this.code(layer, week, row, col);
    if (code === this.record.missing || code === this.record.dry) return Number.NaN;
    return code * this.record.scale + this.record.offset;
  }

  isDry(layer: number, week: number, row: number, col: number): boolean {
    return this.record.dry !== undefined && this.code(layer, week, row, col) === this.record.dry;
  }

  /** Bilinear value at a position; falls back to the nearest cell beside gaps. */
  sample(layer: number, week: number, latitude: number, longitude: number, smooth: boolean): number {
    const rowF = (90 - latitude) / GRID_SPACING;
    const colF = (((longitude % 360) + 360) % 360) / GRID_SPACING;
    const nearRow = Math.min(GRID_ROWS - 1, Math.max(0, Math.round(rowF)));
    const nearCol = Math.round(colF) % GRID_COLS;
    if (!smooth) return this.cell(layer, week, nearRow, nearCol);
    const row0 = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(rowF)));
    const row1 = Math.min(GRID_ROWS - 1, row0 + 1);
    const col0 = Math.floor(colF) % GRID_COLS;
    const col1 = (col0 + 1) % GRID_COLS;
    const fy = Math.min(1, Math.max(0, rowF - row0));
    const fx = colF - Math.floor(colF);
    const a = this.cell(layer, week, row0, col0);
    const b = this.cell(layer, week, row0, col1);
    const c = this.cell(layer, week, row1, col0);
    const d = this.cell(layer, week, row1, col1);
    if (Number.isNaN(a + b + c + d)) return this.cell(layer, week, nearRow, nearCol);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}

const fieldCache = new Map<string, Promise<FieldData>>();

export function loadField(issueBase: string, record: FieldRecord): Promise<FieldData> {
  const url = `${issueBase}${record.path}`;
  if (!fieldCache.has(url)) fieldCache.set(url, fetchField(url, record));
  return fieldCache.get(url) as Promise<FieldData>;
}

async function fetchField(url: string, record: FieldRecord): Promise<FieldData> {
  const buffer = await loadBinary(url, record.sha256.slice(0, 12));
  if (buffer.byteLength !== record.bytes) throw new Error(`${record.path}: wrong size`);
  const digest = await sha256Hex(buffer);
  if (digest !== null && digest !== record.sha256) throw new Error(`${record.path}: checksum mismatch`);
  return new FieldData(record, buffer);
}

export function gridCell(latitude: number, longitude: number): { row: number; col: number } {
  const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.round((90 - latitude) / GRID_SPACING)));
  const col = Math.round((((longitude % 360) + 360) % 360) / GRID_SPACING) % GRID_COLS;
  return { row, col };
}

export function cellCentre(row: number, col: number): { latitude: number; longitude: number } {
  return { latitude: 90 - row * GRID_SPACING, longitude: col * GRID_SPACING };
}
