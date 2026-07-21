import asyncio
import websockets
import json
import uuid

async def test_ws():
    uri = "ws://localhost:8787/ws?sessionId=" + str(uuid.uuid4()) + "&name=Test"
    async with websockets.connect(uri) as websocket:
        await websocket.send(json.dumps({
            "type": "init",
            "sessionId": str(uuid.uuid4()),
            "customerName": "Test"
        }))
        
        await websocket.send(json.dumps({
            "type": "message",
            "text": "hello"
        }))
        
        while True:
            response = await websocket.recv()
            print("Received:", response)
            data = json.loads(response)
            if data.get("sender") == "ai" or data.get("sender") == "bot":
                break

asyncio.run(test_ws())
