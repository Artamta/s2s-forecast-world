# World subseasonal outlook

An experimental six-week rainfall and temperature outlook for any region of
the world, with a focus on Southeast and East Asia.

**Live page:** https://artamta.github.io/s2s-forecast-world/

One global 100-member ensemble run per issue is reduced to a compact store.
Every region (279 of them: all countries, plus island groups and sub-regions
for Indonesia, the Philippines, Malaysia, Vietnam, Thailand, China, Japan and
Australia) is a mask over the same global fields, defined in
`world/config/regions.json`.

## What is in this repository

- `index.html`, `src/world/` — the static page (Vite + TypeScript, no runtime dependencies).
- `public/data/world/` — the published data: one issue and the region list.
- `public/geo/world/` — coastlines, borders and region outlines (Natural Earth, India-view edition).
- `world/` — the pipeline that produces the data (`world/README.md` explains each step).
- `science/` — shared formulas used by the pipeline.
- `tests/world/` — unit tests.

The pipeline runs on a compute cluster next to the model output; the cluster
paths in `world/config/paths.json` and `world/slurm/` are specific to that
machine. The data it writes into `public/data/world/` is committed here so the
page can be served as static files.

## Build

```bash
npm ci
npm run build        # type-check and build into dist/
npm run preview      # serve dist/ locally
python -m pip install numpy shapely pyshp pytest
npm test             # tests/world
```

Pushing to `main` builds and deploys the page with GitHub Pages
(`.github/workflows/deploy-pages.yml`).

## Reading the page

- Maps show the ensemble-mean weekly total or mean, and its anomaly: the
  departure from the model's own normal for the time of year.
- Value maps (anomalies, totals, wind speed) carry contour lines at the
  legend's steps. The Play button steps through the six weeks.
- The model grid is 1.5° (about 165 km). Small islands and countries span only
  a few cells; the page flags those regions.
- The About tab lists the known limits.
