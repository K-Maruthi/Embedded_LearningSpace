#!/bin/sh
# POSIX twin of build.js. It used to concatenate without refreshing src/index.html,
# which silently shipped the app against the previous copy — and now would also
# leave stale fonts in src/fonts/. Delegating keeps exactly one build path.
set -e
node "$(dirname "$0")/build.js" "$@"
