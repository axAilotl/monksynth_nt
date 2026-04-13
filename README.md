# MonkSynth NT

This repo is a fork of [JonET/monksynth](https://github.com/JonET/monksynth) adapted to run as a native instrument plugin for [nanoTracker](https://federatedindustrial.com/tracker).

## Links

- Original repo: <https://github.com/JonET/monksynth>
- nanoTracker: <https://federatedindustrial.com/tracker>
- nanoTracker API SDK: <https://github.com/savannah-i-g/nanotracker-api-sdk>

## What This Repo Contains

- `nanotracker/` — the nanoTracker plugin source
- `dsp/` and `cpp/` — the upstream MonkSynth DSP and C++ code this fork was built from

## Build

```bash
python3 nanotracker/build_plugin.py
```

This writes:

```text
nanotracker/dist/MonkSynth.ntins
```

## Load In nanoTracker

1. Open `PLG`.
2. Click `+ LOAD PLUGIN (.ntins / .ntsfx)`.
3. Choose `MonkSynth.ntins`.
4. Click `+ ADD TO WS`.

## License

[MIT](LICENSE)
