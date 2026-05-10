#!/bin/bash
# Nuke demo profiles only (IDs 1, 2, 3) and re-seed
cd "$(dirname "$0")/backend" || exit 1
node scripts/nuke-demo.js
