# Racing Renewal Phase 5 Report

Date: 2026-08-11

## Result

Phase 5 replaces the boot loop and direct `playTone()` race cues with one eight-bar master composition, four capability-derived arrangements, generation-source cues, and bounded short-overlap vehicle audio.

### Music and generation switching

- Master: 132 BPM, 4 ticks/beat, 4 beats/bar, 8 bars, 128 ticks.
- FC: lead + bass + strong-beat percussion (3 tracks).
- SFC: full percussion + pad (4 tracks).
- PS1: SFC layers + lead harmony (5 tracks).
- PS2: PS1 layers + high ambience pad (6 tracks).
- Every arrangement has the same tempo, meter, and 128-tick loop length.
- All 12 directed generation switches preserve bar position within `1e-9`; the recording contract measured exact zero delta.
- Existing source selection remains PSG / BRR / ADPCM / streaming through `profile.audio.synth`.

### Vehicle and race audio

- Player engine updates every five fixed ticks (12 Hz) with a 95 ms voice, creating a small overlap without a sustained-voice API.
- AI updates every ten ticks, attenuates at 30 world units, and uses pan only when the profile supports positional audio.
- Stopped/middle/maximum frequency: FC 87.5 / 175 / 275 Hz; PS2 82 / 217 / 352 Hz.
- Velocity follows normalized speed and throttle.
- Brake starts at brake ≥ 0.6 and speed ≥ 8, rearms only after brake ≤ 0.25 or speed ≤ 5, so a held button does not retrigger every tick.
- Countdown/start/lap/finish cues all use `playOneShot()` through the active generation source. Layer count follows channel capability; finish is scheduled last and has the strongest velocity.
- The existing voice allocator caps active voices at each profile's 5 / 8 / 24 / 48 limit. The Phase 0 overlap gate therefore does not require a continuous voice API.

### OfflineAudioContext proof

`apps/racing/tools/audio-proof.html` renders the first two bars of every arrangement at 48 kHz through the actual four generation voice-source implementations. It checks 50 ms RMS windows, peak, and clipped samples.

| Generation | Peak | Silent windows | Clipped samples | Frames |
| --- | ---: | ---: | ---: | ---: |
| FC | 0.238165 | 0 | 0 | 188,946 |
| SFC | 0.230025 | 0 | 0 | 188,946 |
| PS1 | 0.275134 | 0 | 0 | 188,946 |
| PS2 | 0.144973 | 0 | 0 | 188,946 |

The browser proof reported `PASS`; the rendered metrics are fixed in `phase5-offline-audio.json` and the visible result in `phase5-offline-audio.png`.

## Verification

- Racing unit: 8 files / 25 tests pass.
- Engine testkit: 1 file / 1 test pass; recording audio now preserves complete one-shot requests as well as compact tone summaries.
- Racing lifecycle E2E: source switch, score rebind, bar phase, vehicle requests, race cue, and dispose pass.
- OfflineAudioContext: four generations × two bars, no silent 50 ms windows, no clipped samples.
