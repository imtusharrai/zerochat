import asyncio
import websockets
import json
import uuid

async def test_ws():
    uri = "wss://zerochat.traiinc.workers.dev/ws?sessionId=" + str(uuid.uuid4()) + "&name=Test"
    async with websockets.connect(uri) as websocket:
        await websocket.send(json.dumps({
            "type": "init",
            "sessionId": str(uuid.uuid4()),
            "customerName": "Test"
        }))
        response = await websocket.recv()
        print("Received:", response)
        
        await websocket.send(json.dumps({
            "type": "message",
            "text": "hello"
        }))
        
        response = await websocket.recv()
        print("Received:", response)

asyncio.run(test_ws())
