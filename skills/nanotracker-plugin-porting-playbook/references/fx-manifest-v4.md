# FX Manifest V4 Notes

Use this reference when a current nanoTracker FX plugin fails to load or behaves unlike older
examples.

## Current host findings from CamelCrusher NT

- Schema v4 `manifest.type = "fx"` may be treated by the current host as a pedal-style plugin.
- A current FX plugin may need `pedal-v4` in `requires`.
- If the manifest uses a `ports` block, the host may also require `portsV4`.
- Current FX plugins should explicitly define `ports.inputs[]` and `ports.outputs[]`.
- The host may instantiate worklets from graph node ids, not from older nested worklet-only
  manifest examples.
- The registered `AudioWorkletProcessor` name must match the node id the host instantiates.

## Practical checklist

When an FX plugin silently fails to load:

- inspect `manifest.type`
- inspect `requires`
- inspect `ports`
- inspect `dsp`
- open a current known-good plugin for comparison
- inspect the live tracker bundle if needed

## Do not assume

- that an old FX example still matches the current host
- that `type: "fx"` always follows the same path across host versions
- that loader problems are DSP problems
