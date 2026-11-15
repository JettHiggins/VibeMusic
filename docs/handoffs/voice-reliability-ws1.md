# WS1 voice reliability handoff — first capability

Branch: ws1/melody-reliability. Base e00ae28, current coordinated round. Source changes are confined to pitch.ts; compatible PitchOptions/PitchReading/SungNote and wire/public input methods remain. WS2 can continue presentation and WS3 can continue service/sound work independently.

## Reproduction and fix

A confident continuous two-second pitch with gentle level modulation produced four fragments before the fix, ending near 241/903/1570/2000 ms with intervening gaps. A clean 125 ms adjacent-note phrase already passed; that does not explain the human fast-note misses under real conditions.

The segmenter used the same amplitude gate for acquiring and retaining a note, then treated any sufficient amplitude dip/rise as re-articulation. The focused fix retains the strict acquisition gate, allows a held periodic note six dB of level hysteresis, and requires a recent break in periodic voicing before envelope-based re-articulation. Mere voiced amplitude swells no longer split a sustained hum. The existing clarity requirement and silence release stay in place. Live pitch gate feedback follows the held-note threshold; interface and raw capture timing are unchanged. Scale mapping is unchanged.

## Vochlea comparison

Official Vochlea Using Pitch documents different input-level needs for humming/noisy input, pitch stability versus note-change tradeoffs and detected/output pitch feedback (see VOCHLEA-REFERENCE.md). Our engineering inference is to separate note acquisition from retention and require evidence for re-articulation. This is our independently tested implementation, not extracted proprietary DSP or a claim of Dubler parity. Key restriction was not the reported pitch-choice problem and was not changed.

## Evidence

- 13 focused pitch tests pass: YIN fundamentals, noise rejection, wide vibrato, repeated articulation, octave errors, block/timestamp invariance, clean 125 ms phrase, modulated full-bar holds, real synthesized waveform extraction/end at silence and quiet periodic input refusing to acquire a new note.
- Full Node 250 passed / one optional skip, shared checks and production build pass.
- Actual Chromium capture worklet -> YIN worker -> recorder -> real SLOOP browser engine passed tests/browser/sustained-hum.js. One softening two-second hum committed exactly one MIDI 60 note, step 20 / duration 16 at 120 BPM; playback continued. Analysis p95 9 ms in this run. This is a synthetic sung signal, not a physical microphone or human performer.

## Remaining work / next step

Quiet acquisition/high or contaminated calibration, background conversation, real-device fast-note misses, every synth, loop-crossing holds and audible envelope-versus-note-gate tracing remain to investigate; this first capability does not close those reports. A naturally decaying instrument may sound short with a correct long MIDI note; compare a known sustained patch and the same committed note before changing envelopes. Provider/speech classification can also hold or exclude notes and remains WS3-owned. Human singing/fun acceptance remains open.

WS1 next investigates quiet/fast capture conditions and rendered duration while continuing integration. WS3's top product priority is actual spoken instrument retrieval; previous typed/real-model research checks do not close Jett's spoken failure. Small review/merge of this capability must preserve the current round's independent work and old immutable test tags.
