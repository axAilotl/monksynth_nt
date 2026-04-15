---
name: nanotracker-plugin-porting-playbook
description: >
  Port or recreate native instruments and effects as reliable nanoTracker plugins. Use when the
  user wants to adapt an existing VST/AU/native plugin to nanoTracker, inspect a native binary,
  rebuild its parameter or UI contract, scaffold plugin.json/script.js/web/index.html/build_plugin.py,
  use the nanoTracker API SDK for automation or validation, or validate a nanoTracker plugin in
  the live host with real audio metering.
version: "1.1.0"
---

# nanoTracker Plugin Porting Playbook

This skill captures the process that worked for the MonkSynth, Delay Lama, and CamelCrusher NT
porting work in this repo. It is not a generic “port any plugin magically” recipe. It is a
disciplined workflow for:

- extracting the original plugin's external contract
- pinning the current nanoTracker host loader contract
- deciding whether a nanoTracker port is actually feasible
- rebuilding that contract in nanoTracker's browser/worklet model
- validating the result against the real host, not just local unit tests
- measuring binary-only recreations against the original instead of guessing by ear

Use this skill when the user wants a reliable nanoTracker plugin, not a vague prototype.

## External references

- nanoTracker live app: <https://federatedindustrial.com/tracker>
- nanoTracker API SDK: <https://github.com/savannah-i-g/nanotracker-api-sdk>
- FX manifest notes: `references/fx-manifest-v4.md`
- Characterization workflow: `references/characterization.md`

Treat the SDK as part of the normal toolchain. It is useful for:

- relay health checks
- deterministic host-side automation
- asset loading workflows
- project mutation smoke tests

It does not replace real live-host import and analyser validation.

## Phase 0: Pin the live host contract

Before debugging DSP or UI, verify what the current host actually expects.

- Treat the live tracker bundle or a freshly validated current plugin as the source of truth.
- Use old examples only as hints, not as proof that the current host still accepts the same shape.
- If a packaged plugin fails to load with no visible error, debug the manifest and host loader
  contract before touching DSP.

What to verify first:

- schema version in use
- whether the host treats `manifest.type = "fx"` as a pedal-style plugin
- required `requires` flags for the current host
- whether the host expects explicit ports for the plugin type
- whether the host instantiates worklets by graph node id or another identifier

If the host contract is unclear:

- inspect the current live tracker bundle
- inspect a known-good current plugin from the same host generation
- write down the findings immediately in a short note

## What nanoTracker plugins actually are

Before touching code, lock in the runtime model:

- nanoTracker plugins are browser plugins
- DSP runs in an `AudioWorklet`
- custom UI runs in a webview/iframe
- the packager emits `.ntins` for instruments and `.ntsfx` for effects
- native DLLs, VST bundles, and Audio Units do not run directly inside the browser sandbox

This matters because it kills a common bad assumption: “just wrap the DLL.” Direct native hosting
inside nanoTracker is not the path. Your options are:

- real worklet port of the DSP
- clean-room recreation from observed behavior
- external native bridge helper
- offline renderer or multisample workflow

If you skip this decision, the rest of the port will be garbage.

## Non-negotiable rules

- Do not claim success from syntax checks alone.
- Do not stop at a standalone DSP harness.
- Do not assume the original DSP can be decompiled just because the binary is accessible.
- Do not keep adding UI polish while idle noise, NaNs, or host integration bugs remain.
- Always test the packaged `.ntins` or `.ntsfx` in the live tracker.
- Always version-bump before re-importing into nanoTracker; host caching is real.
- Prefer a functional controller first, visual clone second.
- For binary-only recreations, build the inspector and characterization harness before tuning the
  `AudioWorklet`.
- Do not call a port `exact`, `faithful`, or `1:1` unless measured comparison against the original
  and live-host validation both pass.

## Deliverables

A complete port should leave behind these artifacts:

