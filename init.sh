#!/usr/bin/env bash
set -euo pipefail

echo "Zerox Agent harness init"
node --version
npm --version
npm run harness:check
npm test -- src/shared/packageScripts.test.ts
