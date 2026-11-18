const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));

const ARENA = { width: 3200, height: 2200 };
const players = new Map();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const randomSpawn = () => ({
  x: 500 + Math.random() * (ARENA.width - 1000),
  y: 400 + Math.random() * (ARENA.height - 800)
});
const colors = ["#ff5b5b", "#55c8ff", "#ffe05b", "#a77bff", "#58e39a", "#ff9c42"];

io.on("connection", socket => {
  socket.emit("welcome", { id: socket.id, arena: ARENA });
  socket.on("join", data => {
    if (players.has(socket.id)) return;
    const name = typeof data?.name === "string" ? data.name.trim().slice(0, 16) : "";
    const role = data?.role === "police" ? "police" : "drifter";
    const spawn = randomSpawn();
    players.set(socket.id, {
      id: socket.id, name: name || "Driver", role,
      color: role === "police" ? "#398dff" : colors[Math.floor(Math.random() * colors.length)],
      x: spawn.x, y: spawn.y, angle: Math.random() * Math.PI * 2,
      vx: 0, vy: 0, angularVelocity: 0,
      steer: 0, throttle: 0, brake: 0, handbrake: false,
      caught: false, respawnAt: 0, captureCooldown: 0
    });
    socket.emit("joined", { id: socket.id, role });
  });

  socket.on("input", input => {
    const p = players.get(socket.id);
    if (!p || p.caught || !input || typeof input !== "object") return;
    p.steer = clamp(Number(input.steer) || 0, -1, 1);
    p.throttle = clamp(Number(input.throttle) || 0, 0, 1);
    p.brake = clamp(Number(input.brake) || 0, 0, 1);
    p.handbrake = !!input.handbrake;
  });

  socket.on("disconnect", () => players.delete(socket.id));
});

const fixedDt = 1 / 60;
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (p.caught) {
      if (now >= p.respawnAt) {
        const s = randomSpawn();
        p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0;
        p.angularVelocity = 0; p.caught = false;
        io.to(p.id).emit("respawned");
      }
      continue;
    }

    const forwardX = Math.cos(p.angle), forwardY = Math.sin(p.angle);
    const rightX = -forwardY, rightY = forwardX;
    let forwardSpeed = p.vx * forwardX + p.vy * forwardY;
    let lateralSpeed = p.vx * rightX + p.vy * rightY;
    const speed = Math.hypot(p.vx, p.vy);

    // Rear-wheel-drive style acceleration, braking and tire grip.
    forwardSpeed += (p.throttle * 560 - p.brake * 900) * fixedDt;
    forwardSpeed *= Math.pow(p.brake > 0 ? 0.986 : 0.994, fixedDt * 60);
    forwardSpeed = clamp(forwardSpeed, -190, 610);

    const grip = p.handbrake ? 0.988 : 0.84;
    lateralSpeed *= Math.pow(grip, fixedDt * 60);
    const steeringAuthority = clamp(speed / 95, 0, 1.35);
    const desiredYaw = p.steer * steeringAuthority * (p.handbrake ? 2.55 : 1.72) *
      (forwardSpeed < -8 ? -1 : 1);
    p.angularVelocity += (desiredYaw - p.angularVelocity) * (p.handbrake ? 4.2 : 7.5) * fixedDt;
    p.angularVelocity *= Math.pow(0.91, fixedDt * 60);
    p.angle += p.angularVelocity * fixedDt;

    const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
    const rx = -fy, ry = fx;
    p.vx = fx * forwardSpeed + rx * lateralSpeed;
    p.vy = fy * forwardSpeed + ry * lateralSpeed;
    p.x = clamp(p.x + p.vx * fixedDt, 55, ARENA.width - 55);
    p.y = clamp(p.y + p.vy * fixedDt, 55, ARENA.height - 55);
    p.captureCooldown = Math.max(0, p.captureCooldown - fixedDt);
  }

  // Police catch drifters by getting close enough; both roles retain the same drift physics.
  const police = [...players.values()].filter(p => p.role === "police" && !p.caught);
  const drifters = [...players.values()].filter(p => p.role === "drifter" && !p.caught);
  for (const cop of police) {
    if (cop.captureCooldown > 0) continue;
    for (const target of drifters) {
      if (target.caught) continue;
      if (Math.hypot(cop.x - target.x, cop.y - target.y) < 58) {
        target.caught = true;
        target.respawnAt = now + 4500;
        target.vx = 0; target.vy = 0;
        target.steer = 0; target.throttle = 0; target.brake = 0;
        cop.captureCooldown = 2.5;
        io.to(target.id).emit("caught", { by: cop.name });
        io.to(cop.id).emit("catchSuccess", { name: target.name });
        break;
      }
    }
  }

  const snapshot = [...players.values()].map(({ steer, throttle, brake, handbrake, angularVelocity, respawnAt, captureCooldown, ...p }) => p);
  io.emit("state", snapshot);
}, 1000 / 60);

app.get("/health", (_req, res) => res.json({ ok: true, players: players.size }));
server.listen(PORT, "0.0.0.0", () => console.log("Drift-rag server listening on " + PORT));