- an inspection artifact documenting the original plugin contract
- a nanoTracker manifest
- a worklet implementation
- a webview UI
- a deterministic packer that emits the plugin archive
- a repeatable verification routine
- an original-plugin characterization artifact for binary-only recreations
- a worklet-vs-reference comparison artifact when characterization exists
- a short note listing remaining deltas and unverified claims
- a release-ready packaged plugin

In this repo, those reference artifacts are:

- `/mnt/ai/delay_lama/lol_lama/tools/DelayLamaInspector.cs`
- `/mnt/ai/delay_lama/lol_lama/delay-lama-inspection.md`
- `https://github.com/savannah-i-g/nanotracker-api-sdk`
- [../../nanotracker/plugin.json](../../nanotracker/plugin.json)
- [../../nanotracker/script.js](../../nanotracker/script.js)
- [../../nanotracker/web/index.html](../../nanotracker/web/index.html)
- [../../nanotracker/build_plugin.py](../../nanotracker/build_plugin.py)
- [../../cpp/src/sample_renderer.cpp](../../cpp/src/sample_renderer.cpp)

## Phase 1: Feasibility triage

Start by classifying the source material.

### Case A: Portable DSP source exists

Use a real DSP port.

Typical examples:

- plain C or C++ DSP with light platform glue
- JUCE or VST code where the synthesis core is separable
- open-source synths with a clear audio engine

Target:

- port the DSP core to `AudioWorklet`
- map existing parameters into nanoTracker manifest parameters
- rebuild the UI in webview code

### Case B: Binary only, simple contract, simple sound

Use a clean-room recreation.

Typical examples:

- small synths with few parameters
- plugins whose sound can be reasonably inferred from presets, ranges, labels, and behavior

Target:

- inspect the binary for metadata and control surface
- reimplement expected behavior in a worklet
- use screenshots and assets to recreate UI behavior

### Case C: Binary only, complex DSP, proprietary internals

Do not fake a direct “port.”

Pick one of:

- external native helper host
- offline render pipeline
- multisample extraction

If the user wants “the exact original DLL sound,” tell the truth about the constraints before
writing a single line of fake worklet DSP.

## Phase 2: Extract the external contract

The external contract is what the original plugin exposes to a host and to the user. That is the
minimum viable truth you need before building anything.

### Extract plugin metadata

Build or adapt a small native inspector like
`/mnt/ai/delay_lama/lol_lama/tools/DelayLamaInspector.cs`.

You want:

- plugin entrypoint
- vendor and product names
- unique ID
- category: synth, effect, etc.
- number of programs
- number of parameters
- input and output channel counts
- startup preset or default program

For Delay Lama, this inspection produced the facts captured in
`/mnt/ai/delay_lama/lol_lama/delay-lama-inspection.md`.

### Extract parameter behavior

For each parameter, record:

- host-visible name
- display label or unit
- numeric range
- observed display formatting
- whether the parameter is continuous or stepped
- whether the parameter is logarithmic or obviously non-linear

Do not stop at raw normalized values if you can query display strings. Display text often reveals
the intended semantic mapping.

### Extract programs or presets

Record:

- program names
- startup program
- per-program parameter values

This gives you:

- factory presets for the port
- regression targets
- a stronger clue about intended sound design

### Write it down immediately

Do not leave extracted facts only in console output. Write them into an inspection note with a
stable shape.

Recommended sections:

- metadata
- parameters
- programs
- observed UI behavior
- reproduction caveats

## Phase 3: Build the inspector and characterization harness first

This phase is mandatory for binary-only recreations. Do not start tuning the JS worklet by ear
until you can inspect and measure the original.

### Inspector requirements

Build or adapt a host-side inspector that can extract:

- metadata
- parameter names
- display strings and units
- stepped vs. continuous behavior
- preset/program names
- bank or chunk-loaded factory preset data when available
- input and output channel shape

The output must be written to a stable artifact, not left in console logs.

### Characterization requirements

For binary-only recreations, render probe signals through the original plugin before tuning the
worklet.

Minimum probe set:

