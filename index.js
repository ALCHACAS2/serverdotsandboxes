require("dotenv").config(); // Al inicio del archivo
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function sendNotification(subject, message) {
    const mailOptions = {
        from: 'enviocorreoa@gmail.com',
        to: "enviocorreoa@gmail.com", // Podés cambiar esto si querés enviar a otro correo
        subject: subject,
        text: message
    };

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.error("❌ Error al enviar el correo:", error);
        } else {
            console.log("✅ Correo enviado:", info.response);
        }
    });
}

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
        gridSize: gridSize,
        gameEnded: false
    };

    // Inicializar scores
    players.forEach(player => {
        gameStates[roomCode].scores[player.name] = 0;
    });
}

// Función para verificar si el juego ha terminado y determinar el ganador
function checkGameEnd(roomCode) {
    const gameState = gameStates[roomCode];
    const room = rooms[roomCode];

    if (!gameState || !room || gameState.gameEnded) return null;

    const totalBoxes = gameState.gridSize * gameState.gridSize;
    const completedBoxes = gameState.boxes.flat().filter(box => box !== null).length;

    if (completedBoxes === totalBoxes) {
        gameState.gameEnded = true;

        // Encontrar el ganador
        const players = room.players;
        const scores = gameState.scores;

        let winner = null;
        let maxScore = -1;
        let isTie = false;

        players.forEach(player => {
            const score = scores[player.name] || 0;
            if (score > maxScore) {
                maxScore = score;
                winner = player.name;
                isTie = false;
            } else if (score === maxScore) {
                isTie = true;
            }
        });

        if (isTie) {
            sendNotification(
                "🤝 Empate en Dots and Boxes",
                `La partida en la sala '${roomCode}' terminó en empate. Ambos jugadores obtuvieron ${maxScore} puntos.`
            );
            return { result: 'tie', scores };
        } else {
            const loser = players.find(p => p.name !== winner)?.name;
            sendNotification(
                "🏆 Victoria en Dots and Boxes",
                `¡${winner} ha ganado la partida en la sala '${roomCode}'! Puntuación final: ${winner}: ${maxScore}, ${loser}: ${scores[loser] || 0}`
            );
            return { result: 'win', winner, scores };
        }
    }

    return null;
}

io.on("connection", (socket) => {
    console.log("Cliente conectado:", socket.id);

    socket.on("joinRoom", ({ roomCode, name, gridSize = 3 }) => {
        const roomCodeNormalized = roomCode.trim().toLowerCase();

        if (!rooms[roomCodeNormalized]) {
            rooms[roomCodeNormalized] = {
                players: [],
                gridSize: gridSize,
                maxPlayers: 2
            };

            sendNotification(
                "🎮 Nueva sala creada",
                `El jugador ${name} ha creado la sala '${roomCodeNormalized}' con un grid de ${gridSize}x${gridSize}.`
            );
        } else {
            sendNotification(
                "👤 Jugador se unió a sala existente",
                `El jugador ${name} se unió a la sala '${roomCodeNormalized}'.`
            );
        }

        console.log(`${name} intentando unirse a la sala ${roomCodeNormalized} con tamaño ${gridSize}x${gridSize}`);

        if (rooms[roomCodeNormalized].players.length >= rooms[roomCodeNormalized].maxPlayers) {
            // Notificación cuando la sala está llena
            sendNotification(
                "🚫 Sala llena",
                `El jugador ${name} intentó unirse a la sala '${roomCodeNormalized}' pero está llena (${rooms[roomCodeNormalized].players.length}/${rooms[roomCodeNormalized].maxPlayers} jugadores).`
            );

            socket.emit("roomFull");
            return;
        }

        // Verificar si el jugador ya está en la sala
        const existingPlayer = rooms[roomCodeNormalized].players.find(p => p.name === name);
        if (existingPlayer) {
            console.log(`${name} ya está en la sala ${roomCodeNormalized}`);

            sendNotification(
                "⚠️ Jugador duplicado",
                `El jugador ${name} intentó unirse nuevamente a la sala '${roomCodeNormalized}' donde ya está presente.`
            );

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

            // Notificación cuando la sala está completa y el juego comienza
            const playerNames = rooms[roomCodeNormalized].players.map(p => p.name).join(" vs ");
            sendNotification(
                "🎯 Sala completa - Juego iniciado",
                `La sala '${roomCodeNormalized}' está completa con ${rooms[roomCodeNormalized].maxPlayers} jugadores (${playerNames}). ¡El juego ha comenzado!`
            );

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

            // Verificar si el juego ha terminado
            const gameResult = checkGameEnd(roomCodeNormalized);
            if (gameResult) {
                // Enviar resultado del juego a todos los jugadores
                io.to(roomCodeNormalized).emit("gameEnded", gameResult);
            }
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
                    // Notificación cuando una sala es eliminada
                    sendNotification(
                        "🗑️ Sala eliminada",
                        `La sala '${code}' ha sido eliminada porque todos los jugadores se desconectaron. El último jugador en salir fue ${playerName}.`
                    );

                    delete rooms[code];
                    delete gameStates[code];
                    console.log(`Sala ${code} eliminada`);
                } else {
                    // Notificación cuando un jugador se desconecta pero la sala sigue activa
                    sendNotification(
                        "👋 Jugador desconectado",
                        `El jugador ${playerName} se desconectó de la sala '${code}'. Quedan ${rooms[code].players.length} jugador(es) en la sala.`
                    );

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