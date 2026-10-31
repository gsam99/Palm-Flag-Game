const SERVER_URL = "http://localhost:8001";
const WEBSOCKET_URL = "ws://localhost:8001";

export async function createRoom() {
  const response = await fetch(`${SERVER_URL}/rooms`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Could not create room (HTTP ${response.status}).`);
  }
  const result = await response.json();
  return result.room_id;
}

export function connectToServer({
  roomId,
  playerName,
  onOpen = () => {},
  onMessage = () => {},
  onClose = () => {},
  onError = () => {},
} = {}) {
  const socket = new WebSocket(
    `${WEBSOCKET_URL}/ws/${encodeURIComponent(roomId)}`,
  );

  socket.addEventListener("open", (event) => {
    socket.send(JSON.stringify({ type: "join", name: playerName }));
    onOpen(event);
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      message = event.data;
    }
    onMessage(message);
  });

  socket.addEventListener("close", onClose);
  socket.addEventListener("error", onError);

  return {
    send(message) {
      if (socket.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket is not connected yet.");
        return false;
      }
      socket.send(JSON.stringify(message));
      return true;
    },
    close() {
      socket.close();
    },
  };
}