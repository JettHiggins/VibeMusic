# Engine editing and session restore for Workstream 2

Current priority: [MELODY-RETENTION-ROUND.md](MELODY-RETENTION-ROUND.md) and [STATUS.md](STATUS.md). New repair behavior is planned, not yet implemented; historical demo/count-in/editing/noise guidance below may be superseded. Use a frozen integrated commit for human acceptance.

These are additive v1 commands handled by the real audio-thread engine. Use the current getSession().revision, a unique command ID, and the normal applied/rejected subscription feedback. Do not update the UI's authoritative session from a queued submission receipt.

## Pattern replacement and volume

- `edit-pattern`: `{type:'edit-pattern', trackId, notes, hits}`, boundary `next-loop`. Replaces that track's complete pattern atomically. Keep both arrays in the payload: melodic tracks require empty hits; drums require empty notes. Other tracks, patch, mixer, and selection are preserved. For small UI edits, start from the current track arrays, change the intended item, and submit the resulting arrays. Do not accidentally clear a different drum lane.
- `volume`: `{type:'volume', trackId, volume}`, normally boundary `immediate`, normalized 0–1. Changes only the session mixer, not stored patch parameters or patterns. Mute remains a separate command.
- Pattern arrays are bounded to 64 monophonic notes or 192 drum hits (three lanes by 64 steps). Event IDs must be unique per track. Starts are 0–63; notes may tie across the loop edge. Overlapping monophonic notes and duplicate lane/grid hits reject atomically.

## Saved sessions

Store/export the versioned object from getSession(); saving a snapshot does not require an engine command. Parse imported JSON with SessionState before proposing `{type:'load-session', session}`, boundary `next-loop`. Firmware-level validation runs again in the engine: ordered unique track slots, engine revision, known patches/parameters, integer BPM, valid note layout, and array bounds.

The saved revision is not adopted: a load advances the current revision by one. Loading while armed/recording rejects; finish the take first. Successful load invalidates the old recording window and releases live audition voices. During playback, imported music restarts at the scheduled downbeat while transport continues. Stopped playback remains stopped. The previous musical session is retained in undo history. Invalid loads leave current state untouched. Local persistence, import/export controls, and storage error feedback remain Workstream 2's responsibility.

## Live auditions

BrowserEngine implements the optional AuditionEngineAdapter capability in the shared contracts. After initialize(), call `audition(event)`:

```ts
engine.audition({kind:'note',trackId:'synth-1',midi:60,velocity:0.8,on:true});
engine.audition({kind:'note',trackId:'synth-1',midi:60,velocity:0,on:false});
engine.audition({kind:'drum',lane:'kick',velocity:0.9});
```

Send note-off on pointer/key release and when canceling an interaction. These events audition the actual instrument without changing revisions, patterns, or microphone recording buffers. They are audio-thread messages, not SessionCommand operations or agent tools. A mock EngineAdapter need not support auditions; disable the audition controls when the capability is absent. Avoid using keyboard/UI timestamps as microphone performance timestamps.

## Verification and current limits

Real-WASM tests cover boundary edits, wrapped notes, volume isolation, rejected imports, normalized revisions, undo, auditions, and load during playback. The UI and persistence consumer use these engine APIs; current acceptance remains in STATUS.md. Pull schemas and restart the backend after contract updates.
