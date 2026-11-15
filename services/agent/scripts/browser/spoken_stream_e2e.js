// Usage: as executor_research_e2e.js, plus a directory of 16 kHz mono phrase WAVs (tempo_a, tempo_b, stop;
// e.g. Windows System.Speech, not committed): node services/agent/scripts/browser/spoken_stream_e2e.js <dir>
// Headless Chromium: synthesized speech through the real browser speech stream (SpeechSession,
// speech-audio, coverage guard) to the WS3 service with local faster-whisper. Only the physical
// microphone is replaced: a MediaStreamDestination carrying room tone plus injected clips.
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright'));
const TTS = process.argv[2];

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const frames = [];
  page.on('websocket', ws => {
    if (!ws.url().includes(':8000')) return;
    const log = dir => f => { try { const m = JSON.parse(f.payload); if (m.type !== 'speech-audio') frames.push({ t: Date.now(), dir, m }); else frames.push({ t: Date.now(), dir, m: { type: 'speech-audio', endFrame: m.endFrame } }); } catch {} };
    ws.on('framesent', log('out')); ws.on('framereceived', log('in'));
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/__tts/*.wav', route => route.fulfill({ body: fs.readFileSync(path.join(TTS, path.basename(route.request().url()))), contentType: 'audio/wav' }));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.waitForFunction(() => globalThis.__voicesynth?.engine?.metadata !== null, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const { engine, voice } = globalThis.__voicesynth, context = engine.getAudioContext();
    const dst = context.createMediaStreamDestination();
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate), s = buffer.getChannelData(0);
    let seed = 42; for (let i = 0; i < s.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; s[i] = (seed / 4294967296 - .5) * .00016; }
    const room = context.createBufferSource(); room.buffer = buffer; room.loop = true; room.connect(dst); room.start();
    globalThis.__mic = {
      decoded: {},
      async load(name) { this.decoded[name] = await context.decodeAudioData(await (await fetch('/__tts/' + name + '.wav')).arrayBuffer()); },
      async clip(name, at = 0) { const audio = this.decoded[name]; const src = context.createBufferSource(); src.buffer = audio; src.connect(dst); src.start(context.currentTime + at); return audio.duration; },
      sungBuffer: null,
      sung(at, seconds, hz = 220) { const n = Math.round(seconds * context.sampleRate), b = context.createBuffer(1, n, context.sampleRate), d = b.getChannelData(0); let ph = 0; for (let i = 0; i < n; i++) { const f = hz * (1 + .01 * Math.sin(2 * Math.PI * 5 * i / context.sampleRate)); ph += 2 * Math.PI * f / context.sampleRate; let v = 0; for (let k = 1; k < 6; k++) v += Math.sin(k * ph) / k; d[i] = .15 * v; } const src = context.createBufferSource(); src.buffer = b; src.connect(dst); src.start(context.currentTime + at); },
    };
    for (const name of ['tempo_a', 'tempo_b', 'stop']) await globalThis.__mic.load(name);
    navigator.mediaDevices.getUserMedia = async () => dst.stream;
    await voice.enableMicrophone();
  });
  const connect = page.getByRole('button', { name: 'Connect agent', exact: true });
  if (!(await connect.isVisible().catch(() => false))) await page.locator('summary', { hasText: /agent/i }).first().click().catch(() => {});
  await connect.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.evaluate(async () => { await globalThis.__voicesynth.voice.enableHandsFree(); });
  const transport = () => page.evaluate(() => { let t = null; const off = globalThis.__voicesynth.engine.subscribe(m => { if (m.type === 'transport') t = m.transport; }); off(); return t; });
  // Wait until the speech stream is verified as available.
  const ready = async () => { for (let i = 0; i < 100; i++) { if (frames.some(f => f.dir === 'in' && f.m.type === 'speech-status' && f.m.available)) return true; await page.waitForTimeout(100); } return false; };
  console.log('speech stream available:', await ready());
  const show = f => `${((f.t - T0) / 1000).toFixed(2)}s ${f.dir} ${f.m.type}` + (f.m.command ? ' ' + JSON.stringify(f.m.command.operation) : '') + (f.m.status ? ' ' + f.m.status : '') + (f.m.message ? ' "' + f.m.message + '"' : '') + (f.m.type === 'command-span' ? ` [${f.m.startFrame}..${f.m.endFrame}]` : '');
  let T0;

  // A. Whole sentence with a 0.9 s pause, outside recording.
  T0 = Date.now();
  const da = await page.evaluate(async () => { const a = await globalThis.__mic.clip('tempo_a', 0.2); await globalThis.__mic.clip('tempo_b', 0.2 + a + 0.9); return a; });
  await page.waitForTimeout(7000);
  console.log('A. "Groove, set the tempo to" <0.9 s> "one forty":');
  frames.filter(f => f.t >= T0 && ['command', 'error', 'command-span'].includes(f.m.type)).forEach(f => console.log('   ' + show(f)));
  const tempoCmd = frames.find(f => f.t >= T0 && f.m.type === 'command');
  if (tempoCmd) await page.waitForTimeout(4500);  // tempo applies at the next loop

  // B. Record synth one, then "Groove, stop" with singing 0.35 s after it; playback must continue.
  await page.evaluate(() => globalThis.__voicesynth.coordinator.submitTranscript('record synth one'));
  await page.waitForFunction(() => { let rec = false; const off = globalThis.__voicesynth.engine.subscribe(m => { if (m.type === 'transport') rec = m.transport.recordingState === 'recording'; }); off(); return rec; }, null, { timeout: 15000, polling: 100 }).catch(() => {});
  await page.waitForTimeout(1500);
  T0 = Date.now();
  const stopLen = await page.evaluate(async () => { const d = await globalThis.__mic.clip('stop', 0.1); globalThis.__mic.sung(0.1 + d + 0.35, 3.0); return d; });
  await page.waitForTimeout(6500);
  console.log(`B. during a take: "Groove, stop" (${stopLen.toFixed(2)} s clip) then singing 0.35 s later:`);
  frames.filter(f => f.t >= T0 && ['command', 'error', 'command-span', 'ack'].includes(f.m.type)).forEach(f => console.log('   ' + show(f)));
  const stopFrame = frames.find(f => f.t >= T0 && f.m.type === 'command' && f.m.command.operation.type === 'stop-recording');
  if (stopFrame) console.log(`   stop command arrived ${((stopFrame.t - T0) / 1000 - 0.1 - stopLen).toFixed(2)} s after the spoken clip ended (singing continued for 3 s)`);
  const last = frames.filter(f => f.dir === 'out' && f.m.type === 'transport').pop();
  console.log('   transport now:', last ? JSON.stringify({ playing: last.m.transport.playing, recordingState: last.m.transport.recordingState }) : 'n/a');
  const speechFailures = frames.filter(f => f.m.type === 'error' && /stall|coverage|discontinuity/i.test(f.m.message || ''));
  const verified = frames.filter(f => f.dir === 'in' && f.m.type === 'speech-verified').length;
  console.log('speech-verified frames:', verified, '| coverage/stall failures:', speechFailures.length, '| page errors:', errors.length ? errors : 'none');
  const ui = await page.evaluate(() => [...document.querySelectorAll('[role=alert], .error')].map(e => e.textContent).filter(Boolean).slice(0, 5));
  console.log('visible alerts:', JSON.stringify(ui));
  await browser.close();
})().catch(e => { console.error('SPEECH E2E FAILED', e); process.exit(1); });
