// Opt-in: needs the built engine assets and the Python service dependencies.
//   VOICESYNTH_INTEGRATION=1 VOICESYNTH_PYTHON=<python> node --import tsx --test services/agent/tests/integration/research-engine.test.ts
// Uses the real WASM engine core, the production WebSocket adapter and coordinator, and the real offline
// renderer. The embedder is the MOCK one, so this checks audition/accept/undo plumbing, not sound matching.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSession, type ClientMessage, type EngineAdapter, type ServerMessage} from '../../../../packages/contracts/src/index.ts';
import {EngineCore} from '../../../../apps/web/src/engine/core.ts';
import {WebSocketAgent} from '../../../../apps/web/src/integration/agent.ts';
import {ResearchController} from '../../../../apps/web/src/integration/research.ts';
import {SessionCoordinator} from '../../../../apps/web/src/integration/coordinator.ts';

const enabled = process.env.VOICESYNTH_INTEGRATION === '1';
const LOOP = 44100 * 8; // four bars at 120 BPM

test('research candidates from real engine audio are accepted and undone by the real engine', {skip: !enabled, timeout: 180000}, async () => {
  const reservation = createServer();
  await new Promise<void>(r => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as {port: number}).port;
  await new Promise<void>(r => reservation.close(() => r()));
  const corpus = mkdtempSync(join(tmpdir(), 'groove-corpus-'));
  const child = spawn(process.env.VOICESYNTH_PYTHON ?? 'python3',
    ['-m', 'uvicorn', 'groove_agent.app:app', '--app-dir', 'services/agent', '--host', '127.0.0.1', '--port', String(port)],
    {stdio: ['ignore', 'ignore', 'pipe'], env: {...process.env, GROOVE_LLM: '', OPENROUTER_API_KEY: '', GROOVE_STT: '', GROOVE_VOICE_RESEARCH: '0', GROOVE_RESEARCH: 'sloop', GROOVE_EMBEDDER: 'mock',
      GROOVE_CORPUS_DIR: corpus, GROOVE_PUBLIC_URL: `http://127.0.0.1:${port}`}});
  let logs = '';
  let coordinator: SessionCoordinator | undefined;
  let agent: WebSocketAgent | undefined;
  let panel: ResearchController | undefined;
  try {
    await new Promise<void>((done, fail) => {
      const timeout = setTimeout(() => fail(new Error('Service startup timeout: ' + logs)), 20000);
      child.once('error', e => { clearTimeout(timeout); fail(e); });
      child.once('exit', code => { clearTimeout(timeout); fail(new Error(`Service exited ${code}: ${logs}`)); });
      child.stderr.on('data', data => { logs = (logs + data.toString()).slice(-4000); if (logs.includes('Uvicorn running')) { clearTimeout(timeout); done(); } });
    });
    const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json() as {language: string; speech: string};
    assert.equal(health.language, 'parser');assert.equal(health.speech, 'not configured');
    const dir = 'apps/web/public/engine';
    const module = await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
    const {FirmwareAudio} = await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
    const session = createSession();
    session.selected = {trackId: 'synth-1'};
    session.tracks[0].patch.engine = 1;
    for (let bar = 0; bar < 4; bar++) session.tracks[0].notes.push({id: `note-${bar}`, step: bar * 16, duration: 8, midi: [60, 64, 67, 64][bar], velocity: 0.7});
    const listeners = new Set<(m: ClientMessage) => void>();
    const core = new EngineCore(new FirmwareAudio(module), JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8')), session, 'integration-clock', m => listeners.forEach(fn => fn(m)));
    const engine: EngineAdapter = {initialize: async () => {}, getSession: () => core.getSession(), dispatch: c => core.dispatch(c),
      subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, dispose: () => listeners.clear()};
    agent = new WebSocketAgent(`ws://127.0.0.1:${port}/ws`);
    const socket = agent;
    coordinator = new SessionCoordinator(engine, socket, () => socket.connected);
    const bridge = coordinator;
    panel = new ResearchController(engine, socket, () => socket.connected);
    socket.onStatus = connected => { if (connected) bridge.sync(); };
    const errors: string[] = [];
    const research: Extract<ServerMessage, {type: 'research'}>[] = [];
    const commands: Extract<ServerMessage, {type: 'command'}>[] = [];
    bridge.onError = e => errors.push(e.message);
    bridge.onMessage = m => { if (m.type === 'error') errors.push(m.message); if (m.type === 'research') research.push(m); if (m.type === 'command') commands.push(m); };
    await socket.connect();

    let frame = 0;
    const render = (count: number) => {
      const left = new Float32Array(count), right = new Float32Array(count);
      core.render(left, right, frame); frame += count;
      listeners.forEach(fn => fn({type: 'transport', transport: core.transport()}));
      return Math.sqrt(left.reduce((sum, v) => sum + v * v, 0) / count);
    };
    const until = async (what: string, ready: () => boolean, ms: number) => {
      const start = Date.now();
      while (!ready()) {
        if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}: ${errors.join('; ')} ${logs.slice(-600)}`);
        await new Promise(r => setTimeout(r, 50));
      }
    };
    render(128);
    core.dispatch({id: 'play', expectedRevision: 0, boundary: 'immediate', operation: {type: 'play', playing: true}});
    const before = render(LOOP);
    assert.ok(before > 0.001, 'demo melody is audible before the search');
    const notes = core.getSession().tracks[0].notes;
    const revision = core.getSession().revision;

    // Describe a sound; the corpus (every factory preset) is rendered by the real engine on first use.
    panel.request('synth-1', '80s electric piano');
    await until('research to finish', () => research.some(m => m.status !== 'running'), 150000);
    const final = research.at(-1)!;
    assert.equal(final.status, 'complete', final.error);
    assert.equal(final.candidates.length, 5);
    assert.deepEqual(panel.getSnapshot().candidates, final.candidates);
    assert.ok(research.findIndex(m => m.candidates.length > 0) < research.length - 1, 'retrieval arrives before completion');
    const preview = await fetch(final.candidates[0].previewUrl);
    assert.equal(preview.status, 200);
    assert.equal(Buffer.from(await preview.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
    assert.ok(final.candidates.every(c => c.provenance.includes('SLOOP WASM offline')));

    // Accept immediately through the real service while the engine clock remains frozen mid-loop.
    const acceptFrame=core.transport().currentFrame;
    bridge.submitTranscript('use number two');
    await until('immediate apply-patch', () => core.getSession().revision === revision + 1, 5000);
    assert.equal(commands.at(-1)!.command.boundary,'immediate');
    assert.equal(core.transport().currentFrame,acceptFrame,'accept must not need a loop/audio-frame advance');
    assert.equal(core.transport().pendingCommandIds.length,0);
    const during = render(LOOP);
    assert.ok(during > 0.001, 'playback continues while the patch is pending and after it lands');
    assert.deepEqual(core.getSession().tracks[0].patch, final.candidates[1].patch);
    assert.deepEqual(core.getSession().tracks[0].notes, notes, 'accepting a patch preserves the melody');
    assert.equal(core.getSession().revision, revision + 1);
    const after = render(LOOP);
    assert.ok(after > 0.001, 'accepted patch is audible on the existing melody');

    // The browser candidate controls also apply the exact chosen patch to the original search track.
    panel.accept(final.candidates[0].id);
    assert.equal(panel.getSnapshot().acceptance?.status, 'applied');
    render(LOOP);
    assert.equal(panel.getSnapshot().acceptance?.status, 'applied');
    assert.deepEqual(core.getSession().tracks[0].patch, final.candidates[0].patch);
    assert.deepEqual(core.getSession().tracks[0].notes, notes);
    core.dispatch({id: 'undo-panel', expectedRevision: core.getSession().revision, boundary: 'next-loop', operation: {type: 'undo'}});
    render(LOOP);

    // Undo now restores the earlier sound immediately, without waiting for or stopping playback.
    await new Promise(r => setTimeout(r, 300));
    const beforeUndoRevision = core.getSession().revision;
    bridge.submitTranscript('undo');
    await until('immediate undo to apply', () => core.getSession().revision === beforeUndoRevision + 1, 5000);
    const undo = commands.at(-1)!.command;
    assert.equal(undo.operation.type, 'undo');
    assert.equal(undo.boundary, 'immediate');
    assert.equal(core.transport().pendingCommandIds.length, 0, 'Undo must not wait for a future loop');
    assert.equal(core.transport().playing, true);
    assert.deepEqual(core.getSession().tracks[0].patch, session.tracks[0].patch);
    assert.deepEqual(core.getSession().tracks[0].notes, notes);
    assert.ok(render(LOOP) > 0.001, 'restored patch continues to play after immediate Undo');
    assert.deepEqual(errors, []);
    console.log(`rms before ${before.toFixed(4)}, boundary loop ${during.toFixed(4)}, after ${after.toFixed(4)}; candidates: ${final.candidates.map(c => c.provenance.split(';')[0]).join(' | ')}`);
  } finally {
    panel?.dispose(); coordinator?.dispose(); agent?.dispose(); child.kill();
    if (child.exitCode === null) await new Promise<void>(done => { child.once('exit', () => done()); setTimeout(() => { child.kill('SIGKILL'); done(); }, 2000).unref(); });
    rmSync(corpus, {recursive: true, force: true});
  }
});
