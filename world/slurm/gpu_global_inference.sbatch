#!/bin/bash
# One global 100-member FuXi-S2S run from a saved operational input.
# Required: ISSUE (YYYYMMDD), SOURCE. Raw members go to the world raw folder.
#SBATCH --job-name=world-gpu
#SBATCH --partition=GPU-AI_prio
#SBATCH --exclude=gpu2
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G
#SBATCH --time=03:00:00
#SBATCH --output=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/logs/%x_%j.out

set -euo pipefail
: "${ISSUE:?}" "${SOURCE:?}"

MODEL_ROOT=/home/raj.ayush/s2s/s2s_anlysis/analysis-code/data-download/fuxi_s2s/FuXi-S2S
OPERATIONAL=/storage/raj.ayush/s2s_final_data/final_iteration/model-runs/fuxi/operational
INPUT=${OPERATIONAL}/${SOURCE}/${ISSUE}/ens100/inputs/annual${ISSUE:0:4}/${ISSUE}/input.nc
RAW_DIR=/storage/raj.ayush/s2s_final_data/final_iteration/world_dashboard_v1/raw/${SOURCE}/${ISSUE}
FUXI_ENV=/home/raj.ayush/.conda/envs/fuxi_s2s
MEMBERS=100
LEADS=42

test -f "${INPUT}"
test -f "${MODEL_ROOT}/model/fuxi_s2s.onnx"
mkdir -p "${RAW_DIR}"
export LD_LIBRARY_PATH=${FUXI_ENV}/lib:${FUXI_ENV}/lib/python3.10/site-packages/nvidia/cublas/lib:${LD_LIBRARY_PATH:-}
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1
export KMP_AFFINITY=disabled

echo "source=${SOURCE} issue=${ISSUE} host=$(hostname) start=$(date --iso-8601=seconds)"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
cd "${MODEL_ROOT}"
# The official script exits 255 after a complete run; the file count is the check.
set +e
"${FUXI_ENV}/bin/python" -u inference.py \
  --model model/fuxi_s2s.onnx --input "${INPUT}" --device cuda \
  --total_step "${LEADS}" --total_member "${MEMBERS}" --save_dir "${RAW_DIR}"
STATUS=$?
set -e
if [[ "${STATUS}" -ne 0 && "${STATUS}" -ne 255 ]]; then
  exit "${STATUS}"
fi
COUNT=$(find "${RAW_DIR}/member" -mindepth 2 -maxdepth 2 -type f -name '*.nc' | wc -l)
echo "raw files=${COUNT} end=$(date --iso-8601=seconds)"
test "${COUNT}" -eq $((MEMBERS * LEADS))
