# Characterization Workflow

Use this reference for binary-only recreations.

## Goal

Build a repeatable measurement loop:

1. Inspect the original plugin contract.
2. Render probe signals through the original plugin.
3. Recreate the DSP in the worklet.
4. Render the same probe signals through the worklet.
5. Compare the two outputs with the same metrics on every pass.

Do not switch to ear-only tuning once this loop exists.

## Minimum probe set

- impulse
- log sweeps at multiple levels
- stepped sines
- transient trains
- at least one realistic program-material probe

## Minimum scenario set

- bypass
- each major module isolated
- at least one hot combined-chain scenario
- wet/dry or master-stage coverage if exposed

## Minimum metrics

- peak
- RMS
- DC offset
- clipped-sample count

## Required artifacts

- original-plugin characterization summary
- worklet-vs-reference comparison summary
- short note listing the biggest remaining misses

## Practical lessons from CamelCrusher NT

- The first major failure was host-loader mismatch, not DSP.
- The first DSP recreation was too weak because it was not measured against the original.
- The next DSP pass overshot because it moved by intuition rather than by a stable comparison loop.
- The useful path was: characterize, compare, patch, re-measure, and record what still misses.
