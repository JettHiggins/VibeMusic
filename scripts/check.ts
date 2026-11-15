/** Run checks without POSIX shell syntax or relying on a Windows python3 alias. */
import {spawnSync} from 'node:child_process';
const python=process.env.VOICESYNTH_PYTHON??(process.platform==='win32'?'python':'python3');
const checks:[string,string[]][]=[
 [process.execPath,['node_modules/typescript/bin/tsc','--noEmit']],
 [process.execPath,['--import','tsx','scripts/export-contracts.ts']],
 [python,['scripts/check_contracts.py']]
];
for(const [command,args] of checks){
 const result=spawnSync(command,args,{stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
