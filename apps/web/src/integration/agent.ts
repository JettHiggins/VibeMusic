import {ClientMessage,ServerMessage,type AgentAdapter} from '@voicesynth/contracts';
/** Explicit connections: a dropped socket never replays old utterances or commands. */
export class WebSocketAgent implements AgentAdapter {
 private socket:WebSocket|null=null;
 private listeners=new Set<(message:ServerMessage)=>void>();
 onStatus:(connected:boolean)=>void=()=>{};
 onError:(error:Error)=>void=()=>{};
 get connected(){return this.socket?.readyState===WebSocket.OPEN;}
 constructor(private url='ws://127.0.0.1:8000/ws'){}
 connect():Promise<void>{
  if(this.connected)return Promise.resolve();
  if(this.socket) return Promise.reject(new Error('Connection already in progress'));
  return new Promise((resolve,reject)=>{
   const socket=this.socket=new WebSocket(this.url);
   socket.onopen=()=>{if(this.socket!==socket){socket.close();reject(new Error('Connection was replaced'));return;}this.onStatus(true);resolve();};
   socket.onmessage=({data})=>{
    if(this.socket!==socket)return;
    try{const message=ServerMessage.parse(JSON.parse(String(data)));this.listeners.forEach(fn=>fn(message));}
    catch(error){this.onError(new Error(`Invalid agent response: ${String(error)}`));}
   };
   socket.onerror=()=>{if(this.socket!==socket){reject(new Error('Connection was replaced'));return;}const error=new Error('Agent socket failed; start the local service and reconnect');this.onError(error);reject(error);};
   socket.onclose=()=>{if(this.socket!==socket){reject(new Error('Connection was replaced'));return;}this.socket=null;this.onStatus(false);reject(new Error('Agent connection closed'));};
  });
 }
 send(input:ClientMessage){
  const message=ClientMessage.parse(input);
  if(!this.connected)throw new Error('Agent is disconnected; command was not sent');
  this.socket!.send(JSON.stringify(message));
 }
 subscribe(listener:(message:ServerMessage)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
 dispose(){const socket=this.socket;this.socket=null;socket?.close();this.onStatus(false);this.listeners.clear();}
}