- impulse
- log sweeps at multiple levels
- stepped sines
- transient trains
- at least one realistic program-material probe such as bass, drums, or vocals

Minimum scenario set:

- bypass
- each major module isolated
- at least one hot combined-chain scenario
- wet/dry or output-stage coverage when the plugin exposes it

Required outputs:

- machine-readable summary of peak, RMS, DC offset, and clipped-sample counts
- rendered examples when practical
- a short note summarizing what the original actually does

Reference:
`references/characterization.md`

## Phase 4: Capture UI behavior separately from graphics

Agents often fail here by confusing “the panel image” with “the interface.”

Split the problem into:

- functional controls
- geometry and hit regions
- visual assets
- animation behavior

### Functional controls

List every real control:

- knobs
- faders
- XY pads
- preset selectors
- buttons
- hidden overlays or help panels

For each control, document:

- what parameter or event it drives
- whether it is absolute or relative
- how dragging works
- what release behavior does

### Geometry and hit regions

You need exact coordinates for a clone UI. Capture:

- control rectangles
- slider travel spans
- knob frame sizes
- sprite frame sizes
- help overlay coordinates
- monk or head hit area if the head acts as a target

These ended up hard-coded in [../../nanotracker/web/index.html](../../nanotracker/web/index.html)
for the clone panel.

### Animation behavior

Capture behavior, not just frames:

- idle animation cadence
- mouth motion vs. pitch or vowel
- face or body scaling vs. “head size”
- what changes on note-on, note-off, and sustained notes

If you have a sprite sheet, you still need the sequencing logic.

## Phase 5: Scaffold the nanoTracker plugin

Create the smallest possible working plugin shape before polishing anything.

### Required files

- `plugin.json`
- `script.js`
- `web/index.html`
- `build_plugin.py`

### Manifest structure

Use schema v4 for current browser/worklet plugins, but pin the exact host contract first.

Reference:
[../../nanotracker/plugin.json](../../nanotracker/plugin.json)

#### Instrument ports

For instruments, decide correctly:

- `manifest.type = "instrument"`
- `requires`
- note forwarding and note acceptance fields
- parameter forwarding and write acceptance fields
- worklet registration and note-event handling

#### FX ports

For effects, do not assume old examples still match the current host.

Current host findings are captured in `references/fx-manifest-v4.md`. In practice, verify:

- whether `manifest.type = "fx"` is loaded as a pedal-style plugin
- whether `pedal-v4` is required
- whether `portsV4` is required when a `ports` block is present
- whether explicit `ports.inputs[]` and `ports.outputs[]` are required
- whether the effect should use the graph-style `dsp` layout
- whether the registered processor name must match the graph node id the host instantiates

For current v4 FX work, explicitly validate:

- `manifest.type`
- `requires`
- `ports`
- `dsp`
- `ui.controls[].type = "webview"`
- `forwardParams`
- `acceptsParamWrites`
- `acceptsNotes`

### Manifest guidance

- Start with a minimal parameter set that matches the original contract.
- Do not invent twenty extra parameters because the worklet can support them.
- Use human-readable labels and correct display units.
- Keep defaults aligned with the original startup preset or startup state.

## Phase 6: Implement the worklet first for correctness

The worklet is where reliability goes to die if you are sloppy.

### Message contract

Handle the actual host message surface:

- `init`
- `dispose`
- `noteOn`
- `noteOff`
- `allNotesOff`
- `param`
- `setPitch`
- `setGain`

Reference:
[../../nanotracker/script.js](../../nanotracker/script.js)

Make the worklet tolerant of host variation:

- accept alternate note fields
- accept alternate frequency fields
- accept alternate velocity fields
- ignore malformed messages safely

### DSP reliability rules

Treat all DSP state as hostile.

- clamp every user-facing parameter
- sanitize every sample written back into buffers
- guard every circular buffer index
- reset stale effect state after verified silence
- never let `NaN` or `Infinity` propagate
- silence output when nothing is active
- do not let `setPitch` or host gain messages wake an idle voice

