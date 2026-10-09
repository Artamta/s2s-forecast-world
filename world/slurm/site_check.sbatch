#!/bin/bash
# Type-check, build, validate the public world data and take screenshots.
# Optional: SHOTS="name|query|WIDTHxHEIGHT ..." to override the default views.
# Screenshots need a node with GTK libraries (cn8, cn14, cn19 have them; cn12 does not):
# add --nodelist=cn14 when you want them; on other nodes they are skipped.
#SBATCH --job-name=world-site
#SBATCH --partition=gpu
#SBATCH --exclude=cn2,cn3,cn4,cn15,cn16,cn17
#SBATCH --output=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/logs/%x_%j.out
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=00:40:00

set -euo pipefail

main() {
  source "${WORLD_REPO:-/home/raj.ayush/s2s/s2s-forecast-world}/world/slurm/env.sh"
  NODE_BIN=/home/raj.ayush/.local/lib/node-v22.20.0/bin
  export PATH=${NODE_BIN}:${PATH}
  # Compute nodes have no browser; this is a copy of the login node's Firefox.
  FIREFOX=${WORLD_ROOT}/tools/firefox/firefox
  OUT=${WORLD_ROOT}/screenshots/${SLURM_JOB_ID}
  PORT=$((20000 + SLURM_JOB_ID % 20000))
  mkdir -p "${OUT}"

  "${PYTHON}" -u world/pipeline/build_catalog.py
  cp world/config/products.json public/data/world/products.json
  node node_modules/typescript/bin/tsc --noEmit
  node node_modules/vite/bin/vite.js build
  if [[ -f world/pipeline/validate_public.py ]]; then
    "${PYTHON}" -u world/pipeline/validate_public.py
  fi

  "${PYTHON}" -u world/pipeline/pack_preview.py
  "${PYTHON}" world/pipeline/serve_site.py --root dist --port "${PORT}" </dev/null &
  SERVER=$!
  sleep 2

  DEFAULT_SHOTS="seasia|region=seasia&week=3|1500x1000 idn|region=idn&product=rain_anom&week=2|1500x1000
world|region=world&product=t2m_anom&week=3|1500x1000 wind|region=seasia&product=wind850&week=1|1500x1000
regions|region=idn#regions|1500x1300 briefing|region=idn#briefing|1500x800 about|region=idn#about|1500x1000 phone|region=idn&week=3|390x1500"
  for SHOT in ${SHOTS:-${DEFAULT_SHOTS}}; do
    IFS='|' read -r NAME QUERY SIZE <<<"${SHOT}"
    HASH=forecast
    [[ "${QUERY}" == *"#"* ]] && HASH=${QUERY##*#} && QUERY=${QUERY%%#*}
    mkdir -p "${TASK_CACHE}/ff_${NAME}"
    HOME=${TASK_CACHE} timeout 120 "${FIREFOX}" --headless --no-remote --profile "${TASK_CACHE}/ff_${NAME}" \
      --window-size "${SIZE/x/,}" --screenshot "${OUT}/${NAME}.png" \
      "http://127.0.0.1:${PORT}/index.html?snapshot=1&${QUERY}#${HASH}" >"${OUT}/${NAME}.log" 2>&1 </dev/null || echo "screenshot failed: ${NAME}"
  done
  kill "${SERVER}" || true
  echo "screenshots: ${OUT}"
  # ls exits non-zero on this file system even when it lists fine.
  ls "${OUT}" || true
}

main
echo "site check finished"
exit 0
