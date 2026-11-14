import React, { useState } from 'react';
import type { VoiceInputState } from '../input/voice-input.ts';
import type { MicTestReport } from '../input/diagnostics.ts';
import { noteName } from './labels.ts';
import { summarizeTiming } from '../input/grid-timing.ts';
import { C } from './theme.ts';

const COLOR = { ok: C.ok, 'too-quiet': C.warn, 'no-signal': C.muted, clipping: C.rec } as const;
const LABEL = { ok: 'Level OK', 'too-quiet': 'Too quiet', 'no-signal': 'No signal', clipping: 'Clipping' } as const;

/**
 * Live check for real-microphone testing: verdict, detections and what the browser actually granted.
 * The report is opt-in and contains measurements only (no audio, no device identifiers).
 */
export function MicCheckPanel({ state, onReport }: { state: VoiceInputState; onReport: () => MicTestReport }) {
 const [copied, setCopied] = useState<string | null>(null);
 const check = state.micCheck;
 const capture = state.capture;
 const processingOn = capture && (capture.echoCancellation || capture.noiseSuppression || capture.autoGainControl);
 const copy = async () => {
  const text = JSON.stringify(onReport(), null, 1);
  // Clipboard writes can hang (not reject) when the tab is not focused; fall back to showing the text.
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 1000));
  try { await Promise.race([navigator.clipboard.writeText(text), timeout]); setCopied('Copied: paste it into the "Microphone test results" issue.'); }
  catch { setCopied(text); }
 };
 return <div aria-label="Microphone check" style={{ border: '1px dashed #8886', borderRadius: 6, padding: '6px 10px', margin: '6px 0', fontSize: 13 }}>
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
   <strong style={{ color: check ? COLOR[check.verdict] : C.muted }}>{check ? LABEL[check.verdict] : 'Listening…'}</strong>
   {check && <span>peak {Number.isFinite(check.peakDb) ? check.peakDb.toFixed(0) : '−∞'} dBFS</span>}
   {check && <span>hits detected {check.onsetsDetected}{check.lastOnset ? ` (last ${check.lastOnset.levelDb.toFixed(0)} dBFS${check.lastOnset.accepted ? '' : ', weak'})` : ''}</span>}
   {check && <span>notes detected {check.notesDetected}{check.lastNote ? ` (last ${noteName(check.lastNote.midi)})` : ''}</span>}
   <button onClick={copy} title="Measurements only: no audio and no device names">Copy test report</button>
  </div>
  {check && <div role="status" style={{ marginTop: 4 }}>{check.advice}</div>}
  {state.recorder.timing.length > 0 && (() => {
   const t = summarizeTiming(state.recorder.timing);
   return <div aria-label="Grid timing" style={{ marginTop: 4 }} title="Starts/ends within 10 ms of a rounding threshold can move one cell with a few ms of timing error">
    <b>Grid timing:</b> last {t.events} event(s), mean start {t.meanStartOffsetMs! > 0 ? '+' : ''}{t.meanStartOffsetMs} ms from the grid
    {t.nearThreshold > 0 ? <span style={{ color: C.warn }}> · {t.nearThreshold} within 10 ms of a rounding threshold (may land a cell early/late)</span> : ' · none near a rounding threshold'}
   </div>;
  })()}
  {check && <div style={{ marginTop: 4 }} aria-label="Pitch check"><b style={{ color: check.pitch?.state === 'pitch' ? C.ok : check.pitch?.state === 'quiet' || check.pitch?.state === 'unclear' ? C.warn : C.muted }}>Pitch:</b> {check.pitchAdvice}</div>}
  {capture && <div style={{ marginTop: 4, opacity: 0.8 }}>
   Browser granted: echo cancellation {capture.echoCancellation ? 'on' : 'off'}, noise suppression {capture.noiseSuppression ? 'on' : 'off'}, auto gain {capture.autoGainControl ? 'on' : 'off'}{capture.sampleRate ? `, ${capture.sampleRate} Hz` : ''}
   {processingOn && <span style={{ color: C.warn }}> ⚠ processing is on despite the request; transients and levels may be distorted</span>}
  </div>}
  {copied && <div style={{ marginTop: 4, wordBreak: 'break-all', opacity: 0.85 }}>{copied}</div>}
 </div>;
}
