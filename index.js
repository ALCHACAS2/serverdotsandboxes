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
const gameStates = {}; // Para mantener el estado de cada juego

// Función para inicializar el estado del juego
function initializeGameState(roomCode, players, gridSize) {
    gameStates[roomCode] = {
        horizontalLines: Array(gridSize + 1).fill(null).map(() => Array(gridSize).fill(false)),
        verticalLines: Array(gridSize).fill(null).map(() => Array(gridSize + 1).fill(false)),
        boxes: Array(gridSize).fill(null).map(() => Array(gridSize).fill(null)),
        turnIndex: 0,
        scores: {},
        gridSize: gridSize
    };

    // Inicializar scores
    players.forEach(player => {
        gameStates[roomCode].scores[player.name] = 0;
    });
}

io.on("connection", (socket) => {
    console.log("Cliente conectado:", socket.id);

    socket.on("joinRoom", ({ roomCode, name, gridSize = 3 }) => {
        const roomCodeNormalized = roomCode.trim().toLowerCase();

        console.log(`${name} intentando unirse a la sala ${roomCodeNormalized} con tamaño ${gridSize}x${gridSize}`);

        if (!rooms[roomCodeNormalized]) {
            rooms[roomCodeNormalized] = {
                players: [],
                gridSize: gridSize,
                maxPlayers: 2
            };
        }

        if (rooms[roomCodeNormalized].players.length >= rooms[roomCodeNormalized].maxPlayers) {
            socket.emit("roomFull");
            return;
        }

        // Verificar si el jugador ya está en la sala
        const existingPlayer = rooms[roomCodeNormalized].players.find(p => p.name === name);
        if (existingPlayer) {
            console.log(`${name} ya está en la sala ${roomCodeNormalized}`);
            socket.emit("roomFull");
            return;
        }

        // Si es el primer jugador, establecer el tamaño de la cuadrícula
        if (rooms[roomCodeNormalized].players.length === 0) {
            rooms[roomCodeNormalized].gridSize = gridSize;
            console.log(`Tamaño de cuadrícula establecido para sala ${roomCodeNormalized}: ${gridSize}x${gridSize}`);
        }

        rooms[roomCodeNormalized].players.push({ id: socket.id, name });
        socket.join(roomCodeNormalized);

        console.log(`${name} se unió a la sala ${roomCodeNormalized}. Jugadores: ${rooms[roomCodeNormalized].players.length}/${rooms[roomCodeNormalized].maxPlayers}`);

        // Enviar actualización de jugadores con información de la sala
        io.to(roomCodeNormalized).emit("playersUpdate", {
            players: rooms[roomCodeNormalized].players,
            gridSize: rooms[roomCodeNormalized].gridSize
        });

        if (rooms[roomCodeNormalized].players.length === rooms[roomCodeNormalized].maxPlayers) {
            console.log(`Iniciando juego en la sala ${roomCodeNormalized} con cuadrícula ${rooms[roomCodeNormalized].gridSize}x${rooms[roomCodeNormalized].gridSize}`);

            // Inicializar estado del juego con el tamaño correcto
            initializeGameState(roomCodeNormalized, rooms[roomCodeNormalized].players, rooms[roomCodeNormalized].gridSize);

            // Enviar evento de inicio de juego con los jugadores y configuración
            io.to(roomCodeNormalized).emit("startGame", {
                players: rooms[roomCodeNormalized].players,
                gridSize: rooms[roomCodeNormalized].gridSize
            });

            // Enviar estado inicial del juego
            io.to(roomCodeNormalized).emit("game_state", gameStates[roomCodeNormalized]);
        }
    });

    socket.on("make_move", ({ roomCode, move, newTurnIndex, scores, horizontalLines, verticalLines, boxes }) => {
        const roomCodeNormalized = roomCode.trim().toLowerCase();
        console.log(`Movimiento en sala ${roomCodeNormalized}:`, move);
        console.log(`Nuevo turno: ${newTurnIndex}`);
        console.log(`Scores actualizados:`, scores);

        // Actualizar el estado del juego en el servidor
        if (gameStates[roomCodeNormalized]) {
            gameStates[roomCodeNormalized].turnIndex = newTurnIndex;
            gameStates[roomCodeNormalized].scores = scores;
            gameStates[roomCodeNormalized].horizontalLines = horizontalLines;
            gameStates[roomCodeNormalized].verticalLines = verticalLines;
            gameStates[roomCodeNormalized].boxes = boxes;

            console.log(`Estado del juego actualizado para sala ${roomCodeNormalized}`);
        }

        // Enviar el movimiento y el nuevo estado a todos los otros jugadores en la sala
        socket.to(roomCodeNormalized).emit("opponent_move", {
            move,
            newTurnIndex,
            scores,
            horizontalLines,
            verticalLines,
            boxes
        });

        // También enviar el estado completo del juego para asegurar sincronización
        socket.to(roomCodeNormalized).emit("game_state", gameStates[roomCodeNormalized]);
    });

    socket.on("disconnect", () => {
        console.log("Cliente desconectado:", socket.id);

        for (const code in rooms) {
            const playerIndex = rooms[code].players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                const playerName = rooms[code].players[playerIndex].name;
                console.log(`${playerName} salió de la sala ${code}`);

                rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);

                if (rooms[code].players.length === 0) {
                    delete rooms[code];
                    delete gameStates[code];
                    console.log(`Sala ${code} eliminada`);
                } else {
                    io.to(code).emit("playersUpdate", {
                        players: rooms[code].players,
                        gridSize: rooms[code].gridSize
                    });
                    io.to(code).emit("playerDisconnected", { playerName });
                }
            }
        }
    });

    // Evento para sincronizar estado del juego cuando un jugador se reconecta
    socket.on("request_game_state", ({ roomCode }) => {
        const roomCodeNormalized = roomCode.trim().toLowerCase();
        if (gameStates[roomCodeNormalized]) {
            socket.emit("game_state", gameStates[roomCodeNormalized]);
        }
    });
});

app.get("/", (req, res) => {
    res.send("Dots and Boxes Socket Server.");
});

app.get("/rooms", (req, res) => {
    res.json({
        rooms: rooms,
        gameStates: gameStates
    });
});

server.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});