/**
 * Game state management with JSON file persistence
 */

const fs = require('fs');
const path = require('path');

const GAME_EXPIRATION_MS = 2 * 60 * 60 * 1000;  // 2 hours
const RECONNECT_TIMEOUT = 60000;  // 60 seconds to rejoin
const PERSIST_INTERVAL = 30000;   // Save every 30 seconds
const CLEANUP_INTERVAL = 5 * 60 * 1000;  // Check every 5 minutes

class GameStore {
    constructor(options = {}) {
        this.games = {};
        this.disconnectedPlayers = new Map();
        this.persistPath = options.persistPath || path.join(__dirname, '../data/games.json');
        this.onGameExpired = options.onGameExpired || (() => {});

        // Load persisted games on startup
        this._loadFromDisk();

        // Persist games periodically
        this._persistInterval = setInterval(() => this._saveToDisk(), PERSIST_INTERVAL);

        // Cleanup expired games periodically
        this._cleanupInterval = setInterval(() => this._cleanupExpiredGames(), CLEANUP_INTERVAL);
    }

    // ============ GAME CRUD ============
    get(roomCode) {
        return this.games[roomCode];
    }

    exists(roomCode) {
        return !!this.games[roomCode];
    }

    create(roomCode, gameData) {
        this.games[roomCode] = {
            ...gameData,
            lastActivity: Date.now()
        };
        return this.games[roomCode];
    }

    update(roomCode, updates) {
        if (this.games[roomCode]) {
            Object.assign(this.games[roomCode], updates);
            return this.games[roomCode];
        }
        return null;
    }

    delete(roomCode) {
        delete this.games[roomCode];
    }

    all() {
        return Object.entries(this.games);
    }

    // ============ ACTIVITY TRACKING ============
    updateActivity(roomCode) {
        if (this.games[roomCode]) {
            this.games[roomCode].lastActivity = Date.now();
        }
    }

    // ============ DISCONNECT/RECONNECT ============
    markPlayerDisconnected(roomCode, playerId, sessionToken) {
        const room = this.games[roomCode];
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) return;

        const player = room.players[playerIndex];
        player.disconnected = true;
        player.disconnectedAt = Date.now();

        // Set timeout to remove player if they don't rejoin
        const timeout = setTimeout(() => {
            const room = this.games[roomCode];
            if (room) {
                room.players = room.players.filter(p => p.sessionToken !== sessionToken);
                delete room.submissions[playerId];
                console.log(`⏰ ${player.name} timed out from ${roomCode}`);
            }
            this.disconnectedPlayers.delete(sessionToken);
        }, RECONNECT_TIMEOUT);

        this.disconnectedPlayers.set(sessionToken, { roomCode, playerId, timeout });
    }

    reconnectPlayer(newSocketId, sessionToken) {
        const entry = this.disconnectedPlayers.get(sessionToken);
        if (!entry) return null;

        const room = this.games[entry.roomCode];
        if (!room) {
            this.disconnectedPlayers.delete(sessionToken);
            return null;
        }

        const player = room.players.find(p => p.sessionToken === sessionToken);
        if (!player) {
            this.disconnectedPlayers.delete(sessionToken);
            return null;
        }

        // Clear the removal timeout
        clearTimeout(entry.timeout);
        this.disconnectedPlayers.delete(sessionToken);

        // Update player's socket ID
        const oldId = player.id;
        player.id = newSocketId;
        player.disconnected = false;
        delete player.disconnectedAt;

        // Update submissions if player had submitted
        if (room.submissions[oldId]) {
            room.submissions[newSocketId] = room.submissions[oldId];
            delete room.submissions[oldId];
        }

        return { room, player, roomCode: entry.roomCode };
    }

    // ============ PERSISTENCE ============
    _loadFromDisk() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.persistPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            if (fs.existsSync(this.persistPath)) {
                const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
                const now = Date.now();

                // Only load games that haven't expired
                for (const [roomCode, game] of Object.entries(data)) {
                    if (now - game.lastActivity < GAME_EXPIRATION_MS) {
                        // Clear player socket IDs since they're invalid after restart
                        game.players.forEach(p => {
                            p.id = null;
                            p.disconnected = true;
                        });
                        this.games[roomCode] = game;
                    }
                }

                const loadedCount = Object.keys(this.games).length;
                if (loadedCount > 0) {
                    console.log(`📂 Loaded ${loadedCount} games from disk`);
                }
            }
        } catch (err) {
            console.error('⚠️ Failed to load games from disk:', err.message);
        }
    }

    _saveToDisk() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.persistPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Create a serializable copy (remove circular refs, functions, etc.)
            const serializable = {};
            for (const [roomCode, game] of Object.entries(this.games)) {
                serializable[roomCode] = {
                    ...game,
                    // Don't persist these as they're runtime-only
                    shuffledSubmissions: []
                };
            }

            fs.writeFileSync(this.persistPath, JSON.stringify(serializable, null, 2));
        } catch (err) {
            console.error('⚠️ Failed to save games to disk:', err.message);
        }
    }

    _cleanupExpiredGames() {
        const now = Date.now();
        for (const [roomCode, room] of Object.entries(this.games)) {
            if (now - room.lastActivity > GAME_EXPIRATION_MS) {
                this.onGameExpired(roomCode, room);
                delete this.games[roomCode];
                console.log(`🧹 Game ${roomCode} expired after 2 hours of inactivity`);
            }
        }
    }

    // ============ CLEANUP ============
    shutdown() {
        clearInterval(this._persistInterval);
        clearInterval(this._cleanupInterval);
        this._saveToDisk();
        console.log('💾 Games saved to disk');
    }
}

module.exports = GameStore;
