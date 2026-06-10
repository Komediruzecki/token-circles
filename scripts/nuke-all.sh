#!/bin/bash
# Nuke ALL data and re-seed (pass --no-seed to skip re-seeding)
cd "$(dirname "$0")/backend" || exit 1
node scripts/nuke-all.js "$@"
