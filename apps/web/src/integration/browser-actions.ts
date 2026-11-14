import {BrowserAction,ClientMessage,type BrowserActionAdapter,type BrowserStatus,type ClientMessage as Client} from '@voicesynth/contracts';

/** No advertised capability until the real WS2 executor implements all four methods. */
export function supportsBrowserActions(input:object):input is BrowserActionAdapter{
 return 'getBrowserStatus' in input&&typeof input.getBrowserStatus==='function'
  &&'handleBrowserAction' in input&&typeof input.handleBrowserAction==='function'
  &&'subscribeBrowserActions' in input&&typeof input.subscribeBrowserActions==='function'
  &&'cancelBrowserActions' in input&&typeof input.cancelBrowserActions==='function';
}

/** Routes orchestration only. Measurements, validation and idempotent execution stay in WS2. */
export class BrowserActionRouter{
 private input:BrowserActionAdapter|null=null;
 private off:(()=>void)|null=null;
 private active=false;
 private disposed=false;
 private generation=0;
 private lastStatus:BrowserStatus|null=null;
 private lastSentStatus:string|null=null;
 private pending=new Map<string,BrowserAction>();
 // Retain IDs across reconnects so late old results cannot bind a new request with the same ID.
 private known=new Map<string,{generation:number;payload:string}>();
 constructor(private send:(m:Client)=>void,private connected:()=>boolean,private clock:()=>string|undefined,private error:(e:Error)=>void){}
 setAdapter(input:BrowserActionAdapter|null){
  if(this.disposed||input===this.input)return;
  this.off?.();this.off=null;this.generation++;
  for(const request of this.pending.values())this.reject(request,'Input controller was replaced');
  this.pending.clear();this.cancel('Input controller was replaced');this.input=input;this.lastSentStatus=null;
  if(this.active)this.listen();
 }
 connectionChanged(connected:boolean){
  if(this.disposed)return;
  if(connected&&this.active){this.syncStatus();return;}
  this.off?.();this.off=null;this.active=connected;this.generation++;this.pending.clear();this.lastSentStatus=null;
  if(connected)this.listen();else this.cancel('Agent disconnected');
 }
 private listen(){
  if(!this.input)return;
  const input=this.input,generation=this.generation;
  try{
   this.off=input.subscribeBrowserActions(m=>{
    if(this.disposed||!this.active||!this.connected()||generation!==this.generation||input!==this.input)return;
    const parsed=ClientMessage.safeParse(m);
    if(!parsed.success||!['browser-status','browser-action-ack'].includes(parsed.data.type)){this.error(new Error('Invalid browser input response'));return;}
    const message=parsed.data;
    if(message.type==='browser-status'){this.status(message);return;}
    if(message.type==='browser-action-ack'){
     const request=this.pending.get(message.id);
     if(!request||message.clockId!==request.clockId)return;
     if(message.status!=='running')this.pending.delete(message.id);
     this.send(message);
    }
   });
   this.syncStatus();
  }catch(e){this.error(new Error(`Input controller unavailable: ${String(e)}`));}
 }
 syncStatus(){
  if(this.disposed||!this.active||!this.connected()||!this.input)return;
  try{
   const status=this.input.getBrowserStatus();if(!status)return;
   const parsed=ClientMessage.safeParse(status);
   if(!parsed.success||parsed.data.type!=='browser-status')throw new Error('Invalid browser input status');
   this.status(parsed.data);
  }catch(e){this.error(new Error(`Cannot read input status: ${String(e)}`));}
 }
 private status(status:BrowserStatus){
  if(!this.clock()||status.clockId!==this.clock())return;
  if(status.activeAction&&this.known.has(status.activeAction.id)&&this.known.get(status.activeAction.id)!.generation!==this.generation)return;
  if(this.lastStatus?.clockId===status.clockId&&status.inputRevision<this.lastStatus.inputRevision){this.error(new Error('Input status revision moved backwards'));return;}
  const serialized=JSON.stringify(status);if(serialized===this.lastSentStatus)return;
  this.lastStatus=status;this.lastSentStatus=serialized;this.send(status);
 }
 handle(request:BrowserAction){
  if(this.disposed||!this.active||!this.connected())return;
  const parsed=BrowserAction.safeParse(request);
  if(!parsed.success){this.error(new Error('Invalid browser action'));return;}
  request=parsed.data;
  const payload=JSON.stringify(request),known=this.known.get(request.id);
  if(known&&(known.generation!==this.generation||known.payload!==payload)){this.reject(request,'Input action ID was reused with a different request or connection');return;}
  if(!known&&this.known.size>=4096){this.reject(request,'Input request limit reached; reload before starting another input action');return;}
  if(!known)this.known.set(request.id,{generation:this.generation,payload});
  if(!this.input||!this.off){this.reject(request,'Browser input controls are unavailable; no action was performed');return;}
  this.pending.set(request.id,request);
  try{this.input.handleBrowserAction(request);}
  catch(e){
   if(this.pending.delete(request.id))this.reject(request,`Input action failed: ${String(e)}`);
   else this.error(new Error(`Input controller failed after settling the action: ${String(e)}`));
  }
 }
 private reject(request:BrowserAction,reason:string){
  if(this.active&&this.connected())this.send({type:'browser-action-ack',id:request.id,clockId:request.clockId,inputRevision:request.expectedInputRevision,status:'rejected',reason});
 }
 private cancel(reason:string){try{this.input?.cancelBrowserActions(reason);}catch(e){this.error(new Error(`Cannot cancel input action: ${String(e)}`));}}
 dispose(){
  if(this.disposed)return;this.disposed=true;this.active=false;this.generation++;
  this.off?.();this.off=null;this.pending.clear();this.cancel('Input bridge disposed');this.input=null;this.known.clear();
 }
}
