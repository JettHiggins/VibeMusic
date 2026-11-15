import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ClientMessage,ServerMessage,SessionState,SessionCommand,triadFor,RHYTHM_CELLS} from '@voicesynth/contracts';

const examples=JSON.parse(readFileSync('packages/contracts/fixtures/PlaytestControls.json','utf8'));

test('playtest-round examples validate with the shared schemas',()=>{
 for(const example of examples){
  const schema=example.type==='session'?ClientMessage:ServerMessage;
  assert.equal(schema.safeParse(example).success,true,JSON.stringify(example).slice(0,120));
 }
});

test('new settings and chord notes are optional, so old sessions stay valid',()=>{
 const session=examples[0].session;
 const legacy={...session};delete legacy.rhythmSnap;delete legacy.chordMode;
 legacy.tracks=session.tracks.map((t:any)=>({...t,notes:t.notes.map(({chord,...n}:any)=>n)}));
 assert.equal(SessionState.safeParse(legacy).success,true);
});

test('invalid playtest controls are rejected',()=>{
 const session=examples[0].session,note=session.tracks[0].notes[0];
 const bad=(patch:any)=>SessionState.safeParse({...session,...patch}).success;
 assert.equal(bad({rhythmSnap:'triplet'}),false);
 assert.equal(bad({chordMode:'seventh'}),false);
 const withChord=(chord:any)=>SessionState.safeParse({...session,tracks:[{...session.tracks[0],notes:[{...note,chord}]},...session.tracks.slice(1)]}).success;
 assert.equal(withChord([64,67,71,74]),false); // at most 3 extra pitches (4 per firmware step)
 assert.equal(withChord([128]),false);
 const command=(operation:any)=>SessionCommand.safeParse({id:'x',expectedRevision:0,boundary:'immediate',operation}).success;
 assert.equal(command({type:'set-rhythm-snap',grid:'half'}),false);
 assert.equal(command({type:'set-chord-mode',mode:'triad',extra:1}),false);
 const transcript=examples[3];
 assert.equal(ServerMessage.safeParse({...transcript,outcome:'executed'}).success,false);
 assert.equal(ServerMessage.safeParse({...transcript,text:'x'.repeat(1001)}).success,false);
 assert.equal(ServerMessage.safeParse({...transcript,utteranceId:''}).success,false);
});

test('rhythm grid cells and diatonic triads',()=>{
 assert.deepEqual(RHYTHM_CELLS,{sixteenth:1,eighth:2,quarter:4});
 assert.deepEqual(triadFor(60,{root:0,scale:'major'}),[64,67]); // C major: C E G
 assert.deepEqual(triadFor(62,{root:0,scale:'major'}),[65,69]); // D minor chord in C major
 assert.deepEqual(triadFor(71,{root:0,scale:'major'}),[74,77]); // B diminished, wraps the octave
 assert.deepEqual(triadFor(57,{root:9,scale:'minor'}),[60,64]); // A minor: A C E
 assert.deepEqual(triadFor(60,null),[64,67]); // no key: major triad
 assert.deepEqual(triadFor(125,{root:0,scale:'major'}),[]); // above MIDI range dropped
});
