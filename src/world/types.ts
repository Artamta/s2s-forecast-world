// Mirrors the JSON written by world/pipeline. Change both together.

export interface View {
  west: number;
  east: number;
  south: number;
  north: number;
}

export type Tier = "A" | "B" | "C";
export type RegionKind = "group" | "country" | "subnational" | "climate_box";

export interface RegionInfo {
  id: string;
  label: string;
  group: string;
  parent: string | null;
  kind: RegionKind;
  effective_cells: number;
  tier: Tier;
  view: View;
  children: string[];
}

export interface RegionsDocument {
  schema_version: number;
  registry_hash: string;
  default_region: string;
  groups: string[];
  tiers: { A: number; B: number };
  regions: RegionInfo[];
}

export interface FieldRecord {
  path: string;
  dtype: "u8" | "u16le";
  scale: number;
  offset: number;
  missing: number;
  dry?: number;
  shape: number[];
  bytes: number;
  sha256: string;
  layers: string[];
  units: string;
  minimum: number | null;
  maximum: number | null;
}

export interface WeekWindow {
  week: number;
  valid_start: string;
  valid_end: string;
}

export interface IssueManifest {
  schema_version: number;
  generated_at: string;
  source: string;
  issue: string;
  issue_date: string;
  model_state_day: string;
  members: number;
  status: string;
  weeks: WeekWindow[];
  first_day: string;
  lead_days: number;
  climate: null | {
    years: [number, number];
    members_per_year: number;
    left_slot: string;
    right_slot: string;
    right_weight: number;
    probability_type: string;
    mean_departure_60s_60n: Record<Variable, number[]>;
  };
  fields: Record<string, FieldRecord>;
  drivers: string | null;
  registry_hash: string;
}

export interface DriverIndex {
  id: string;
  label: string;
  units: string;
  description: string;
  plume: Plume;
  weekly: number[];
}

export interface DriversDocument {
  first_day: string;
  indices: DriverIndex[];
  hovmoller: { label: string; units: string; band: [number, number]; longitude: number[]; values: number[][] };
}

export interface CatalogIssue {
  id: string;
  issue_date: string;
  members: number;
  valid_through: string;
  has_climate: boolean;
  manifest: string;
  manifest_sha256: string;
}

export interface Catalog {
  schema_version: number;
  current: { source: string; issue: string };
  sources: Array<{ id: string; label: string; issues: CatalogIssue[] }>;
}

export interface BinLegend {
  boundaries: number[];
  colors: string[];
  under: string;
  over: string;
}

export type Category = "below" | "near" | "above";

export interface TercileLegend {
  steps: number[];
  below: string[];
  above: string[];
  near: string;
  none: string;
  below_label: string;
  above_label: string;
  near_label: string;
  bar: Record<Category, string>;
}

export type Variable = "rain" | "t2m";

interface ProductBase {
  id: string;
  variable: Variable | "wind" | "sst" | "olr";
  label: string;
  short_label: string;
  description: string;
  group: string;
  field: string;
  units: string;
}

export interface FieldProduct extends ProductBase {
  kind: "field";
  layer: string;
  legend?: BinLegend;
  legend_of?: string;
}

export interface TercileProduct extends ProductBase {
  kind: "tercile";
  legend: TercileLegend;
}

export interface WindProduct extends ProductBase {
  kind: "wind";
  legend: BinLegend;
}

export type Product = FieldProduct | TercileProduct | WindProduct;

export interface SkillMetric {
  id: string;
  label: string;
  short_label: string;
  description: string;
}

export interface ProductsDocument {
  schema_version: number;
  dry_week_threshold_mm: number;
  products: Product[];
  skill: {
    metrics: SkillMetric[];
    legends: { score: BinLegend; acc: BinLegend };
    truths: Record<string, string>;
    seasons: Record<string, string>;
  };
}

export interface SkillDocument {
  schema_version: number;
  generated_at: string;
  registry_hash: string;
  evaluation_years: [number, number];
  climate_years: [number, number];
  hindcast_members: number;
  initialisation: string;
  seasons: string[];
  cases_per_week: Record<string, number>;
  pairs: string[];
  metrics: string[];
  reference: string;
  fields: Record<string, FieldRecord>;
}

export type RegionScores = Record<string, Array<number | null>>;

export interface RegionSkillDocument {
  id: string;
  pairs: Record<string, Record<string, RegionScores>>;
}

export interface TercileChance {
  below: number;
  near: number;
  above: number;
  dominant: Category | "none";
}

export interface RegionWeekValue {
  mean: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  clim_mean?: number;
  anom?: number;
  clim_q33?: number;
  clim_q67?: number;
  dry?: boolean;
  tercile?: TercileChance | null;
}

export interface RegionWeek extends WeekWindow {
  rain: RegionWeekValue;
  t2m: RegionWeekValue;
}

export interface Plume {
  mean: number[];
  p10: number[];
  p50: number[];
  p90: number[];
  clim?: number[];
}

export interface RegionDocument {
  id: string;
  label: string;
  tier: Tier;
  effective_cells: number;
  weeks: RegionWeek[];
  daily: Record<Variable, Plume>;
}

export interface SummaryCell {
  mean: number;
  anom: number | null;
  dominant: Category | "none" | null;
  chance: number | null;
  dry: boolean;
}

export interface SummaryDocument {
  regions: Record<string, Record<Variable, SummaryCell[]>>;
}

export interface EncodedLines {
  quantum: number;
  coast?: number[][];
  borders?: number[][];
  outline?: number[][];
}

export interface DetailIndex {
  tile_degrees: number;
  tiles: Array<{ path: string; west: number; south: number }>;
}
