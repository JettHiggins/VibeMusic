import asyncio,base64,json,time,uuid
from pathlib import Path
import websockets
async def main():
    started=time.monotonic();stats={'messages':0,'available':None,'verified':0,'throughFrame':None,'errors':[]}
    async with websockets.connect('ws://127.0.0.1:8001/ws') as ws:
        async def receive():
            async for frame in ws:
                m=json.loads(frame);stats['messages']+=1
                if m['type']=='speech-status' and m.get('available') and stats['available'] is None:stats['available']=round(time.monotonic()-started,3)
                if m['type']=='speech-verified':
                    stats['verified']+=1;stats['throughFrame']=m['throughFrame']
                if m['type']=='error':stats['errors'].append(m['message'])
        reader=asyncio.create_task(receive())
        s=json.loads(Path('packages/contracts/fixtures/SessionState.json').read_text())
        await ws.send(json.dumps({'type':'session','session':s}))
        transport={'clockId':'throughput','sampleRate':44100,'currentFrame':0,'loopStartFrame':0,'playing':True,'recording':False,'pendingCommandIds':[]}
        await ws.send(json.dumps({'type':'transport','transport':transport}))
        stream=str(uuid.uuid4());pcm=base64.b64encode(bytes(8820)).decode()
        for i in range(30):
            await ws.send(json.dumps({'type':'speech-audio','streamId':stream,'seq':i,'clockId':'throughput','startFrame':i*4410,'endFrame':(i+1)*4410,'sampleRate':44100,'encoding':'pcm-s16le','data':pcm}))
            for j in range(3):
                transport['currentFrame']=i*4410+j*1470
                await ws.send(json.dumps({'type':'transport','transport':transport}))
                await asyncio.sleep(.1/3)
        await asyncio.sleep(.2);reader.cancel()
        try:await reader
        except asyncio.CancelledError:pass
    assert stats['available'] is not None and stats['verified']==30 and stats['throughFrame']==30*4410-1 and not stats['errors'], stats
    print(json.dumps({**stats,'seconds':round(time.monotonic()-started,3),'source':'direct real service with silent PCM, no STT/model output mocks or browser'}))
asyncio.run(main())
