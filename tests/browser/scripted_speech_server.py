"""Explicit TEST-ONLY peer; never a recognizer. Run on localhost with
VOICESYNTH_SCRIPTED_SPEECH=1 PYTHONPATH=services/agent .venv/bin/python -m uvicorn \
  scripted_speech_server:app --app-dir tests/browser --host 127.0.0.1 --port 8766
The /plan endpoint supplies synthetic exclusion frames; it is not a production protocol.
"""
import os
if os.environ.get('VOICESYNTH_SCRIPTED_SPEECH') != '1':
    raise RuntimeError('This SCRIPTED test producer requires VOICESYNTH_SCRIPTED_SPEECH=1')
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from groove_agent.contracts import validate
from groove_agent.speech import StreamTracker, decode_chunk
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173','http://127.0.0.1:5173'], allow_methods=['POST'], allow_headers=['Content-Type'])
plan = {}
@app.post('/plan')
async def configure(value: dict):
    plan.clear(); plan.update(value)
    return {'provider': 'SCRIPTED synthetic integration peer'}
@app.websocket('/ws')
async def peer(socket: WebSocket):
    await socket.accept()
    tracker, first, sent_stop = StreamTracker(), {}, False
    revision, transport = 0, None
    async def send(message):
        validate('ServerMessage', message)
        await socket.send_json(message)
    try:
        while True:
            message = await socket.receive_json()
            validate('ClientMessage', message)
            kind = message['type']
            if kind == 'session': revision = message['session']['revision']
            if kind == 'transport': transport = message['transport']
            if kind != 'speech-audio': continue
            assert transport and message['clockId'] == transport['clockId']
            chunk = decode_chunk(message, transport['sampleRate'])
            if tracker.accept(chunk):
                first[chunk.stream_id] = chunk.start_frame
                await send({'type':'speech-status','streamId':chunk.stream_id,'available':True,'provider':'SCRIPTED synthetic integration peer (NOT STT)'})
            if plan.get('stall_verification'):
                continue  # TEST ONLY: recognizer advertises ready but never completes classification
            begin, end = plan['startFrame'], plan['endFrame']
            bound = chunk.end_frame - 1
            if begin <= bound <= end: bound = begin - 1
            if not sent_stop and chunk.end_frame > end:
                assert transport['recording'], 'The scripted wake span must occur during a take'
                await send({'type':'command-span','utteranceId':'SCRIPTED-stop','clockId':chunk.clock_id,'startFrame':begin,'endFrame':end})
                await send({'type':'command','command':{'id':'SCRIPTED-stop:cmd','expectedRevision':revision,'boundary':'immediate','operation':{'type':'stop-recording'}}})
                sent_stop = True
            if bound >= first[chunk.stream_id]:
                await send({'type':'speech-verified','streamId':chunk.stream_id,'clockId':chunk.clock_id,'fromFrame':first[chunk.stream_id],'throughFrame':bound})
    except WebSocketDisconnect:
        pass
