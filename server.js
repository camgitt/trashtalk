const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

// ============ LOAD CONFIG FILES ============
let cardsData, settings, roundsConfig;
try {
    cardsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/cards.json'), 'utf8'));
    settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/settings.json'), 'utf8'));
    roundsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/rounds.json'), 'utf8'));
} catch (err) {
    console.error('❌ Failed to load config files:', err.message);
    process.exit(1);
}

// ============ LOAD MODULES ============
const GameStore = require('./lib/gameStore');
const createGameLogic = require('./lib/gameLogic');
const setupSocketHandlers = require('./lib/socketHandlers');

// ============ SETUP GAME STORE WITH PERSISTENCE ============
const store = new GameStore({
    persistPath: path.join(__dirname, 'data/games.json'),
    onGameExpired: (roomCode, room) => {
        // Notify all connected players when game expires
        if (room.phonePartyMode) {
            room.players.forEach(p => io.to(p.id).emit('game_ended', 'Game expired due to inactivity'));
        } else {
            io.to(roomCode).emit('game_ended', 'Game expired due to inactivity');
        }
    }
});

// ============ SETUP GAME LOGIC ============
const gameLogic = createGameLogic({
    store,
    io,
    settings,
    roundsConfig
});

// ============ SETUP SOCKET HANDLERS ============
setupSocketHandlers({
    io,
    store,
    gameLogic,
    settings,
    roundsConfig,
    cardsData
});

// ============ EXPRESS ROUTES ============
app.use(express.static(path.join(__dirname, 'public')));

// Serve pack info to frontend
app.get('/api/packs', (req, res) => {
    const packInfo = {};
    for (const [key, pack] of Object.entries(cardsData.packs)) {
        packInfo[key] = {
            name: pack.name,
            icon: pack.icon,
            description: pack.description,
            cardCount: (pack.prompts?.length || 0) + (pack.responses?.length || 0)
        };
    }
    res.json(packInfo);
});

// ============ GRACEFUL SHUTDOWN ============
function shutdown() {
    console.log('\n🛑 Shutting down...');
    store.shutdown();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 TRASH TALK running on port ${PORT}`);
    console.log(`📦 Packs available: ${Object.keys(cardsData.packs).join(', ')}`);
});
