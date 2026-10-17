# Upstream design systems

Source: https://github.com/ruiqichenbiec/design-systems

Pinned commit: `7a424c93b9be13cf835b91ea67495fec2ec0584e`.

Copyright (c) 2026 DayDreamInAReverie. MIT license: see LICENSE.
Three.js copyright and MIT license: lattice/THREE-LICENSE.txt.

The Lens portable package, Lattice source modules and both standalone showcases
are copied directly from upstream. manifest.json records the upstream Git blob IDs.
Tide lifecycle, layout and player bindings live outside this directory in
native-shell.js / native-shell.css. The build scopes original CSS to each preset.

The original showcases are bundled as interactive, sandboxed reference pages.
They have no Electron preload bridge. Upstream is provided as-is and unmaintained.
