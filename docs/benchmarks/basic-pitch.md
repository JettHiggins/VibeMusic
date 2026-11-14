# YIN vs Basic Pitch (Workstream 2)

Script: `docs/benchmarks/basic-pitch-benchmark.ts` (Basic Pitch is not a project dependency; see the header for setup). Run on 2026-11-14 with Windows 11 and Node 26.13.1, `@spotify/basic-pitch` 1.0.1 and `@tensorflow/tfjs` on the **CPU backend**. The input is synthetic monophonic voices (7 harmonics, vibrato, breath noise, ±7.5% amplitude jitter), not recordings. A note matches when the pitch is exact and the onset is within 50 ms. Basic Pitch input was decimated to 22.05 kHz, with onset/frame thresholds 0.5/0.3 and minimum length 5 frames; overlapping notes were reduced to the strongest for a monophonic comparison.

| Case | Notes | YIN F1 | YIN onset/offset err ms | Basic Pitch F1 | BP onset/offset err ms |
| --- | --- | --- | --- | --- | --- |
| C major scale, detached | 8 | 1.00 (P 1.00 R 1.00) | 4 / 4 | 0.73 (P 0.57 R 1.00) | 8 / 116 |
| low male range legato | 8 | 0.88 (P 0.88 R 0.88) | 8 / 19 | 0.44 (P 0.40 R 0.50) | 13 / 103 |
| high female range | 8 | 1.00 (P 1.00 R 1.00) | 5 / 5 | 0.89 (P 0.80 R 1.00) | 13 / 67 |
| repeated pitch (3x E4) | 3 | 1.00 (P 1.00 R 1.00) | 11 / 12 | 1.00 (P 1.00 R 1.00) | 6 / 40 |
| wide vibrato held notes | 3 | 1.00 (P 1.00 R 1.00) | 2 / 4 | 0.00 (P 0.00 R 0.00) | – / – |
| fast 16ths at 120 BPM | 12 | 1.00 (P 1.00 R 1.00) | 3 / 6 | 0.50 (P 1.00 R 0.33) | 4 / 32 |

Mean F1: **YIN 0.98, Basic Pitch 0.59**. Processing per second of audio: **YIN 43–66 ms, Basic Pitch 2.1–3.5 s** (tfjs CPU, which varies between runs).

## Findings and decision

- YIN stays the real-time path: it is about 50× cheaper and more accurate on these inputs, and it already meets the p95 < 50 ms per-block target in the worker.
- The benchmark found a YIN defect: wide vibrato (±0.6 semitone) split held notes (F1 0.75). The segmenter now requires a pitch change to hold for ~70 ms (`pitch.ts`), with a regression test, and the case reaches 1.00. The remaining miss is one note in low legato.
- Basic Pitch is not adopted for refinement yet. On CPU tfjs it runs 2–3.5× slower than real time. Its default-style thresholds over-segment synthetic voices, merge fast notes and missed wide vibrato entirely, and its offsets were 30–120 ms late. That is likely partly due to the synthetic input and untuned thresholds, so this is not a verdict on real singing.
- Not measured: the browser WebGL backend, real recordings, or tuned Basic Pitch thresholds. Re-run with consented recordings (never committed) before reconsidering. If it is adopted later, it belongs in a worker as offline phrase refinement after a take, never in the audio callback or the live commit path.
