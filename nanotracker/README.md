# nanoTracker Plugin

This directory contains the tracker-native MonkSynth instrument plugin.

Build the archive:

```bash
python3 nanotracker/build_plugin.py
```

That writes `nanotracker/dist/MonkSynth.ntins`.

Load it in nanoTracker:

1. Open `PLG`.
2. Click `+ LOAD PLUGIN (.ntins / .ntsfx)`.
3. Pick `MonkSynth.ntins`.
4. Click `+ ADD TO WS`.
5. Use `INS` to assign the loaded plugin to an instrument slot.

UI notes:

- The default workspace view follows the Delay Lama NT reference panel more closely.
- A hidden classic bitmap mode is bundled from the original Delay Lama assets.
