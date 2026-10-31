from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# The browser lobby calls the HTTP create-room endpoint from the frontend port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://palm-flag-game-frontend.onrender.com",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class ConnectionManager:
    def __init__(self):
        # Each room ID maps to the players currently connected to that room.
        self.rooms: dict[str, list[dict]] = {}

    def create_room(self) -> str:
        room_id = uuid4().hex[:8].upper()
        self.rooms[room_id] = []
        return room_id

    async def broadcast(self, room_id: str, message: dict, exclude=None):
        for player in self.rooms.get(room_id, []):
            websocket = player["websocket"]
            if websocket is not exclude:
                await websocket.send_json(message)

    def disconnect(self, room_id: str, websocket: WebSocket):
        players = self.rooms.get(room_id, [])
        player = next(
            (p for p in players if p["websocket"] is websocket),
            None,
        )
        if player is not None:
            players.remove(player)
        if not players:
            self.rooms.pop(room_id, None)
        return player


manager = ConnectionManager()


@app.post("/rooms")
async def create_room():
    return {"room_id": manager.create_room()}


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    room_id = room_id.upper()
    await websocket.accept()
    player = None

    try:
        # The browser sends this join message immediately after the socket opens.
        join_message = await websocket.receive_json()
        if not isinstance(join_message, dict) or join_message.get("type") != "join":
            await websocket.send_json({"type": "error", "message": "Expected a join message."})
            await websocket.close(code=1008)
            return

        player_name = str(join_message.get("name", "")).strip()[:20]
        if not player_name:
            await websocket.send_json({"type": "error", "message": "Enter a valid player name."})
            await websocket.close(code=1008)
            return

        players = manager.rooms.get(room_id)
        if players is None:
            await websocket.send_json({"type": "error", "message": "Room not found. Create a room first."})
            await websocket.close(code=1008)
            return
        if len(players) >= 2:
            await websocket.send_json({"type": "error", "message": "This room is full."})
            await websocket.close(code=1008)
            return

        # Give the new player whichever team is free (so a rejoin can't make two Reds).
        taken = {p["team"] for p in players}
        team = "blue" if "blue" not in taken else "red"
        player = {"websocket": websocket, "name": player_name, "team": team}
        players.append(player)

        await websocket.send_json({
            "type": "joined",
            "room_id": room_id,
            "name": player_name,
            "team": team,
            "player_count": len(players),
            "players": [
                {"name": p["name"], "team": p["team"]}
                for p in players
            ],
        })
        await manager.broadcast(
            room_id,
            {"type": "player_joined", "name": player_name, "team": team},
            exclude=websocket,
        )

        while True:
            message = await websocket.receive_json()
            await manager.broadcast(
                room_id,
                {
                    "type": "player_message",
                    "name": player_name,
                    "team": team,
                    "data": message,
                },
                exclude=websocket,
            )
    except WebSocketDisconnect:
        if player is not None:
            manager.disconnect(room_id, websocket)
            await manager.broadcast(
                room_id,
                {"type": "player_left", "name": player["name"], "team": player["team"]},
            )