# WS3 speech integration — PR43

Reviewed/integrated exact head **edb758fca851de21a42a4107a89cb9c8bf422112**, including delayed-result fixeda96f2, with current WS2 live-range/UI and WS1 melody source. Tested combination: ws1/speech-final-integration **b1097f6**. Original author commits are preserved; earlier independently cherry-picked protocol/cooldown/availability behavior remains.

## Root verification

- **30 focused speech checks passed**, including the external delayed-first-result and both earlier follow-ups. First-cut recognition arriving after the hold budget now reaches the same bounded refusal decision instead of executing an unfinished prefix. Completed matching failed probes release their slot; stale probes do not clear newer work. Late complete requests and priority stop have owned regressions.
- Full combined backend: **445 passed /6 optional skips**, including real SLOOP renderer tests. Provider/STT/research environment explicitly disabled for ordinary checks; no API call/key use.
- Combined Node: **274 passed /1 optional skip**; shared schema/type checks pass.
- Actual provider-disabled Python WebSocket -> real WASM integration passes with authoritative snapshots.
- Frontend runtime is unchanged from the just-validated Leo integration: low/high live-follow, manual range/edge recovery, growing preview/full-bar and laptop-layout checks passed there; no repeated model-heavy probe is claimed here.

The producer and consumer now live together on engine-integration. Restart the service after pulling; an old running process does not gain these handlers/endpointing changes from a Git pull. The new setup error accurately names research configuration/CI artifacts rather than implying the renderer is missing implementation.

## Evidence and remaining limits

WS3's Windows handoff reports **4/5** full synthesized acoustic browser runs passing describe -> real CLAP/SLOOP -> actual preview started/ended -> exact accept/Undo, with paused sentence and stop checks. One run lost the connection; this is reported peer evidence, not a new root independent rerun or human microphone acceptance. The CJS scripts now assert results and retain a persistent transport subscription. Root's separate constrained-host capture/socket failures are not declared fixed by this merge.

Long still-open/transcribing requests at the budget refuse explicitly; no fake classified coverage or relaxed browser guard. Keep supported requests short (the current refusal asks under5.5s). Early stop relies on a~0.25s dip; without a dip it can wait for pause/segment cap. A parser-valid non-cut prefix such as Groove record before a longer pause/synth two can still act on the selected track. These are disclosed remaining interaction limits, not a claim of complete natural-language endpointing. Deep Agents browser-action tools, actual free-provider quality/quota, physical microphone/noise/gain, human sound quality/fun and full-product acceptance remain open per PLAN/STATUS.
