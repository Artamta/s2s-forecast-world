#!/bin/bash
# Region weights and static map geography. Rerun after editing world/config/regions.json.
#SBATCH --job-name=world-geo
#SBATCH --partition=gpu
#SBATCH --exclude=cn2,cn3,cn4,cn15,cn16,cn17
#SBATCH --output=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/logs/%x_%j.out
#SBATCH --cpus-per-task=2
#SBATCH --mem=8G
#SBATCH --time=01:00:00

set -euo pipefail
source "${WORLD_REPO:-/home/raj.ayush/s2s/fuxi-s2s-dashboard-dev}/world/slurm/env.sh"
"${PYTHON}" -u world/pipeline/build_region_weights.py
"${PYTHON}" -u world/pipeline/build_geography.py
