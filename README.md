# Palm Flag Game

This recovered project contains the Three.js game, webcam hand-detection setup, and a small FastAPI WebSocket echo server. The WebSocket is a connection test; it does not yet broadcast game state between players.

## Project files
- `index.html`: page, game HUD, webcam element, and Three.js import map.
- `game.js`: arena, controls, game rules, hand-detection status, and network startup.
- `handinput.js`: MediaPipe model setup, webcam access, and hand-frame detection.
- `network.js`: browser WebSocket connection to `ws://localhost:8001/ws`.
- `models/hand_landmarker.task`: MediaPipe model file.
- `server/main.py`: FastAPI WebSocket echo endpoint.
- `server/requirements.txt`: Python server packages.

## Run the frontend
From this project's root folder in WSL:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/` in your browser and allow camera access.

## Run the backend
If Ubuntu reports that `ensurepip` is missing, install the venv support package first:

```bash
sudo apt update
sudo apt install python3.12-venv
```

Then, from a second terminal at the project root:

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

The frontend is served on port `8000`; FastAPI listens on port `8001`. Keep both terminals running. The browser connects to the backend over `ws://localhost:8001/ws`.

## Model download fallback
If `models/hand_landmarker.task` is missing:

```bash
curl -L "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task" -o models/hand_landmarker.task
```