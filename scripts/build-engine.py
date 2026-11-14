"""Build pinned upstream DSP locally; optionally use the documented Docker image."""
import argparse
import os
import shutil
import subprocess
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('--docker', action='store_true')
parser.add_argument('--test', action='store_true')
parser.add_argument('--docker-network', default='default', help='Docker build network; use host if bridge egress is unavailable')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
if args.docker:
    subprocess.run(['docker','build','--network='+args.docker_network,'-t','voicesynth-engine','-f','tools/Dockerfile.engine','.'],cwd=root,check=True)
    options = ['--user', f'{os.getuid()}:{os.getgid()}'] if hasattr(os, 'getuid') else []
    if Path('/sys/fs/selinux/enforce').exists(): options += ['--security-opt', 'label=disable']
    command = ['docker','run','--rm',*options,'-v',f'{root}:/workspace','voicesynth-engine','python3','scripts/build-engine.py']
    if args.test: command.append('--test')
    subprocess.run(command,cwd=root,check=True)
else:
    subprocess.run(['python3','tools/build_preview.py'],cwd=root/'vendor/sloop',check=True)
    if args.test: subprocess.run(['sh','tests/run_preview_tests.sh'],cwd=root/'vendor/sloop',check=True)
    dest = root/'apps/web/public/engine'
    dest.mkdir(parents=True,exist_ok=True)
    for name in ('sloop-preview.wasm','preview-worklet.js'):
        shutil.copy(root/'vendor/sloop/build/preview'/name,dest/name)
    compiler = shutil.which('clang') or shutil.which('cc')
    if not compiler: raise SystemExit('Native clang or cc required for engine metadata')
    binary = root/'vendor/sloop/build/preview/engine-metadata'
    subprocess.run([compiler,'-O2','-fwrapv','-fno-strict-aliasing','-w','-I'+str(root/'vendor/sloop/build/gen'),'-I'+str(root/'vendor/sloop/firmware/src'),str(root/'tools/engine-metadata.c'),'-o',str(binary)],check=True)
    metadata = subprocess.check_output([str(binary)])
    (dest/'metadata.json').write_bytes(metadata)
    exports = ['preview_'+name for name in ('init','buffer','frames','rate','track','param','global','select','step','locks','fm6','sample','kit','hit','note','play','position','panic','render')]+['vs_beat','vs_phase','vs_playing','vs_render','vs_note','vs_erase_note']
    source = root/'tools/engine-browser.c'
    target = dest/'voicesynth.wasm'
    include = ['-I'+str(root/'vendor/sloop/build/gen'),'-I'+str(root/'vendor/sloop/firmware/src')]
    emcc = shutil.which('emcc')
    if emcc:
        subprocess.run([emcc,str(source),'-O2','-fwrapv','-fno-strict-aliasing','-w',*include,'--no-entry','-sSTANDALONE_WASM=1','-sFILESYSTEM=0','-sINITIAL_MEMORY=16777216','-sSTACK_SIZE=131072','-sEXPORTED_FUNCTIONS='+str(['_'+n for n in exports]),'-o',str(target)],check=True)
    else:
        shim=root/'vendor/sloop/tools/wasm_shim'
        mem=root/'vendor/sloop/build/preview/mem.o'
        subprocess.run(['clang','--target=wasm32','-O2','-fno-builtin','-ffreestanding','-c',str(shim/'mem.c'),'-o',str(mem)],check=True)
        subprocess.run(['clang','--target=wasm32','-O2','-fwrapv','-fno-strict-aliasing','-ffreestanding','-nostdlib','-w','-I'+str(shim),*include,str(source),str(mem),'-Wl,--no-entry','-Wl,--export-memory','-Wl,--initial-memory=16777216','-Wl,-z,stack-size=131072',*['-Wl,--export='+n for n in exports],'-o',str(target)],check=True)
        mem.unlink()
    print('Engine assets, clock extension, and firmware metadata staged in apps/web/public/engine')
