import { connectToServer, createRoom } from "./network.js";

const rulesView = document.querySelector("#rulesView");
const startChoice = document.querySelector("#startChoice");
const lobbyFooter = document.querySelector("#lobbyFooter");
const createView = document.querySelector("#createView");
const joinView = document.querySelector("#joinView");
const createNameInput = document.querySelector("#createPlayerName");
const joinNameInput = document.querySelector("#joinPlayerName");
const roomInput = document.querySelector("#roomIdInput");
const statusText = document.querySelector("#roomStatus");
const roomCodeRow = document.querySelector("#roomCodeRow");
const roomCodeDisplay = document.querySelector("#roomCodeDisplay");
const copyButton = document.querySelector("#copyRoomButton");
const enterButton = document.querySelector("#enterGameButton");
const createButton = document.querySelector("#createRoomButton");
const joinButton = document.querySelector("#joinRoomButton");
const lobby = document.querySelector("#lobby");

let network = null;
let currentRoomId = null;
let hasJoined = false;
let currentView = "rules";
let currentRoomNames = {};

function showView(view) {
  currentView = view;
  rulesView.hidden = view !== "rules";
  // The rules screen has no status line or buttons at the bottom.
  lobbyFooter.hidden = view === "rules";
  startChoice.hidden = view !== "start";
  createView.hidden = view !== "create";
  joinView.hidden = view !== "join";
  statusText.textContent = view === "start"
    ? "Choose Create game or Join a room to begin."
    : "Enter your name to continue.";
}

function applyRoomNames() {
  window.palmFlag?.setPlayerNames?.(currentRoomNames);
}

function getPlayerName(input) {
  const name = input.value.trim();
  if (!name) {
    statusText.textContent = "Please enter your player name first.";
    input.focus();
    return null;
  }
  return name;
}

function connectToRoom(roomId, playerName) {
  network?.close();
  hasJoined = false;
  currentRoomId = roomId;
  currentRoomNames = {};
  applyRoomNames();
  enterButton.hidden = true;
  statusText.textContent = "Connecting to the room…";
  createButton.disabled = true;
  joinButton.disabled = true;

  network = connectToServer({
    roomId,
    playerName,
    onOpen: () => console.log(`WebSocket open for room ${roomId}`),
    onMessage: (message) => {
      if (message.type === "joined") {
        hasJoined = true;
        const waiting = message.player_count < 2
          ? " Waiting for the other player."
          : " Both player slots are filled.";
        statusText.textContent = `Joined room ${roomId} as ${message.name} (${message.team.toUpperCase()}).${waiting}`;
        enterButton.hidden = false;
        window.palmFlag = window.palmFlag || {};
        window.palmFlag.network = network;
        window.palmFlag.room = { id: roomId, name: message.name, team: message.team };
        window.palmFlag.setLocalTeam?.(message.team);
        for (const player of message.players || []) {
          currentRoomNames[player.team] = player.name;
        }
        currentRoomNames[message.team] = message.name;
        applyRoomNames();
        console.log("Joined room:", message);
      } else if (message.type === "player_joined") {
        currentRoomNames[message.team] = message.name;
        applyRoomNames();
        statusText.textContent = `${message.name} joined as ${message.team.toUpperCase()}. The room is ready.`;
        console.log("Player joined:", message);
      } else if (message.type === "player_left") {
        delete currentRoomNames[message.team];
        applyRoomNames();
        statusText.textContent = `${message.name} left the room.`;
        console.log("Player left:", message);
      } else if (message.type === "error") {
        statusText.textContent = message.message;
      } else if (message.type === "player_message") {
        const data = message.data;
        if (data?.type === "move") {
          window.palmFlag?.setRemotePlayerState?.(message.team, data);
        } else if (data?.type === "shoot") {
          window.palmFlag?.remoteShoot?.(message.team, data);
        } else if (["pickup", "hit", "score", "restart"].includes(data?.type)) {
          // Flag, hit, score and game-over updates decided by the referee (Blue).
          window.palmFlag?.applyRoomEvent?.(data);
        }
      }
    },
    onClose: () => {
      if (hasJoined) statusText.textContent = "Disconnected from the room.";
      createButton.disabled = false;
      joinButton.disabled = false;
    },
    onError: (error) => {
      console.error("WebSocket error:", error);
      statusText.textContent = "Could not connect. Check that FastAPI is running on port 8001.";
      createButton.disabled = false;
      joinButton.disabled = false;
    },
  });
}

document.querySelector("#closeRulesView").addEventListener("click", () => showView("start"));
document.querySelector("#showRulesView").addEventListener("click", () => showView("rules"));
document.querySelector("#showCreateView").addEventListener("click", () => showView("create"));
document.querySelector("#showJoinView").addEventListener("click", () => showView("join"));
document.querySelector("#backFromCreate").addEventListener("click", () => showView("start"));
document.querySelector("#backFromJoin").addEventListener("click", () => showView("start"));

createButton.addEventListener("click", async () => {
  const name = getPlayerName(createNameInput);
  if (!name) return;

  createButton.disabled = true;
  joinButton.disabled = true;
  statusText.textContent = "Creating your game room…";

  try {
    const roomId = await createRoom();
    roomCodeDisplay.textContent = roomId;
    roomCodeRow.hidden = false;
    copyButton.hidden = false;
    statusText.textContent = `Room ${roomId} created. Connecting you as the first player…`;
    connectToRoom(roomId, name);
  } catch (error) {
    console.error(error);
    statusText.textContent = `${error.message} Check that FastAPI is running on port 8001.`;
    createButton.disabled = false;
    joinButton.disabled = false;
  }
});

joinButton.addEventListener("click", () => {
  const name = getPlayerName(joinNameInput);
  if (!name) return;
  const roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) {
    statusText.textContent = "Enter the room ID shared by the game creator.";
    roomInput.focus();
    return;
  }
  connectToRoom(roomId, name);
});

copyButton.addEventListener("click", async () => {
  if (!currentRoomId) return;
  try {
    await navigator.clipboard.writeText(currentRoomId);
    statusText.textContent = `Room ID ${currentRoomId} copied. Share it with the other player.`;
  } catch {
    statusText.textContent = `Share this room ID with the other player: ${currentRoomId}`;
  }
});

enterButton.addEventListener("click", () => {
  if (hasJoined) lobby.classList.add("hidden");
});