import type { AgentAdapter, EngineAdapter, ClientMessage, ServerMessage, SessionState, SessionCommand } from './index.ts';
import { SessionCommand as CommandSchema } from './index.ts';
export function createSession(): SessionState {
 return { version: 1, revision: 0, tempo: 120, bars: 4, beatsPerBar: 4, stepsPerBeat: 4, selected: {trackId:'drums',lane:'kick'}, tracks: ['synth-1','synth-2','synth-3','drums'].map((id) => ({id: id as SessionState['tracks'][number]['id'], name:id, muted:false, volume:0.7, patch:{engine:0,preset:0,parameters:{},engineRevision:'bac9c05ea7627449405aa10e48da21d75b6c8c56'},notes:[],hits:[]})) };
}
/** Deterministic contract mock: no audio, clock, recording, or real patch search. */
export class MockEngine implements EngineAdapter {
 private state = createSession();
 private listeners = new Set<(m: ClientMessage)=>void>();
 async initialize() {}
 getSession() { return structuredClone(this.state); }
 subscribe(fn: (m:ClientMessage)=>void) { this.listeners.add(fn); return ()=>{this.listeners.delete(fn);}; }
 dispatch(input:SessionCommand): ClientMessage {
 const command = CommandSchema.parse(input);
 const accepted = command.expectedRevision === this.state.revision && command.operation.type === 'select';
 if (accepted && command.operation.type === 'select') { this.state.selected=command.operation.target; this.state.revision++; }
 const ack:ClientMessage={type:'ack',commandId:command.id,status:accepted?'applied':'rejected',revision:this.state.revision,...(!accepted?{reason:command.expectedRevision !== this.state.revision?'stale revision':'mock supports select only'}:{})};
 this.listeners.forEach(fn=>fn(ack)); return ack;
 }
 dispose(){this.listeners.clear();}
}
export class MockAgent implements AgentAdapter {
 private listeners=new Set<(m:ServerMessage)=>void>();
 send(message:ClientMessage) { if(message.type==='sound-request') this.listeners.forEach(fn=>fn({type:'research',jobId:message.id,status:'complete',progress:1,candidates:[]})); }
 subscribe(fn:(m:ServerMessage)=>void){this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
 dispose(){this.listeners.clear();}
}
