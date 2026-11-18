const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));

const players = new Map();
const ARENA = { width: 3200, height: 2200 };
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

io.on("connection", (socket) => {
  const color = ["#ff5b5b", "#55c8ff", "#ffe05b", "#a77bff", "#58e39a", "#ff9c42"][Math.floor(Math.random() * 6)];
  players.set(socket.id, {
    id: socket.id, name: "Drifter-" + socket.id.slice(0, 4), color,
    x: ARENA.width / 2 + (Math.random() - 0.5) * 500,
    y: ARENA.height / 2 + (Math.random() - 0.5) * 500,
    angle: Math.random() * Math.PI * 2, vx: 0, vy: 0,
    steer: 0, throttle: 0, brake: 0, handbrake: false
  });

  socket.emit("welcome", { id: socket.id, arena: ARENA });
  socket.on("input", (input = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.steer = clamp(Number(input.steer) || 0, -1, 1);
    p.throttle = clamp(Number(input.throttle) || 0, 0, 1);
    p.brake = clamp(Number(input.brake) || 0, 0, 1);
    p.handbrake = !!input.handbrake;
  });
  socket.on("rename", (name) => {
    const p = players.get(socket.id);
    if (p && typeof name === "string") p.name = name.trim().slice(0, 16) || p.name;
  });
  socket.on("disconnect", () => players.delete(socket.id));
});

const dt = 1 / 60;
setInterval(() => {
  for (const p of players.values()) {
    const forwardX = Math.cos(p.angle), forwardY = Math.sin(p.angle);
    const rightX = -forwardY, rightY = forwardX;
    let forwardSpeed = p.vx * forwardX + p.vy * forwardY;
    let sideSpeed = p.vx * rightX + p.vy * rightY;

    forwardSpeed += (p.throttle * 430 - p.brake * 620) * dt;
    forwardSpeed *= Math.pow(0.986, 60 * dt);
    forwardSpeed = clamp(forwardSpeed, -210, 570);

    const grip = p.handbrake ? 0.982 : 0.82;
    sideSpeed *= Math.pow(grip, 60 * dt);
    sideSpeed += p.steer * Math.abs(forwardSpeed) * (p.handbrake ? 0.34 : 0.16) * dt;

    const speedFactor = clamp(Math.abs(forwardSpeed) / 100, 0, 1.5);
    p.angle += p.steer * speedFactor * (p.handbrake ? 2.7 : 1.75) * dt * (forwardSpeed < -5 ? -1 : 1);

    const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
    const rx = -fy, ry = fx;
    p.vx = fx * forwardSpeed + rx * sideSpeed;
    p.vy = fy * forwardSpeed + ry * sideSpeed;
    p.x = clamp(p.x + p.vx * dt, 70, ARENA.width - 70);
    p.y = clamp(p.y + p.vy * dt, 70, ARENA.height - 70);
  }
  const snapshot = Array.from(players.values()).map(({ steer, throttle, brake, handbrake, ...p }) => p);
  io.emit("state", snapshot);
}, 1000 / 30);

app.get("/health", (_req, res) => res.json({ ok: true, players: players.size }));
server.listen(PORT, "0.0.0.0", () => console.log("Drift-rag server listening on " + PORT));
