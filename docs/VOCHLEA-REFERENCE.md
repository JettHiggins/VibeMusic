# Vochlea / Dubler reference investigation

Jett's “vochela” reference is interpreted as Vochlea's Dubler 2 voice-to-MIDI product. Use it as a behavior/interaction reference, not evidence that our implementation matches its internals. The following are verified public manufacturer descriptions; exact DSP/model internals are not disclosed by these pages.

## Publicly documented behavior

- [Using Pitch](https://vochlea.com/learn/using-pitch): the display distinguishes sung pitch from the output note. Input level is adjustable for quiet humming versus noisy/loud input. Pitch Stickiness trades easier note holding against easier note changes. Its bend modes provide different degrees of anchoring and pitch following.
- [Restricting the Key](https://vochlea.com/learn/restricting-the-key): output can be restricted to a scale with out-of-key pitches mapped to a nearby allowed pitch; the interface shows the allowed notes. It also documents optional automatic key detection and custom restrictions. These are reference features, not requirements to add them this round.
- [Recalibrating your microphone](https://vochlea.com/learn/recalibrating-your-own-mic): calibration depends on the microphone/input gain, and the interface provides a guided recalibration entry from the meter.

## What to extract for this project

WS1 owns an evidence-backed comparison: capture level/noise measurement -> voiced-pitch detection -> note stability/segmentation -> allowed output pitch -> note-on/off duration -> rendered envelope. This pipeline is our engineering decomposition, an inference for our investigation rather than a claim about Dubler's private architecture. Test known signals and actual available microphone behavior at each boundary. Compare gentle humming, adjacent fast notes, repeated notes, vibrato and full-bar holds. Use public demonstrations or an already-available licensed copy for optional observations; no purchase, trial account or binary extraction is needed to start.

The most relevant hypotheses for our code are a single high gate closing low-level hums, brief confidence dips ending notes, long-lived pitch-history resisting quick changes, or commit/render boundaries truncating a hold. Confirm with traces before changing thresholds. Keep raw pitch and scale mapping separate: Jett clarified the selected pitches were reasonable, but fast notes were missed and both recorded and audible durations were short. Do not treat arbitrary snapping changes as a fix.

WS2 owns the clarity comparison: which information is continuously visible, where sensitivity/calibration is discoverable, how detected versus output notes are explained, and how advanced functions stay out of the basic performance flow. Implement a compact original monochrome layout around our existing DAW/piano roll, with actionable feedback and optional details.

Deliver a short section in each stream's handoff: observed behavior/source, hypothesis, implemented choice, measured before/after and remaining uncertainty. Claims about proprietary model architecture or parity require actual evidence. Preserve our existing drum/voice exclusion, capture timing and shared operation contracts while improving the feel.
