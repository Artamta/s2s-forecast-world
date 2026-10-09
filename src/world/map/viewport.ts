import type { View } from "../types";

/** Equirectangular window: a centre, a scale and a fixed east-west squeeze. */
export interface Viewport {
  lon: number;
  lat: number;
  scale: number;
  aspect: number;
  width: number;
  height: number;
}

const MAX_SCALE = 90;
const WHOLE_WORLD_SPAN = 300;
const WORLD_MARGIN = 4;

export function minScale(width: number, aspect: number): number {
  return width / (360 * aspect);
}

/** Fit a region's view box into a canvas, squeezing longitude by cos(latitude). */
export function fitView(view: View, width: number, height: number, padding = 12): Viewport {
  const lat = (view.north + view.south) / 2;
  const aspect = Math.cos((Math.min(65, Math.abs(lat)) * Math.PI) / 180);
  const spanLon = Math.min(360, view.east - view.west);
  const spanLat = view.north - view.south;
  if (spanLon >= WHOLE_WORLD_SPAN) {
    // A whole-world view fills the frame: choose the east-west squeeze that fits both ways.
    const scale = height / Math.min(180, spanLat + 2 * WORLD_MARGIN);
    const squeeze = Math.min(1, Math.max(0.55, width / (spanLon * scale)));
    return clampViewport({ lon: (view.east + view.west) / 2, lat, scale, aspect: squeeze, width, height });
  }
  const scale = Math.min(
    (width - 2 * padding) / (spanLon * aspect),
    (height - 2 * padding) / spanLat,
  );
  return clampViewport({ lon: (view.east + view.west) / 2, lat, scale, aspect, width, height });
}

export function clampViewport(viewport: Viewport): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(minScale(viewport.width, viewport.aspect), viewport.scale));
  const halfLat = viewport.height / (2 * scale);
  const lat = halfLat >= 90 ? 0 : Math.min(90 - halfLat, Math.max(-90 + halfLat, viewport.lat));
  const lon = ((viewport.lon % 360) + 360) % 360;
  return { ...viewport, scale, lat, lon };
}

export function projectX(viewport: Viewport, longitude: number): number {
  return viewport.width / 2 + (longitude - viewport.lon) * viewport.scale * viewport.aspect;
}

export function projectY(viewport: Viewport, latitude: number): number {
  return viewport.height / 2 - (latitude - viewport.lat) * viewport.scale;
}

export function unproject(viewport: Viewport, x: number, y: number): { longitude: number; latitude: number } {
  return {
    longitude: viewport.lon + (x - viewport.width / 2) / (viewport.scale * viewport.aspect),
    latitude: viewport.lat - (y - viewport.height / 2) / viewport.scale,
  };
}

/** Visible longitude and latitude limits; longitudes are not wrapped. */
export function visibleBox(viewport: Viewport): View {
  const halfLon = viewport.width / (2 * viewport.scale * viewport.aspect);
  const halfLat = viewport.height / (2 * viewport.scale);
  return {
    west: viewport.lon - halfLon,
    east: viewport.lon + halfLon,
    south: Math.max(-90, viewport.lat - halfLat),
    north: Math.min(90, viewport.lat + halfLat),
  };
}

/** Whole-turn shifts that bring a longitude range into the visible window. */
export function visibleShifts(viewport: Viewport, west: number, east: number): number[] {
  const box = visibleBox(viewport);
  const shifts: number[] = [];
  for (let turn = -2; turn <= 2; turn += 1) {
    if (east + 360 * turn >= box.west && west + 360 * turn <= box.east) shifts.push(360 * turn);
  }
  return shifts;
}

export function zoomAt(viewport: Viewport, x: number, y: number, factor: number): Viewport {
  const anchor = unproject(viewport, x, y);
  const zoomed = clampViewport({ ...viewport, scale: viewport.scale * factor });
  const moved = unproject(zoomed, x, y);
  return clampViewport({
    ...zoomed,
    lon: zoomed.lon + anchor.longitude - moved.longitude,
    lat: zoomed.lat + anchor.latitude - moved.latitude,
  });
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return clampViewport({
    ...viewport,
    lon: viewport.lon - dx / (viewport.scale * viewport.aspect),
    lat: viewport.lat + dy / viewport.scale,
  });
}
