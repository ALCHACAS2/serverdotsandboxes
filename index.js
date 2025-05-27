const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {};

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.on("joinRoom", ({ roomCode, name }) => {
    if (!rooms[roomCode]) rooms[roomCode] = [];

    if (rooms[roomCode].length >= 2) {
      socket.emit("roomFull");
      return;
    }

    rooms[roomCode].push({ id: socket.id, name });
    socket.join(roomCode);

    io.to(roomCode).emit("playersUpdate", rooms[roomCode]);

    if (rooms[roomCode].length === 2) {
      io.to(roomCode).emit("startGame", rooms[roomCode]);
    }
  });

  socket.on("make_move", ({ roomCode, move }) => {
    socket.to(roomCode).emit("opponent_move", move);
  });

  socket.on("disconnect", () => {
    for (const code in rooms) {
      rooms[code] = rooms[code].filter(p => p.id !== socket.id);
      if (rooms[code].length === 0) {
        delete rooms[code];
      } else {
        io.to(code).emit("playersUpdate", rooms[code]);
      }
    }
  });
});

app.get("/", (req, res) => {
  res.send("Dots and Boxes Socket Server.");
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
