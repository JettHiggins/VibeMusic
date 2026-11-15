// Acoustic browser gate (synthesized speech, not a human microphone):
//   node services/agent/scripts/browser/spoken_stream_e2e.cjs <dir of 16 kHz mono WAVs>
// Needs: app on 127.0.0.1:5173 (--strictPort) and this service on 8000 started with
// GROOVE_STT=faster-whisper GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap GROOVE_VOICE_RESEARCH=1 (warm corpus),
// Playwright from the global npm install, and WAVs tempo_a, tempo_b, piano, audition, accept, undo, stop
// (e.g. Windows System.Speech; never committed).
// Real page, SpeechSession, capture worklets, router, executor, engine, service, faster-whisper and
// SLOOP/CLAP research. Only the physical microphone is replaced: a MediaStreamDestination carrying
// quiet room tone plus predecoded clips. The take is started by a typed command; everything else is
// spoken. Exits non-zero on any failed check.
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright'));
const TTS = process.argv[2];
const CLIPS = ['tempo_a', 'tempo_b', 'piano', 'audition', 'accept', 'undo', 'stop'];

const failures = [];
// Key order is not meaningful in a patch; compare values.
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
function check(ok, what, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(what);
}

(async () => {
  for (const clip of CLIPS) if (!fs.existsSync(path.join(TTS, clip + '.wav'))) throw new Error('missing ' + clip + '.wav');
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const frames = [];
  page.on('websocket', ws => {
    if (!ws.url().includes(':8000')) return;
    const log = dir => f => { try { const m = JSON.parse(f.payload); frames.push({ t: Date.now(), dir, m: m.type === 'speech-audio' ? { type: m.type } : m }); } catch {} };
    ws.on('framesent', log('out')); ws.on('framereceived', log('in'));
  });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.route('**/__tts/*.wav', route => route.fulfill({ body: fs.readFileSync(path.join(TTS, path.basename(route.request().url()))), contentType: 'audio/wav' }));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.waitForFunction(() => globalThis.__voicesynth?.engine?.metadata !== null, null, { timeout: 30000 });
  await page.evaluate(async (clips) => {
    const { engine, voice } = globalThis.__voicesynth, context = engine.getAudioContext();
    // One persistent subscription: the latest transport and session are always available.
    globalThis.__latest = { transport: null };
    engine.subscribe(m => { if (m.type === 'transport') globalThis.__latest.transport = m.transport; });
    const dst = context.createMediaStreamDestination();
    const tone = context.createBuffer(1, context.sampleRate, context.sampleRate), s = tone.getChannelData(0);
    let seed = 42; for (let i = 0; i < s.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; s[i] = (seed / 4294967296 - .5) * .00016; }
    const room = context.createBufferSource(); room.buffer = tone; room.loop = true; room.connect(dst); room.start();
    const decoded = {};
    for (const name of clips) decoded[name] = await context.decodeAudioData(await (await fetch('/__tts/' + name + '.wav')).arrayBuffer());
    const n = Math.round(3 * context.sampleRate), sung = context.createBuffer(1, n, context.sampleRate), d = sung.getChannelData(0);
    let ph = 0; for (let i = 0; i < n; i++) { ph += 2 * Math.PI * 220 * (1 + .01 * Math.sin(2 * Math.PI * 5 * i / context.sampleRate)) / context.sampleRate; let v = 0; for (let k = 1; k < 6; k++) v += Math.sin(k * ph) / k; d[i] = .15 * v; }
    const play = (buffer, at) => { const src = context.createBufferSource(); src.buffer = buffer; src.connect(dst); src.start(context.currentTime + at); return buffer.duration; };
    globalThis.__mic = { clip: (name, at = 0.1) => play(decoded[name], at), sung: (at) => play(sung, at) };
    navigator.mediaDevices.getUserMedia = async () => dst.stream;
    await voice.enableMicrophone();
  }, CLIPS);
  // Hands-free connects the local service itself (the app's default flow); no Connect button needed.
  await page.evaluate(() => globalThis.__voicesynth.voice.enableHandsFree());
  await page.waitForTimeout(1000);

  const speechState = () => page.evaluate(() => globalThis.__voicesynth.voice.getState().speech);
  const transport = () => page.evaluate(() => globalThis.__latest.transport);
  const session = () => page.evaluate(() => globalThis.__voicesynth.engine.getSession());
  const researchState = () => page.evaluate(() => { const r = globalThis.__voicesynth.research; return JSON.parse(JSON.stringify(r.getState ? r.getState() : r.state)); });
  const after = (t0, type, dir = 'in') => frames.filter(f => f.t >= t0 && f.dir === dir && f.m.type === type);
  const waitFor = async (pred, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await pred(); if (v) return v; await page.waitForTimeout(100); } check(false, what, 'timed out after ' + ms / 1000 + ' s; browser speech: ' + JSON.stringify(await speechState().catch(() => null))); return null; };
  const say = async (name) => { const t0 = Date.now(); const seconds = await page.evaluate(n => globalThis.__mic.clip(n), name); return { t0, end: t0 + (0.1 + seconds) * 1000 }; };
  const typed = async (text) => { const r = await page.evaluate(t => { try { globalThis.__voicesynth.coordinator.submitTranscript(t); return null; } catch (e) { return String(e); } }, text); check(r === null, 'typed "' + text + '" sent', r || ''); return r === null; };
  const commandAfter = (t0, type) => frames.find(f => f.t >= t0 && f.dir === 'in' && f.m.type === 'command' && f.m.command.operation.type === type);
  const ackFor = (id) => frames.find(f => f.dir === 'out' && f.m.type === 'ack' && f.m.commandId === id && f.m.status !== 'queued');

  check(!!(await waitFor(() => frames.some(f => f.dir === 'in' && f.m.type === 'speech-status' && f.m.available), 15000, 'speech stream available')), 'speech stream available');
  check((await speechState()).status === 'ready', 'browser speech state ready', JSON.stringify(await speechState()));

  // A. Paused sentence (outside a take) -> one command.
  let t0 = Date.now();
  await page.evaluate(() => { const a = globalThis.__mic.clip('tempo_a', 0.2); globalThis.__mic.clip('tempo_b', 0.2 + a + 0.9); });
  const tempo = await waitFor(() => commandAfter(t0, 'tempo'), 15000, 'A. paused sentence produced a tempo command');
  if (tempo) {
    check(tempo.m.command.operation.bpm === 140, 'A. one forty after a 0.9 s pause -> tempo 140', JSON.stringify(tempo.m.command.operation));
    check(after(t0, 'command').length === 1 && after(t0, 'error').length === 0, 'A. exactly one command and no errors');
    check(!!(await waitFor(() => ackFor(tempo.m.command.id), 10000, 'A. tempo acknowledged')), 'A. tempo acknowledged');
  }

  // C. Acoustic sound request -> real research -> real preview playback -> accept -> Undo.
  await typed('select synth two');
  await page.waitForTimeout(800);
  const original = canon((await session()).tracks.find(t => t.id === 'synth-2').patch);
  t0 = Date.now();
  await say('piano');
  const context = await waitFor(() => after(t0, 'research-context')[0], 20000, 'C. spoken description announced (research-context)');
  if (context) {
    check(/electric piano/.test(context.m.description) && context.m.trackId === 'synth-2', 'C. heard the description for synth two', context.m.description);
    const done = await waitFor(async () => { const r = await researchState(); return r.jobId === context.m.jobId && ['complete', 'failed'].includes(r.status) ? r : null; }, 600000, 'C. research finished in the panel');
    if (done) {
      check(done.status === 'complete' && done.candidates.length === 10 && done.candidates.every(c => !!c.previewUrl), 'C. 10 real candidates with previews', `${done.status}, ${done.candidates.length} candidates, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      // Groove loads the best match itself (auto-load); Undo after a manual choice returns to it.
      await page.waitForTimeout(1500);
      const autoLoaded = canon((await session()).tracks.find(t => t.id === 'synth-2').patch);
      check(autoLoaded === canon(done.candidates[0].patch), 'C. Groove loaded the best match into synth two');
      var beforeAccept = autoLoaded;
      t0 = Date.now();
      await say('audition');
      const preview = await waitFor(() => after(t0, 'candidate-preview')[0], 15000, 'C. spoken audition requested a preview');
      if (preview) {
        check(preview.m.candidateId === done.candidates[1].id, 'C. audition targets candidate two');
        const ended = await waitFor(() => frames.find(f => f.t >= t0 && f.dir === 'out' && f.m.type === 'preview-ack' && f.m.id === preview.m.id && f.m.status !== 'started'), 15000, 'C. preview finished');
        const started = frames.find(f => f.t >= t0 && f.dir === 'out' && f.m.type === 'preview-ack' && f.m.id === preview.m.id && f.m.status === 'started');
        check(!!started && ended?.m.status === 'ended', 'C. browser acknowledged preview playback started then ended', ended ? ended.m.status + (ended.m.reason ? ' ' + ended.m.reason : '') : 'none');
      }
      t0 = Date.now();
      await say('accept');
      const accept = await waitFor(() => commandAfter(t0, 'apply-patch'), 15000, 'C. spoken accept produced apply-patch');
      if (accept) {
        const same = canon(accept.m.command.operation.patch) === canon(done.candidates[1].patch);
        check(same && accept.m.command.operation.trackId === 'synth-2', 'C. accept applies exactly candidate two on synth two',
              same ? '' : canon(accept.m.command.operation.patch).slice(0, 300) + ' vs ' + canon(done.candidates[1].patch).slice(0, 300));
        check(ackFor(accept.m.command.id)?.m.status === 'applied' || !!(await waitFor(() => ackFor(accept.m.command.id)?.m.status === 'applied', 5000, 'C. accept applied')), 'C. accept acknowledged applied');
        const applied = canon((await session()).tracks.find(t => t.id === 'synth-2').patch);
        check(applied === canon(done.candidates[1].patch), 'C. engine patch equals candidate two');
        t0 = Date.now();
        await say('undo');
        const undo = await waitFor(() => commandAfter(t0, 'undo'), 15000, 'C. spoken undo produced undo');
        if (undo) {
          await waitFor(() => ackFor(undo.m.command.id)?.m.status === 'applied', 5000, 'C. undo applied');
          check(canon((await session()).tracks.find(t => t.id === 'synth-2').patch) === beforeAccept, 'C. undo returns to the sound Groove loaded');
        }
      }
    }
  }

  // B. Take started by a typed command; spoken "Groove, stop" with singing 0.35 s later.
  await typed('record synth one');
  const recording = await waitFor(async () => (await transport())?.recordingState === 'recording', 15000, 'B. take is recording before stop is spoken');
  if (recording) {
    check(true, 'B. take is recording before stop is spoken');
    await page.waitForTimeout(1000);
    t0 = Date.now();
    const said = await say('stop');
    await page.evaluate(seconds => globalThis.__mic.sung(0.1 + seconds + 0.35), (said.end - said.t0) / 1000 - 0.1);
    const stop = await waitFor(() => commandAfter(t0, 'stop-recording'), 10000, 'B. spoken stop produced stop-recording');
    if (stop) {
      const late = (stop.t - said.end) / 1000;
      check(late < 1.5, 'B. stop arrived promptly despite singing 0.35 s later', `${late.toFixed(2)} s after the words`);
      const span = after(t0, 'command-span')[0];
      check(!!span && frames.indexOf(span) < frames.indexOf(stop), 'B. command excluded from the take before the stop');
      await waitFor(() => ackFor(stop.m.command.id)?.m.status === 'applied', 5000, 'B. stop applied');
      await page.waitForTimeout(800);
      const tr = await transport();
      check(tr.playing === true && tr.recordingState === 'idle', 'B. recording stopped and playback continues', JSON.stringify({ playing: tr.playing, recordingState: tr.recordingState }));
      check(after(t0, 'command').length === 1, 'B. exactly one command (the stop)');
    }
  }

  const speech = await speechState();
  check(speech.status !== 'unavailable', 'browser speech never failed (coverage, stall, discontinuity)', JSON.stringify(speech));
  check(!frames.some(f => f.dir === 'in' && f.m.type === 'error' && /unsupported/i.test(f.m.message)), 'no unsupported-message errors from the service');
  check(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));
  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join('; ')}` : '\nALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('E2E ERROR', e); process.exit(2); });
