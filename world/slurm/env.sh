# Shared settings for the world pipeline jobs. Sourced by every sbatch script.
WORLD_REPO=${WORLD_REPO:-/home/raj.ayush/s2s/s2s-forecast-world}
WORLD_ROOT=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1
PYTHON=/home/raj.ayush/.conda/envs/s2s-hind/bin/python
TASK_CACHE=/tmp/world_${SLURM_JOB_ID:-local}_${SLURM_ARRAY_TASK_ID:-0}
mkdir -p "${TASK_CACHE}/xdg" "${TASK_CACHE}/mpl"
trap 'rm -rf -- "${TASK_CACHE:?}"' EXIT
export XDG_CACHE_HOME=${TASK_CACHE}/xdg
export MPLCONFIGDIR=${TASK_CACHE}/mpl
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1
export PYTHONDONTWRITEBYTECODE=1
cd "${WORLD_REPO}"
echo "job=${SLURM_JOB_NAME:-} id=${SLURM_JOB_ID:-} host=$(hostname) start=$(date --iso-8601=seconds)"
