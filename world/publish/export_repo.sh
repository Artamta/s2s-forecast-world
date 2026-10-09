#!/bin/bash
# Copy the world dashboard into a standalone repository checkout.
# Usage: world/publish/export_repo.sh [target]   (default: ../s2s-forecast-world)
# Only copies files; committing and pushing the target is a separate, deliberate step.
set -euo pipefail
SOURCE=$(cd "$(dirname "$0")/../.." && pwd)
TARGET=${1:-$(dirname "${SOURCE}")/s2s-forecast-world}
TEMPLATE=${SOURCE}/world/publish/template
mkdir -p "${TARGET}"

copy_tree() {  # copy_tree <relative path>: mirror one folder, dropping caches
  mkdir -p "${TARGET}/$1"
  rsync -a --delete --exclude '__pycache__' --exclude '*.pyc' "${SOURCE}/$1/" "${TARGET}/$1/"
}

for TREE in world src/world tests/world public/geo/world public/data/world; do
  copy_tree "${TREE}"
done
mkdir -p "${TARGET}/science" "${TARGET}/public/brand" "${TARGET}/.github/workflows"
cp "${SOURCE}"/science/{__init__,formulas,calendar,zarr_v2}.py "${TARGET}/science/"
cp "${SOURCE}/tests/conftest.py" "${TARGET}/tests/"
cp "${SOURCE}/public/brand/s2s-research-mark.svg" "${TARGET}/public/brand/"
cp "${SOURCE}/world.html" "${TARGET}/index.html"
cp "${SOURCE}/tsconfig.json" "${TARGET}/"
cp "${TEMPLATE}/README.md" "${TEMPLATE}/vite.config.ts" "${TEMPLATE}/package.json" "${TARGET}/"
cp "${TEMPLATE}/gitignore" "${TARGET}/.gitignore"
cp "${TEMPLATE}/.github/workflows/deploy-pages.yml" "${TARGET}/.github/workflows/"
# Same dependency lock as the source repository, under this package's name.
sed -e '1,9s/"name": "[^"]*"/"name": "s2s-forecast-world"/' \
    -e '1,9s/"version": "[^"]*"/"version": "1.0.0"/' \
    "${SOURCE}/package-lock.json" > "${TARGET}/package-lock.json"
echo "exported to ${TARGET}"
