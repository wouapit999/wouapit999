#!/usr/bin/env bash
# Launch Wouapit-Androman without installing anything.
#   ./run.sh            -> opens the graphical app
#   ./run.sh transfer   -> switch the connected phone to File Transfer (MTP)
#   ./run.sh status     -> show the current USB mode
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
exec "$PY" -m wouapit_androman "$@"
