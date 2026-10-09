#!/bin/bash
# Cross-checks against existing products. Required: CHECKS, e.g. "reduction climate".
#SBATCH --job-name=world-xcheck
#SBATCH --partition=gpu
#SBATCH --exclude=cn2,cn3,cn4,cn15,cn16,cn17
#SBATCH --output=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/logs/%x_%j.out
#SBATCH --cpus-per-task=2
#SBATCH --mem=24G
#SBATCH --time=00:30:00

set -uo pipefail
source "${WORLD_REPO:-/home/raj.ayush/s2s/s2s-forecast-world}/world/slurm/env.sh"
STATUS=0
for CHECK in ${CHECKS:?}; do
  "${PYTHON}" -u world/pipeline/crosscheck.py "${CHECK}" --source "${SOURCE:-ifs}" --issue "${ISSUE:-20261007}" || STATUS=1
done
exit "${STATUS}"
