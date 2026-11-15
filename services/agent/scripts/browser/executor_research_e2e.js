// Usage: start the app (5173, strictPort) and this service (8000) with GROOVE_STT=faster-whisper,
// GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap GROOVE_VOICE_RESEARCH=1; Playwright from the global npm install.
// node services/agent/scripts/browser/executor_research_e2e.js
// Headless Chromium end to end against the running app (5173) and WS3 service (8000).
// Real page, coordinator, BrowserActionRouter, VoiceInput executor, engine and service; only the
// physical microphone is replaced by quiet synthetic room tone (as tests/browser/input-action-lifecycle.js).
const path = require('path');
const { chromium } = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright'));

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const frames = [];
  page.on('websocket', ws => {
    if (!ws.url().includes(':8000')) return;
    const log = (dir) => (f) => { try { const m = JSON.parse(f.payload); if (m.type !== 'speech-audio' && m.type !== 'transport') frames.push({ t: Date.now(), dir, m }); } catch {} };
    ws.on('framesent', log('out')); ws.on('framereceived', log('in'));
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.waitForFunction(() => globalThis.__voicesynth?.engine?.metadata !== null, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const { engine, voice } = globalThis.__voicesynth, context = engine.getAudioContext();
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate), s = buffer.getChannelData(0);
    let seed = 42; for (let i = 0; i < s.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; s[i] = (seed / 4294967296 - .5) * .00016; }
    navigator.mediaDevices.getUserMedia = async () => {
      const src = context.createBufferSource(), dst = context.createMediaStreamDestination();
      src.buffer = buffer; src.loop = true; src.connect(dst); src.start(); return dst.stream;
    };
    await voice.enableMicrophone();
  });
  const connect = page.getByRole('button', { name: 'Connect agent', exact: true });
  if (!(await connect.isVisible().catch(() => false))) await page.locator('summary', { hasText: /agent/i }).first().click().catch(() => {});
  await connect.click({ timeout: 10000 });
  await page.waitForFunction(() => { try { return !!globalThis.__voicesynth.coordinator && document.body.innerText.length > 0; } catch { return false; } });
  await page.waitForTimeout(1500);
  const submit = async (text) => page.evaluate(async (t) => {
    for (let i = 0; i < 100; i++) { try { globalThis.__voicesynth.coordinator.submitTranscript(t); return 'sent'; } catch (e) { await new Promise(r => setTimeout(r, 100)); if (i === 99) return String(e); } }
  }, text);
  const status = () => page.evaluate(() => globalThis.__voicesynth.voice.getBrowserStatus());
  const since = (t0, pred) => frames.filter(f => f.t >= t0 && pred(f.m));
  const show = (f) => `${f.dir} ${f.m.type}` + (f.m.operation ? ' ' + JSON.stringify(f.m.operation) : '') + (f.m.status ? ' ' + f.m.status : '') + (f.m.reason ? ' (' + f.m.reason + ')' : '') + (f.m.message ? ' "' + f.m.message + '"' : '') + (f.m.command ? ' ' + JSON.stringify(f.m.command.operation).slice(0, 90) : '') + (f.m.type === 'research' ? ` progress=${f.m.progress} candidates=${f.m.candidates.length}` : '');

  // 1. Calibration through the integrated executor
  await page.waitForFunction(() => globalThis.__voicesynth.voice.getBrowserStatus()?.available === true, null, { timeout: 20000 });
  const before = await status();
  let t0 = Date.now();
  console.log('1. calibrate noise:', await submit('calibrate noise'), '| status before:', JSON.stringify({ rev: before.inputRevision, mic: before.microphone, cal: before.calibration }));
  await page.waitForFunction(() => globalThis.__voicesynth.voice.getBrowserStatus()?.activeAction !== null, null, { timeout: 10000 }).catch(() => {});
  const phases = new Set();
  for (let i = 0; i < 300; i++) { const s = await status(); if (s.activeAction) phases.add(s.activeAction.phase); else if (i > 5) break; await page.waitForTimeout(100); }
  await page.waitForTimeout(500);
  const after = await status();
  console.log('   phases seen:', [...phases].join(' -> '), '| after:', JSON.stringify({ rev: after.inputRevision, cal: after.calibration }));
  since(t0, m => ['browser-action', 'browser-action-ack', 'error', 'utterance'].includes(m.type)).forEach(f => console.log('   ' + show(f)));
  console.log('   browser-status frames sent:', since(t0, m => m.type === 'browser-status').length);

  // 2. Key command
  t0 = Date.now();
  console.log('2. key D minor:', await submit('key D minor'));
  await page.waitForTimeout(800);
  console.log('   session pitchSnap:', JSON.stringify(await page.evaluate(() => globalThis.__voicesynth.engine.getSession().pitchSnap)));
  since(t0, m => ['command', 'ack', 'error'].includes(m.type)).forEach(f => console.log('   ' + show(f)));

  // 3. Spoken-style sound request through real research (voice research context)
  await page.evaluate(() => globalThis.__voicesynth.coordinator.submitTranscript('select synth two'));
  await page.waitForTimeout(500);
  t0 = Date.now();
  const patchBefore = await page.evaluate(() => JSON.stringify(globalThis.__voicesynth.engine.getSession().tracks.find(t => t.id === 'synth-2').patch));
  console.log('3. make it sound like a warm electric piano:', await submit('make it sound like a warm electric piano'));
  await page.waitForFunction(() => { const r = globalThis.__voicesynth.research; const s = r.getState ? r.getState() : r.state; return s && (s.status === 'complete' || s.status === 'failed'); }, null, { timeout: 600000 }).catch(e => console.log('   wait failed', String(e)));
  const research = await page.evaluate(() => { const r = globalThis.__voicesynth.research; const s = r.getState ? r.getState() : r.state; return { status: s.status, jobId: s.jobId, track: s.trackId, description: s.description, candidates: s.candidates.length, preview: s.candidates.map(c => !!c.previewUrl), error: s.error }; });
  console.log(`   research panel after ${((Date.now() - t0) / 1000).toFixed(1)} s:`, JSON.stringify(research));
  const ctx = since(t0, m => m.type === 'research-context'); console.log('   research-context frames:', ctx.length, '| research updates:', since(t0, m => m.type === 'research').length);
  const firstPreview = await page.evaluate(async () => { const r = globalThis.__voicesynth.research; const s = r.getState ? r.getState() : r.state; const url = s.candidates[1]?.previewUrl; if (!url) return null; const res = await fetch(url); const buf = await res.arrayBuffer(); const ctx = globalThis.__voicesynth.engine.getAudioContext(); const audio = await ctx.decodeAudioData(buf); let peak = 0; const d = audio.getChannelData(0); for (const v of d) peak = Math.max(peak, Math.abs(v)); return { bytes: buf.byteLength, seconds: audio.duration, peak }; });
  console.log('   candidate 2 preview decoded in page:', JSON.stringify(firstPreview));

  // 4. Accept and Undo
  t0 = Date.now();
  console.log('4. use number two:', await submit('use number two'));
  await page.waitForTimeout(1500);
  const patchAccepted = await page.evaluate(() => JSON.stringify(globalThis.__voicesynth.engine.getSession().tracks.find(t => t.id === 'synth-2').patch));
  console.log('   undo:', await submit('undo'));
  await page.waitForTimeout(1500);
  const patchUndone = await page.evaluate(() => JSON.stringify(globalThis.__voicesynth.engine.getSession().tracks.find(t => t.id === 'synth-2').patch));
  since(t0, m => ['command', 'ack', 'error'].includes(m.type)).forEach(f => console.log('   ' + show(f)));
  console.log('   patch changed by accept:', patchAccepted !== patchBefore, '| restored by undo:', patchUndone === patchBefore);
  const unsupported = frames.filter(f => f.dir === 'in' && f.m.type === 'error' && /unsupported/.test(f.m.message));
  console.log('unsupported-message errors from service:', unsupported.length, '| page errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('E2E FAILED', e); process.exit(1); });
