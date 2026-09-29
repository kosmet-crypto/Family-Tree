#!/usr/bin/env bash
# Downloads the PostgREST binary used by the integration tests into .bin/
set -euo pipefail
VERSION="${POSTGREST_VERSION:-v12.2.3}"
cd "$(dirname "$0")/.."
mkdir -p .bin
if [ ! -x .bin/postgrest ]; then
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/${VERSION}/postgrest-${VERSION}-linux-static-x64.tar.xz" \
    | tar -xJ -C .bin
fi
.bin/postgrest --version
