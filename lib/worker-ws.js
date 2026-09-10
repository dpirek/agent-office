import crypto from "node:crypto";
import { acceptWebSocket, closeSocket, decodeFrames, sendJson } from "./ws.js";

const MAX_WORKER_MESSAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_WORKER_HEARTBEAT_INTERVAL_MS = 15_000;

function safeTokenEqual(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function bearerToken(value) {
  return /^Bearer\s+(.+)$/i.exec(String(value || ""))?.[1] || "";
}

export function createWorkerWebSocketHandler({
  subAgentManager,
  getToken = () => "",
  getTokenName = () => "",
  heartbeatIntervalMs = DEFAULT_WORKER_HEARTBEAT_INTERVAL_MS,
}) {
  return function handleWorkerWebSocket(socket, req) {
    if (!acceptWebSocket(socket, req)) return;
    const connectionId = crypto.randomUUID();
    let workerName = null;
    let frameBuffer = Buffer.alloc(0);
    let fragments = [];
    let disconnected = false;
    let awaitingHeartbeat = false;
    const registrationTimer = setTimeout(() => closeSocket(socket, 4000, "Registration required"), 10_000);
    registrationTimer.unref?.();
    const disconnect = (reason = "Worker disconnected.") => {
      if (disconnected) return;
      disconnected = true;
      clearTimeout(registrationTimer);
      clearInterval(heartbeatTimer);
      subAgentManager.unregisterConnection(connectionId, reason);
    };
    const heartbeatTimer = setInterval(() => {
      if (!workerName || disconnected) return;
      if (awaitingHeartbeat) {
        disconnect("Worker heartbeat timed out.");
        if (typeof socket.destroy === "function") socket.destroy();
        else closeSocket(socket, 4008, "Heartbeat timed out");
        return;
      }
      awaitingHeartbeat = true;
      try {
        socket.write(Buffer.from([0x89, 0x00]));
      } catch {
        disconnect("Worker heartbeat failed.");
        socket.destroy?.();
      }
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
    const headerToken = bearerToken(req.headers.authorization);
    const send = (payload) => sendJson(socket, payload);

    socket.on("data", async (chunk) => {
      awaitingHeartbeat = false;
      try {
        frameBuffer = Buffer.concat([frameBuffer, chunk]);
        const decoded = decodeFrames(frameBuffer);
        frameBuffer = decoded.remaining;
        for (const frame of decoded.messages) {
          if (frame.type === "close") {
            disconnect("Worker closed the connection.");
            closeSocket(socket);
            return;
          }
          if (frame.type === "ping") {
            socket.write(Buffer.concat([Buffer.from([0x8a, frame.payload.length]), frame.payload]));
            continue;
          }
          if (frame.type === "text") {
            if (!frame.fin) { fragments = [frame.payload]; continue; }
            fragments = [frame.payload];
          } else if (frame.type === "continuation") {
            fragments.push(frame.payload);
            if (!frame.fin) continue;
          } else continue;
          const size = fragments.reduce((total, part) => total + part.length, 0);
          if (size > MAX_WORKER_MESSAGE_BYTES) throw new Error("Worker message is too large.");
          const payload = JSON.parse(Buffer.concat(fragments).toString("utf8"));
          fragments = [];

          if (!workerName) {
            if (payload.type !== "register" || !payload.worker) throw new Error("The first message must register the worker.");
            if (!payload.worker.capabilities || typeof payload.worker.capabilities !== "object") throw new Error("Worker capabilities are required.");
            const suppliedToken = payload.credentials?.token || headerToken;
            const expectedToken = String(getToken() || "").trim();
            if (!expectedToken) throw new Error("Worker registration is disabled until AI_HARNESS_WORKER_TOKEN is configured.");
            if (!safeTokenEqual(suppliedToken, expectedToken)) throw new Error("Worker credentials were rejected.");
            const worker = subAgentManager.registerWorker({
              ...payload.worker,
              tokenName: String(getTokenName() || "").trim(),
            }, {
              connectionId,
              send,
              close: (code, reason) => closeSocket(socket, code, reason),
            });
            workerName = worker.name;
            clearTimeout(registrationTimer);
            send({ type: "registered", connectionId, worker });
            continue;
          }

          if (payload.type === "task_update") {
            const update = await subAgentManager.receiveUpdate(workerName, payload, connectionId);
            send({ type: "task_update_ack", ...update });
          } else if (["direct_message", "direct_message_response"].includes(payload.type)) {
            const update = subAgentManager.receiveDirectMessage(workerName, payload, connectionId);
            send({ type: "direct_message_ack", ...update });
          } else if (payload.type === "ping") {
            send({ type: "pong", at: Date.now() });
          } else {
            throw new Error("Expected a task update or direct message response.");
          }
        }
      } catch (error) {
        send({ type: "error", error: error.message });
        disconnect(`Worker protocol error: ${error.message}`);
        closeSocket(socket, 4002, "Worker protocol error");
      }
    });
    socket.on("end", () => disconnect());
    socket.on("error", () => disconnect("Worker connection failed."));
    socket.on("close", () => disconnect());
  };
}

export { DEFAULT_WORKER_HEARTBEAT_INTERVAL_MS };
