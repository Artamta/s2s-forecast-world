#!/bin/bash
# World unit tests. Pass extra pytest arguments after the script name.
#SBATCH --job-name=world-tests
#SBATCH --partition=gpu
#SBATCH --exclude=cn2,cn3,cn4,cn15,cn16,cn17
#SBATCH --output=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/logs/%x_%j.out
#SBATCH --cpus-per-task=2
#SBATCH --mem=8G
#SBATCH --time=00:30:00

set -euo pipefail
source "${WORLD_REPO:-/home/raj.ayush/s2s/fuxi-s2s-dashboard-dev}/world/slurm/env.sh"
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 "${PYTHON}" -m pytest -q -p no:cacheprovider "${@:-tests/world}"
