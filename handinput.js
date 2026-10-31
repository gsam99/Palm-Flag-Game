import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

// Create MediaPipe's Hand Landmarker for live webcam video.
export async function createHandInput() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "./models/hand_landmarker.task",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

// Ask the browser for camera permission and connect its stream to the video element.
export async function startWebcam(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is unavailable. Use localhost or HTTPS in a supported browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });

  video.srcObject = stream;
  await video.play();
}

// Detect hands whenever the webcam has produced a new frame.
export function detectVideoFrames(handLandmarker, video, onResults) {
  let lastVideoTime = -1;
  let animationFrameId;

  function renderLoop() {
    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.currentTime !== lastVideoTime
    ) {
      const results = handLandmarker.detectForVideo(video, performance.now());
      onResults(results);
      lastVideoTime = video.currentTime;
    }

    animationFrameId = requestAnimationFrame(renderLoop);
  }

  animationFrameId = requestAnimationFrame(renderLoop);
  return () => cancelAnimationFrame(animationFrameId);
}