async page => {
 // Real React/AudioWorklet/WASM and synthetic input; scripted, schema-valid service
 // messages exercise UI feedback only. No microphone recording, STT/model/API calls.
 const base = page.url().split('/').slice(0, 3).join('/');
 let peer, snapshot, transport, request;
 const messages = [];
 await page.routeWebSocket('ws://127.0.0.1:8000/ws', socket => {
  peer = socket;
  socket.onMessage(data => {
   const m = JSON.parse(String(data)); messages.push(m);
   if (m.type === 'session') snapshot = m.session;
   if (m.type === 'transport') transport = m.transport;
   if (m.type === 'sound-request') request = m;
   if (m.type === 'speech-audio') {
    socket.send(JSON.stringify({ type: 'speech-status', streamId: m.streamId, available: true, provider: 'SCRIPTED UI test' }));
    socket.send(JSON.stringify({ type: 'speech-verified', streamId: m.streamId, clockId: m.clockId, fromFrame: messages.find(x => x.type === 'speech-audio').startFrame, throughFrame: m.endFrame - 1 }));
   }
  });
 });
 const check = (condition, message) => { if (!condition) throw new Error(message); };
 await page.setViewportSize({ width: 1366, height: 768 });
 await page.goto(base);
 await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
 const dialog = page.getByRole('dialog', { name: 'Check your timing' });
 await dialog.waitFor();
 check(!await page.evaluate(() => !!globalThis.__voicesynth.voice.getState().calibrationRun), 'Clicks started before confirmation');
 check(await dialog.evaluate(d => d.contains(document.activeElement)), 'Modal did not contain keyboard focus');
 await page.keyboard.press('Escape');
 await dialog.waitFor({ state: 'hidden' });
 await page.getByRole('button', { name: 'Timing test', exact: true }).click();
 await page.evaluate(async () => {
  const { engine, voice } = globalThis.__voicesynth, ctx = engine.getAudioContext();
  await voice.enableTestSignal(ctx.createBuffer(1, ctx.sampleRate * 90, ctx.sampleRate), ctx.currentTime + .05);
 });
 await page.getByRole('button', { name: 'Start timing test', exact: true }).click();
 await page.waitForFunction(() => globalThis.__voicesynth.voice.getState().calibrationRun?.phase === 'countdown');
 await dialog.getByRole('button', { name: 'Cancel', exact: true }).last().click();
 await page.waitForFunction(() => globalThis.__voicesynth.voice.getState().calibrationRun === null);
 // The countdown remains cancelable without changing the retained calibration.
 if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Done', exact: true }).click();
 check(await page.locator('summary').filter({ hasText: /^(Dev|Developer|Agent|Diagnostics)$/ }).count() === 0, 'Developer menu remains');
 check(await page.getByLabel('Command transcript', { exact: true }).count() === 0, 'Transcript harness remains');
 await page.getByRole('button', { name: /^Synth 1 / }).click();
 await page.getByRole('textbox', { name: 'Describe a sound' }).fill('warm electric piano');
 await page.getByRole('button', { name: 'Generate sound', exact: true }).click();
 await page.waitForFunction(() => globalThis.__voicesynth.research.getSnapshot().status === 'running');
 check(!!peer, 'Search did not connect automatically');
 await page.getByText('Generating sound…', { exact: true }).waitFor();
 check(await page.getByRole('progressbar', { name: 'Synth generation progress' }).getAttribute('value') === null, 'Invented a numeric progress value');
 // Wait for request bytes; DOM state updates before WebSocket message delivery.
 for (let i = 0; !request && i < 50; i++) await page.waitForTimeout(20);
 check(!!request, 'No sound request sent');
 await page.screenshot({ path: '/tmp/voicesynth-ui-generating.png' });
 peer.send(JSON.stringify({ type: 'research', jobId: request.id, status: 'running', progress: .4, candidates: [] }));
 await page.getByRole('progressbar', { name: 'Synth generation progress' }).waitFor();
 const cancelId = request.id;
 await page.getByRole('button', { name: 'Cancel', exact: true }).click();
 for (let i = 0; !messages.some(m => m.type === 'cancel-job' && m.jobId === cancelId) && i < 50; i++) await page.waitForTimeout(20);
 check(messages.some(m => m.type === 'cancel-job' && m.jobId === cancelId), 'Cancel did not reach current job');
 // Real sender streams silent synthetic PCM to the scripted service (no live key/model).
 await page.getByRole('button', { name: 'Enable hands-free commands', exact: true }).click();
 await page.waitForFunction(() => globalThis.__voicesynth.voice.getState().speech.status === 'ready');
 peer.send(JSON.stringify({ type: 'speech-transcript', utteranceId: 'ui-heard', clockId: transport.clockId, startFrame: Math.max(0, transport.currentFrame - 100), endFrame: transport.currentFrame, text: 'Groove, find a warm piano', outcome: 'held' }));
 await page.getByText('Groove, find a warm piano', { exact: true }).waitFor();
 check(await page.locator('.vs-voice').getAttribute('data-active') === 'true', 'Recognized request did not activate mic feedback');
 await page.emulateMedia({ reducedMotion: 'reduce' });
 check(await page.locator('.vs-mic-button').evaluate(el => getComputedStyle(el, '::after').animationName) === 'none', 'Reduced motion ignored');
 await page.emulateMedia({ reducedMotion: 'no-preference' });
 const layouts = [];
 for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [720, 900], [390, 844]]) {
  await page.setViewportSize({ width, height });
  const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  check(layout.scroll <= layout.width, `Horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
  layouts.push({ width, height });
 }
 await page.setViewportSize({ width: 1366, height: 768 });
 await page.screenshot({ path: '/tmp/voicesynth-ui-workspace.png' });
 check(snapshot && !snapshot.tracks.some(t => (t.notes?.length ?? 0) + (t.hits?.length ?? 0)), 'UI flow unexpectedly changed music');
 await page.getByRole('button', { name: 'Turn off hands-free commands', exact: true }).click();
 return { onboarding: 'prompt/countdown/cancel', research: 'immediate progress and current-job cancel', voice: 'scripted transcript plus actual synthetic speech sender', reducedMotion: true, layouts, evidence: 'Actual UI/WASM; scripted service, not human/STT/provider acceptance' };
}
