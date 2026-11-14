/** A five-millisecond stereo de-click envelope, independent of musical timing. */
export class OutputTransition {
 private readonly weights:Float32Array;
 private position=0;
 private fromLeft=0;
 private fromRight=0;
 private lastLeft=0;
 private lastRight=0;
 private rendered=false;
 constructor(sampleRate:number){
  const frames=Math.max(2,Math.round(sampleRate*0.005));
  this.weights=Float32Array.from({length:frames},(_,i)=>(1-Math.cos(Math.PI*i/(frames-1)))/2);
  this.position=frames;
 }
 begin(){
  if(!this.rendered)return;
  this.fromLeft=this.lastLeft;this.fromRight=this.lastRight;this.position=0;
 }
 /** Write directly into the output channels without allocating per-sample objects. */
 write(left:Float32Array,right:Float32Array,index:number,l:number,r:number){
  if(this.position<this.weights.length){
   const blend=this.weights[this.position++];
   l=this.fromLeft*(1-blend)+l*blend;r=this.fromRight*(1-blend)+r*blend;
  }
  left[index]=l;right[index]=r;
  this.lastLeft=left[index];this.lastRight=right[index];this.rendered=true;
 }
}
