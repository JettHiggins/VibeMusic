# Frozen repair playtest results

**Not run. Frozen build: `playtest-repair-1`.** Record its exact SHA with `git rev-parse HEAD` and follow FROZEN-PLAYTEST.md. Do not test a moving branch and describe the result as acceptance.

Use headphones and the same microphone/gain for quiet and conversational-noise trials. Startup audio activation/microphone permission is allowed; check voice and mouse correction separately. Keep raw recordings off. Copy the app's microphone report for numeric evidence.

## Build and environment

- Frozen application tag: `playtest-repair-1`; exact SHA: record from `git rev-parse HEAD`
- Matching rebuilt WASM revision/export: WS1 build verified; verify matching assets on the test laptop
- Tester / date / laptop / OS / Chrome version: pending
- Microphone / selected processing profile / actual granted processing: pending
- Measured noise floor / normal-volume reference / latency / trim: pending
- Exact prior failing build, if recoverable from Lenny's laptop: pending

## Results to fill in

Enter pass, fail or not tested, plus the observation. An unclear result stays open.

| Check | Result / observation |
| --- | --- |
| Fresh launch: empty, stopped and silent; explicit saved-project load still works | Not tested |
| Record before Play: four beats then capture at 60/120/180 BPM; repeated click does not extend it | Not tested |
| Stop/restart and cancel count-in work; stopping capture leaves playback running | Not tested |
| Metronome continues during playback/capture; mouse and spoken mute work; distinguish click from count-in | Not tested |
| Calibrated kick/snare/hats land where intended; retain grid-timing report if a hit lands early/late | Not tested |
| Mouse erase: one committed and one provisional event on each lane; others and new input survive | Not tested |
| Piano-roll erase: one committed and provisional note on every synth; unrelated notes survive | Not tested |
| Voice erase: explicit bar/beat/sixteenth and active-take default; no unintended clear/transport stop | Not tested |
| Invalid/conflicting targets or positions refuse without musical mutation | Not tested |
| Erased input stays absent across later loops/late analysis; committed erase is undoable | Not tested |
| Quiet normal-volume singing: synth order 1 → 2 → 3, then 3 → 1 → 2 | Not tested |
| Same singing with background conversation: both orders, no progressive detection/verification loss | Not tested |
| Calibration does not learn foreground singing as noise; insufficient quiet gives honest guidance | Not tested |
| Ten minutes building/correcting a groove without audible glitches or code changes | Not tested |

For a capture failure, note what the meter, pitch reading, provisional notes, speech verification, selected/active track and commit counter showed. “Nothing happened” is a failure to investigate, not a reason to keep raising gain. Attach only the numeric diagnostic report unless audio collection was explicitly requested.

## Fun/usability decision

- Could you make the groove you intended? Pending
- Most frustrating interaction, if any: pending
- Would you keep playing? Why? Pending
- Repair milestone accepted by Jett: **No — test pending**

Post the filled result as a comment on coordination issue #9 or a linked test issue, identifying the frozen commit. WS1 records failures and assigns repairs before another freeze. This gate does not replace the larger all-device, hands-free sound-design and blind-listening gates in PLAN.md.
