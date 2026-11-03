#!/usr/bin/env bash
# Pull the latest code, prove it with the selftest, and restart the server.
# Run from the clone as the normal user:  ./deploy/pi/update.sh
#
# The key page reconnects by itself within a few seconds of the restart.
# Data lives in /var/lib/prodmesh-paging, so PINs and the log are kept.

set -euo pipefail
cd "$(dirname "$0")/../.."

git pull --ff-only
node server/index.js --selftest
sudo systemctl restart prodmesh-paging
echo "Updated to $(git log -1 --format='%h %s')"
