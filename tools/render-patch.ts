/** stdin: JSON RenderRequest. stdout: raw little-endian mono float32 at 44100 Hz. */
import {renderPatch} from './offline-renderer.ts';
try{
 const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
 const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 const audio=await renderPatch(input,process.env.GROOVE_ENGINE_ASSETS);
 const bytes=Buffer.alloc(audio.length*4);for(let i=0;i<audio.length;i++)bytes.writeFloatLE(audio[i],i*4);
 process.stdout.write(bytes);
}catch(error){process.stderr.write(String(error)+'\n');process.exitCode=1;}
