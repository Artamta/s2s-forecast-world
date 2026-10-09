#!/bin/bash
# Queue one issue end to end: global GPU run -> reduce -> export -> build check.
# Usage: world/slurm/submit_issue.sh <source> <YYYYMMDD>
# For a run whose raw members already exist, pass RAW_DIR=... to skip the GPU step.
set -euo pipefail
SOURCE=${1:?source: ifs, gfs or era5}
ISSUE=${2:?issue date YYYYMMDD}
HERE=$(cd "$(dirname "$0")" && pwd)
WORLD_ROOT=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1
mkdir -p "${WORLD_ROOT}/logs"

AFTER=""
if [[ -z "${RAW_DIR:-}" ]]; then
  RAW_DIR=${WORLD_ROOT}/raw/${SOURCE}/${ISSUE}
  GPU=$(sbatch --parsable --export=ALL,ISSUE="${ISSUE}",SOURCE="${SOURCE}" "${HERE}/gpu_global_inference.sbatch")
  AFTER="--dependency=afterok:${GPU}"
  echo "gpu run: ${GPU}"
fi
REDUCE=$(sbatch --parsable ${AFTER} \
  --export=ALL,RAW_DIR="${RAW_DIR}",ISSUE="${ISSUE}",SOURCE="${SOURCE}",DELETE_RAW="${DELETE_RAW:-1}" \
  "${HERE}/reduce_raw.sbatch")
EXPORT=$(sbatch --parsable --dependency=afterok:"${REDUCE}" \
  --export=ALL,ISSUE="${ISSUE}",SOURCE="${SOURCE}" "${HERE}/export_issue.sbatch")
CHECK=$(sbatch --parsable --dependency=afterok:"${EXPORT}" "${HERE}/site_check.sbatch")
echo "reduce: ${REDUCE}  export: ${EXPORT}  build check: ${CHECK}"