This repo needed explicit non-finite sample sanitizing and delay read-position wrapping to stop
accumulating clicks.

### Keep the first sound path small

Before adding unison, modulation, or UI niceties, prove:

- note on produces sound
- note off releases sound
- pitch changes work
- one or two core parameters work
- idle output is silent

Only after that should you layer in:

- delay
- modulation
- envelope nuance
- clone behavior

## Phase 7: Build the webview as a controller, not a poster

The webview should be functional before it is visually perfect.

### First-pass UI

Start with:

- minimal working controls
- readable state
- correct note and parameter writes

The default SVG UI used here was valuable because it let the host path be tested before the full
bitmap clone was correct.

### Clone UI second

Once the sound and host contract are stable:

- embed or pack original assets
- draw the panel accurately
- implement exact hit testing
- reproduce sprite animation and control travel

### Webview rules

- never rely on the host to infer your sizing intent
- resize the host workspace explicitly if the platform permits
- make pointer behavior deterministic
- release active drags on blur and cancel
- keep hidden modes or alternate views out of the way of the core workflow

Reference:
[../../nanotracker/web/index.html](../../nanotracker/web/index.html)

## Phase 8: Build a deterministic packer

Do not hand-assemble `.ntins` archives.

Use a packer script like [../../nanotracker/build_plugin.py](../../nanotracker/build_plugin.py)
to:

- validate required files exist
- inject packed assets into the webview
- emit the archive in a stable location
- keep source as canonical and `dist/` as disposable output

This is especially useful when:

- the UI needs embedded bitmap assets
- multiple versions need quick rebuilds
- you want repeatable release packaging

## Phase 9: Validate locally before live import

Use a layered test order.

### Static checks

- syntax-check the extracted webview script
- syntax-check the worklet script
- verify the packer runs
- open the built archive and verify `plugin.json`, `script.js`, and `web/index.html` are present

Typical commands from this repo:

```bash
python3 nanotracker/build_plugin.py
node --check nanotracker/script.js
```

For HTML with inline script:

```bash
python3 - <<'PY'
from pathlib import Path
text = Path('nanotracker/web/index.html').read_text()
start = text.index('<script>') + len('<script>')
end = text.index('</script>', start)
Path('/tmp/nt_web.js').write_text(text[start:end], encoding='utf-8')
PY
node --check /tmp/nt_web.js
```

### Offline DSP harness

An offline harness is useful for:

- reproducing NaN bugs
- running long hold tests
- stress-testing delay lines
- checking idle silence

It is not enough for sign-off.

When characterization exists, local validation should also include:

- measuring the worklet against the same signal/scenario grid
- listing the closest matches
- listing the largest remaining misses
- refusing to tune by ear alone once reference data exists

For FX plugins, local validation should explicitly cover:

- stereo input/output routing
- bypass behavior
- wet/dry law
- silence with no input
- module-isolated behavior
- transient handling, not just steady-state sweeps

## Phase 10: Validate in the live host

This is the part agents skip when they want to declare victory too early.

### Why live validation matters

The real bugs often only show up in host context:

- message shape mismatches
- duplicate registration
- suspended audio contexts
- iframe sizing issues
- pointer events not reaching the intended element
- host gain or pitch messages waking idle DSP
- caching hiding the current build

### Required live checks

In the real tracker:

- import the packaged plugin
- add it to the workspace
- verify the UI opens at the intended size
- verify controls send real note and parameter events
- verify no load-time console or worklet errors
- verify silence when idle
- verify audible output on note-on
- verify no clip or click accumulation on sustained notes and retriggers

For FX plugins, also verify:

- real audio input reaches both expected channels
- wet/dry response is sane across the full range
- bypass or module-off states do what the original does
- transient handling and limiter behavior under hot input

### Silent-load debug checklist

When a plugin does not load and the host shows no useful error:

- bump the plugin version before every import attempt
- remove the old import or reload the tracker page if the host caches by version
- inspect the built archive contents
- compare the manifest shape to the current host contract
- prove the loader contract first, then debug DSP

