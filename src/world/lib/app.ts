import { Geography } from "../map/geography";
import type {
  BinLegend,
  Catalog,
  CatalogIssue,
  IssueManifest,
  Product,
  ProductsDocument,
  RegionInfo,
  RegionsDocument,
  SkillDocument,
  SummaryDocument,
  TercileLegend,
  TercileProduct,
  Variable,
} from "../types";
import { DATA_ROOT, GRID_COLS, GRID_ROWS, gridCell, loadJson } from "./data";

const NO_COUNTRY = 65535;
const LAND_FULL_PERCENT = 15;

/** Everything that does not depend on the issue being viewed. */
export interface App {
  catalog: Catalog;
  regions: RegionsDocument;
  regionById: Map<string, RegionInfo>;
  products: ProductsDocument;
  geography: Geography;
  cellCountry: Uint16Array;
  /** 1 where a grid cell holds a fair share of land, falling to 0 over open sea. */
  land: Float32Array;
  skill: SkillDocument | null;
}

export const SKILL_ROOT = `${DATA_ROOT}skill/`;

/** Season of a start date, as the skill files name it. */
export function seasonOf(isoDay: string): string {
  const month = Number(isoDay.slice(5, 7));
  if (month === 12 || month <= 2) return "djf";
  if (month <= 5) return "mam";
  return month <= 8 ? "jja" : "son";
}

export interface Issue {
  manifest: IssueManifest;
  base: string;
  summary: SummaryDocument;
}

export async function loadApp(): Promise<App> {
  const geography = new Geography();
  const [catalog, regions, products, countryBuffer, landBuffer, skill] = await Promise.all([
    loadJson<Catalog>(`${DATA_ROOT}catalog.json`, true),
    loadJson<RegionsDocument>(`${DATA_ROOT}regions.json`, true),
    loadJson<ProductsDocument>(`${DATA_ROOT}products.json`, true),
    fetch(`${DATA_ROOT}cell-country.bin`, { cache: "no-store" }).then((response) => response.arrayBuffer()),
    fetch(`${DATA_ROOT}land-fraction.bin`, { cache: "no-store" }).then((response) => response.arrayBuffer()),
    loadJson<SkillDocument>(`${SKILL_ROOT}skill.json`, true).catch(() => null),
    geography.load(),
  ]);
  const cellCountry = new Uint16Array(countryBuffer);
  if (cellCountry.length !== GRID_ROWS * GRID_COLS) throw new Error("cell-country.bin has an unexpected size");
  const regionById = new Map(regions.regions.map((region) => [region.id, region]));
  const usable = skill && skill.registry_hash === regions.registry_hash ? skill : null;
  const land = Float32Array.from(new Uint8Array(landBuffer), (percent) => Math.min(1, percent / LAND_FULL_PERCENT));
  if (land.length !== GRID_ROWS * GRID_COLS) throw new Error("land-fraction.bin has an unexpected size");
  return { catalog, regions, regionById, products, geography, cellCountry, land, skill: usable };
}

export function findIssue(catalog: Catalog, source: string | null, issue: string | null): { source: string; entry: CatalogIssue } {
  const chosen = catalog.sources.find((item) => item.id === source) ??
    catalog.sources.find((item) => item.id === catalog.current.source) ?? catalog.sources[0];
  const entry = chosen.issues.find((item) => item.id === issue) ?? chosen.issues[0];
  return { source: chosen.id, entry };
}

export async function loadIssue(entry: CatalogIssue): Promise<Issue> {
  const url = `${DATA_ROOT}${entry.manifest}?v=${entry.manifest_sha256.slice(0, 12)}`;
  const manifest = await loadJson<IssueManifest>(url);
  const base = `${DATA_ROOT}issues/${manifest.source}/${manifest.issue}/`;
  const summary = await loadJson<SummaryDocument>(`${base}regions/summary.json?v=${entry.manifest_sha256.slice(0, 12)}`);
  return { manifest, base, summary };
}

/** Products whose field this issue carries, in catalogue order. */
export function availableProducts(app: App, manifest: IssueManifest): Product[] {
  return app.products.products.filter((product) => product.field in manifest.fields);
}

export function legendFor(app: App, product: Product): BinLegend | TercileLegend {
  if (product.kind === "field" && product.legend_of) {
    const owner = app.products.products.find((item) => item.id === product.legend_of);
    if (owner?.kind === "field" && owner.legend) return owner.legend;
  }
  if (!("legend" in product) || !product.legend) throw new Error(`product ${product.id} has no legend`);
  return product.legend;
}

export function tercileLegendOf(app: App, variable: Variable): TercileLegend {
  const product = app.products.products.find(
    (item): item is TercileProduct => item.kind === "tercile" && item.variable === variable,
  );
  if (!product) throw new Error(`no outlook product for ${variable}`);
  return product.legend;
}

/** The country that covers most of the grid cell at a position, if any. */
export function countryAt(app: App, latitude: number, longitude: number): RegionInfo | null {
  const { row, col } = gridCell(latitude, longitude);
  const index = app.cellCountry[row * GRID_COLS + col];
  return index === NO_COUNTRY ? null : app.regions.regions[index] ?? null;
}

/** Share of land around a position, blended between neighbouring cells: 1 on land, 0 at sea. */
export function landShare(app: App, latitude: number, longitude: number): number {
  const rowF = Math.min(GRID_ROWS - 1, Math.max(0, (90 - latitude) / 1.5));
  const colF = (((longitude % 360) + 360) % 360) / 1.5;
  const row0 = Math.floor(rowF);
  const row1 = Math.min(GRID_ROWS - 1, row0 + 1);
  const col0 = Math.floor(colF) % GRID_COLS;
  const col1 = (col0 + 1) % GRID_COLS;
  const [fy, fx] = [rowF - row0, colF - Math.floor(colF)];
  const at = (row: number, col: number): number => app.land[row * GRID_COLS + col];
  return (at(row0, col0) * (1 - fx) + at(row0, col1) * fx) * (1 - fy) + (at(row1, col0) * (1 - fx) + at(row1, col1) * fx) * fy;
}

/** A region's ancestors from the world down to its parent. */
export function ancestors(app: App, region: RegionInfo): RegionInfo[] {
  const chain: RegionInfo[] = [];
  let parent = region.parent ? app.regionById.get(region.parent) : undefined;
  while (parent) {
    chain.unshift(parent);
    parent = parent.parent ? app.regionById.get(parent.parent) : undefined;
  }
  return chain;
}

export function tierNote(region: RegionInfo): string | null {
  const cells = region.effective_cells < 10 ? region.effective_cells.toFixed(1) : Math.round(region.effective_cells);
  if (region.tier === "C") {
    return `Smaller than two grid cells (${cells}). Treat the numbers as nearest-cell guidance, not a regional forecast.`;
  }
  if (region.tier === "B") return `Coarse: about ${cells} grid cells of 1.5° cover this region.`;
  return null;
}
