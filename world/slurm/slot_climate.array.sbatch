#!/bin/bash
# Model climate of one hindcast calendar slot per array task (0-103).
# Optional: REGIONS_ONLY=1 after adding regions.
#SBATCH --job-name=world-climate
#SBATCH --partition=gpu
#SBATCH --exclude=cn2,cn3,cn4,cn15,cn16,cn17
#SBATCH --output=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/logs/%x_%A_%a.out
#SBATCH --cpus-per-task=2
#SBATCH --mem=16G
#SBATCH --time=01:00:00
#SBATCH --array=0-103%20

set -euo pipefail
source "${WORLD_REPO:-/home/raj.ayush/s2s/fuxi-s2s-dashboard-dev}/world/slurm/env.sh"
"${PYTHON}" -u world/pipeline/build_slot_climate.py \
  --task-index "${SLURM_ARRAY_TASK_ID}" ${REGIONS_ONLY:+--regions-only}