### Use the SDK where it helps

If the nanoTracker API SDK is available, use it to shorten the validation loop:

- confirm relay health before blaming the plugin
- script repeatable host-side setup
- drive asset loading or project mutation tests

Good SDK uses:

- checking that the local relay is attached to a live page
- loading rendered samples into a project
- executing deterministic project commands during tests

Bad SDK uses:

- treating SDK success as proof that the packaged plugin UI is correct
- skipping browser import and analyser checks because CLI calls worked

### Real audio metering

Do not rely only on “it sounded okay once.”

When possible:

- connect to Chromium via CDP
- unlock the audio context with real input events if needed
- find the live audio engine
- use `getMasterTimeDomainData()` and related analyser methods
- measure max amplitude, clip counts, jumps, and energy over time

This repo used the live host analyser to prove that the current build did not clip in the tested
host path.

### Cache discipline

If you re-import the same version number, the host may hand you stale code. Always bump the plugin
version before retesting imported builds.

## Phase 11: Reliability gates

A nanoTracker port is not done until all of these pass:

- fresh import of the packaged archive succeeds
- workspace instance opens correctly sized
- UI writes reach the host
- note-on produces real analyser activity
- idle init produces silence
- no non-finite DSP state appears under stress
- sustained note remains bounded
- repeated retriggers do not accumulate clicks
- release tails decay instead of sticking
- no fresh console or worklet errors appear in the clean run
- comparison artifacts support any fidelity claims being made

If any one of those fails, you are still in implementation, not polish.

## When to choose a bridge instead

Choose a native bridge or offline render path when:

- the original plugin is binary-only and legally or technically unportable
- the DSP is too complex to reimplement reliably
- exact fidelity matters more than live browser integration purity
- the original plugin is 32-bit only and the user insists on “as-is” sound

In that case:

- keep the nanoTracker side as a controller or asset workflow
- do not pretend it is a true direct nanoTracker-native port

## Anti-patterns

Avoid these failure modes:

- assuming a Windows DLL can be loaded from an `AudioWorklet`
- using stale manifest examples against a newer host loader
- treating screenshots as sufficient UI spec
- cloning visuals before control behavior exists
- tuning DSP before the plugin loads at all
- tuning a binary-only recreation by ear after characterization data already exists
- adding advanced synthesis features before the core note path is stable
- skipping version bumps and then debugging stale cache artifacts
- trusting synthetic clicks to unlock browser audio when real input is required
- declaring success without live import and host metering
- calling a recreation exact without measured evidence

## Agent execution template

Use this brief when assigning the work to another coding agent:

```text
Goal: build a reliable nanoTracker port of <plugin>.

1. Classify the source as:
   - real worklet-portable DSP
   - clean-room recreation
   - native bridge
   - offline render only

2. Produce an inspection artifact covering:
   - metadata
   - parameters
   - presets/programs
   - I/O shape
   - UI controls and geometry

3. For binary-only recreations, build:
   - a native inspector
   - an original-plugin characterization harness
   - a machine-readable reference summary

4. Scaffold:
   - plugin.json
   - script.js
   - web/index.html
   - build_plugin.py

5. Implement the smallest working sound path first.

6. Harden the DSP:
   - clamp params
   - sanitize non-finite values
   - guard circular buffers
   - force idle silence

7. Validate locally:
   - syntax checks
   - packer build
   - offline stress harness
   - archive content check
   - comparison against the original when characterization exists

8. Validate in live nanoTracker:
   - import packaged plugin
   - add to workspace
   - verify UI sizing
   - verify real note events
   - meter master output
   - prove no click accumulation

9. Do not claim exact fidelity unless both measured comparison and live host validation support it.
```

## What this skill should produce in practice

A successful run should leave behind:

- an inspection note
- a buildable nanoTracker plugin directory
- a packaged `.ntins` or `.ntsfx`
- a short verification record stating what was tested live and what was not

That is the standard. Anything less is still exploratory work.
