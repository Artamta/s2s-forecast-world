# World outlook

A second page of this site (`world.html`) that shows the same model run for any
region of the world. One global run per issue is reduced to a compact store;
every region is a mask over it, defined in `world/config/regions.json`.

Nothing here is wired into the automated publisher. `public/data/world/` is
git-ignored and all private outputs live under
`/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/`
(`compact/`, `climate_v1/`, `skill_v1/`, `static/`, `logs/`, `screenshots/`).

## Run it

All computation goes through Slurm; create nothing on the login node.

```bash
# one issue, end to end (GPU run from the saved operational input, reduce, export, build check)
world/slurm/submit_issue.sh ifs 20261007

# pieces
sbatch world/slurm/geo_weights.sbatch                      # after editing regions.json
sbatch --export=ALL,REGIONS_ONLY=1 world/slurm/slot_climate.array.sbatch   # then region climate
sbatch --export=ALL,ISSUE=20261007,SOURCE=ifs world/slurm/export_issue.sbatch
sbatch world/slurm/hindcast_scores.array.sbatch && sbatch world/slurm/export_skill.sbatch
sbatch world/slurm/circ_climate.array.sbatch               # once: wind, OLR, SST climate (heavy I/O)
sbatch --export=ALL,CHECKS="reduction climate india alignment skill" world/slurm/crosscheck.sbatch
sbatch world/slurm/tests.sbatch                            # tests/world
sbatch world/slurm/site_check.sbatch                       # tsc, vite build, validate, screenshots
```

To look at the page: build, then
`python world/pipeline/serve_site.py --root dist --port 4173` and open
`http://127.0.0.1:4173/world.html`.

## Publishing

The public copy is the repository `Artamta/s2s-forecast-world`, served by GitHub
Pages at https://artamta.github.io/s2s-forecast-world/. To update it after a
new export:

```bash
world/publish/export_repo.sh /home/raj.ayush/s2s/s2s-forecast-world   # copies files only
cd /home/raj.ayush/s2s/s2s-forecast-world
git add -A && git commit -m "Publish IFS issue YYYYMMDD" && git push   # the push deploys
```

Country shapes and borders come from Natural Earth's India-view edition
(`admin0_countries` in `world/config/paths.json`); only lines India treats as
international boundaries are drawn.

## Adding a region

Add an entry to `world/config/regions.json` (a Natural Earth country code with
an optional clip box, a list of admin-1 units, or a lon/lat box), then run
`geo_weights`, the region climate array with `REGIONS_ONLY=1`, and the export.
If skill is published, rerun the skill array too: its sums are tied to the
registry hash. No GPU run is needed.

## Conventions that are easy to get wrong

- Issue D starts from the model state of D-1; lead day 1 is D. The hindcast
  `init` is the model-state day, so the matching climate slot is MMDD of D-1 and
  hindcast lead day k verifies on `init + k` (`world/timing.py`).
- Rainfall is `clip(tp, 0) * 24` mm/day, summed to weekly totals in mm.
  Temperature is the weekly mean in °C.
- Terciles pool all 51 members of all hindcast years at a slot (1020 samples),
  not 20 yearly ensemble means as the India page does.
- Skill uses 2017–2021 starts only, with normals and terciles from 2002–2016.
- Region ids for areas are longer than three letters so they cannot collide
  with a country code (`nam` is Namibia).

## Layout

- `grid.py timing.py weights.py regions.py climate.py probability.py scores.py quantize.py` — pure functions.
- `pipeline/` — one script per step; `slurm/` — one launcher per script.
- `src/world/` — the page; `tests/world/` — unit tests.
