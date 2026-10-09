#!/bin/bash
# Export one issue's public world package. Required: ISSUE (YYYYMMDD), SOURCE.
# Optional: NO_CLIMATE=1 to publish absolute fields only.
#SBATCH --job-name=world-export
#SBATCH --partition=gpu
#SBATCH --exclude=cn2,cn3,cn4,cn15,cn16,cn17
#SBATCH --output=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/logs/%x_%j.out
#SBATCH --cpus-per-task=2
#SBATCH --mem=24G
#SBATCH --time=00:40:00

set -euo pipefail
source "${WORLD_REPO:-/home/raj.ayush/s2s/fuxi-s2s-dashboard-dev}/world/slurm/env.sh"
: "${ISSUE:?}" "${SOURCE:?}"
"${PYTHON}" -u world/pipeline/export_issue.py --issue "${ISSUE}" --source "${SOURCE}" ${NO_CLIMATE:+--no-climate}
