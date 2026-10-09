#!/bin/bash
# Reduce one run's raw members to the compact store.
# Required: RAW_DIR, ISSUE (YYYYMMDD), SOURCE. Optional: DELETE_RAW=1.
#SBATCH --job-name=world-reduce
#SBATCH --partition=gpu
#SBATCH --exclude=cn2,cn3,cn4,cn15,cn16,cn17
#SBATCH --output=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/logs/%x_%j.out
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=02:00:00

set -euo pipefail
source "${WORLD_REPO:-/home/raj.ayush/s2s/fuxi-s2s-dashboard-dev}/world/slurm/env.sh"
: "${RAW_DIR:?}" "${ISSUE:?}" "${SOURCE:?}"
"${PYTHON}" -u world/pipeline/reduce_raw_members.py \
  --raw-dir "${RAW_DIR}" --issue "${ISSUE}" --source "${SOURCE}" \
  --workers "${SLURM_CPUS_PER_TASK}" ${DELETE_RAW:+--delete-raw}
