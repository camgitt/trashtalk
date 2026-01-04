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

app.use(express.static(path.join(__dirname, 'public')));

// Serve config to frontend
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

const games = {};

// ============ INPUT VALIDATION ============
function sanitizeName(name) {
    if (typeof name !== 'string') return '';
    return name
        .trim()
        .slice(0, 12)
        .replace(/[<>]/g, '');  // Strip HTML brackets
}

function isValidRoomCode(code) {
    return typeof code === 'string' && /^[A-Z0-9]{4,8}$/i.test(code);
}

// ============ RATE LIMITING ============
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 1000;  // 1 second
const RATE_LIMIT_MAX = 10;       // max 10 events per second

function isRateLimited(socketId) {
    const now = Date.now();
    const entry = rateLimits.get(socketId) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };

    if (now > entry.resetAt) {
        entry.count = 1;
        entry.resetAt = now + RATE_LIMIT_WINDOW;
    } else {
        entry.count++;
    }

    rateLimits.set(socketId, entry);
    return entry.count > RATE_LIMIT_MAX;
}

// Cleanup old rate limit entries every minute
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of rateLimits) {
        if (now > entry.resetAt + 60000) rateLimits.delete(id);
    }
}, 60000);

// ============ GAME EXPIRATION ============
const GAME_EXPIRATION_MS = 2 * 60 * 60 * 1000;  // 2 hours
const GAME_CLEANUP_INTERVAL = 5 * 60 * 1000;    // Check every 5 minutes

function updateGameActivity(roomCode) {
    if (games[roomCode]) {
        games[roomCode].lastActivity = Date.now();
    }
}

// Cleanup expired games every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [roomCode, room] of Object.entries(games)) {
        if (now - room.lastActivity > GAME_EXPIRATION_MS) {
            // Notify all connected players
            if (room.phonePartyMode) {
                room.players.forEach(p => io.to(p.id).emit('game_ended', 'Game expired due to inactivity'));
            } else {
                io.to(roomCode).emit('game_ended', 'Game expired due to inactivity');
            }
            delete games[roomCode];
            console.log(`🧹 Game ${roomCode} expired after 2 hours of inactivity`);
        }
    }
}, GAME_CLEANUP_INTERVAL);

// ============ SESSION MANAGEMENT ============
const RECONNECT_TIMEOUT = 60000;  // 60 seconds to rejoin
const disconnectedPlayers = new Map();  // sessionToken -> { roomCode, playerIndex, timeout }

function generateSessionToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function markPlayerDisconnected(roomCode, playerId, sessionToken) {
    const room = games[roomCode];
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];
    player.disconnected = true;
    player.disconnectedAt = Date.now();

    // Set timeout to remove player if they don't rejoin
    const timeout = setTimeout(() => {
        const room = games[roomCode];
        if (room) {
            room.players = room.players.filter(p => p.sessionToken !== sessionToken);
            delete room.submissions[playerId];
            console.log(`⏰ ${player.name} timed out from ${roomCode}`);
        }
        disconnectedPlayers.delete(sessionToken);
    }, RECONNECT_TIMEOUT);

    disconnectedPlayers.set(sessionToken, { roomCode, playerId, timeout });
}

function reconnectPlayer(socket, sessionToken) {
    const entry = disconnectedPlayers.get(sessionToken);
    if (!entry) return null;

    const room = games[entry.roomCode];
    if (!room) {
        disconnectedPlayers.delete(sessionToken);
        return null;
    }

    const player = room.players.find(p => p.sessionToken === sessionToken);
    if (!player) {
        disconnectedPlayers.delete(sessionToken);
        return null;
    }

    // Clear the removal timeout
    clearTimeout(entry.timeout);
    disconnectedPlayers.delete(sessionToken);

    // Update player's socket ID
    const oldId = player.id;
    player.id = socket.id;
    player.disconnected = false;
    delete player.disconnectedAt;

    // Update submissions if player had submitted
    if (room.submissions[oldId]) {
        room.submissions[socket.id] = room.submissions[oldId];
        delete room.submissions[oldId];
    }

    return { room, player, roomCode: entry.roomCode };
}

// ============ EMIT HELPERS ============
// Emit to all players in a room (handles phonePartyMode vs TV mode)
function emitToPlayers(room, event, dataOrFn) {
    room.players.forEach(player => {
        const data = typeof dataOrFn === 'function' ? dataOrFn(player) : dataOrFn;
        io.to(player.id).emit(event, data);
    });
}

// Emit to host (TV mode) or all players (phone party mode)
function emitToRoom(room, roomCode, event, data) {
    if (room.phonePartyMode) {
        room.players.forEach(p => io.to(p.id).emit(event, data));
    } else {
        io.to(room.hostId).emit(event, data);
    }
}

// ============ HELPER FUNCTIONS ============
function generateRoomCode() {
    if (Math.random() > 0.5 && settings.roomCodeWords.length > 0) {
        return settings.roomCodeWords[Math.floor(Math.random() * settings.roomCodeWords.length)];
    }
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getRandomEmoji() {
    const emojis = ['🍺', '🎉', '💀', '🔥', '😈', '🤡', '👻', '🍕', '🌮', '🎯', '💩', '🦄', '🐸', '🍆', '🌶️', '🎪', '🚀', '👽', '🤠', '🧠'];
    return emojis[Math.floor(Math.random() * emojis.length)];
}

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function buildDecks(selectedPacks) {
    const prompts = [];
    const prompts2 = [];
    const prompts3 = [];
    const responses = [];
    
    for (const packId of selectedPacks) {
        const pack = cardsData.packs[packId];
        if (!pack) continue;
        
        if (pack.prompts) prompts.push(...pack.prompts);
        if (pack.prompts_2) prompts2.push(...pack.prompts_2);
        if (pack.prompts_3) prompts3.push(...pack.prompts_3);
        if (pack.responses) responses.push(...pack.responses);
    }
    
    return {
        prompts: shuffle(prompts),
        prompts2: shuffle(prompts2),
        prompts3: shuffle(prompts3),
        responses: shuffle(responses)
    };
}

function getRoundConfig(round) {
    for (const phase of roundsConfig.phases) {
        if (phase.rounds.includes(round)) {
            return {
                cardsNeeded: phase.cardsNeeded,
                points: phase.points,
                label: phase.label
            };
        }
    }
    return { cardsNeeded: 1, points: 1, label: '' };
}

function dealCards(room, player, count) {
    while (player.hand.length < count) {
        if (room.decks.responses.length === 0) {
            room.decks.responses = shuffle([...room.originalResponses]);
        }
        player.hand.push(room.decks.responses.pop());
    }
}

function getPromptForRound(room, cardsNeeded) {
    let prompt;
    
    if (cardsNeeded === 3 && room.decks.prompts3.length > 0) {
        prompt = room.decks.prompts3.pop();
    } else if (cardsNeeded === 2 && room.decks.prompts2.length > 0) {
        prompt = room.decks.prompts2.pop();
    } else {
        if (room.decks.prompts.length === 0) {
            room.decks.prompts = shuffle([...room.originalPrompts]);
        }
        prompt = room.decks.prompts.pop();
        
        if (cardsNeeded === 2) {
            prompt = prompt.replace('______', '______ + ______');
        } else if (cardsNeeded === 3) {
            prompt = prompt.replace('______', '______ + ______ + ______');
        }
    }
    
    return prompt;
}

// Safely get judge, correcting index if players left
function getJudge(room) {
    if (!room || room.players.length === 0) return null;
    if (room.judgeIndex < 0 || room.judgeIndex >= room.players.length) {
        room.judgeIndex = 0;
    }
    return room.players[room.judgeIndex];
}

function startRound(roomCode) {
    const room = games[roomCode];
    if (!room || room.players.length < 2) return;

    room.currentRound++;
    room.state = 'playing';
    room.submissions = {};
    room.revealIndex = 0;

    const roundConfig = getRoundConfig(room.currentRound);
    room.currentRoundConfig = roundConfig;

    // Safely advance judge index (handle case where players left)
    room.judgeIndex = (room.judgeIndex + 1) % room.players.length;
    const judge = getJudge(room);
    if (!judge) return;
    
    room.currentPrompt = getPromptForRound(room, roundConfig.cardsNeeded);
    
    const handSize = settings.handSize + (roundConfig.cardsNeeded * settings.extraCardsPerCombo);
    room.players.forEach(p => dealCards(room, p, handSize));
    
    const roundData = {
        round: room.currentRound,
        maxRounds: roundsConfig.totalRounds,
        prompt: room.currentPrompt,
        judgeName: judge.name,
        judgeAvatar: judge.avatar,
        cardsNeeded: roundConfig.cardsNeeded,
        pointValue: roundConfig.points,
        roundLabel: roundConfig.label
    };
    
    if (room.phonePartyMode) {
        room.players.forEach(player => {
            const isJudge = player.id === judge.id;
            io.to(player.id).emit('round_start', {
                ...roundData,
                isJudge,
                hand: isJudge ? [] : player.hand,
                playerCount: room.players.length,
                phonePartyMode: true
            });
        });
    } else {
        io.to(room.hostId).emit('round_start', { ...roundData, phonePartyMode: false });
        
        room.players.forEach(player => {
            const isJudge = player.id === judge.id;
            io.to(player.id).emit('your_turn', {
                ...roundData,
                isJudge,
                hand: isJudge ? [] : player.hand
            });
        });
    }
    
    console.log(`🎲 Round ${room.currentRound} (${roundConfig.cardsNeeded} cards, ${roundConfig.points} pts) | Judge: ${judge.name}`);
}

function checkAllSubmitted(roomCode) {
    const room = games[roomCode];
    const playersWhoSubmit = room.players.filter((_, i) => i !== room.judgeIndex);
    return playersWhoSubmit.every(p => room.submissions[p.id]);
}

function startReveal(roomCode) {
    const room = games[roomCode];
    room.state = 'reveal';
    room.revealIndex = 0;
    
    const submissions = Object.entries(room.submissions).map(([playerId, cards]) => ({
        playerId,
        cards: Array.isArray(cards) ? cards : [cards]
    }));
    room.shuffledSubmissions = shuffle(submissions);
    
    const revealData = {
        prompt: room.currentPrompt,
        submissionCount: room.shuffledSubmissions.length,
        cardsNeeded: room.currentRoundConfig.cardsNeeded,
        pointValue: room.currentRoundConfig.points
    };
    
    const judge = getJudge(room);
    if (!judge) return;

    if (room.phonePartyMode) {
        room.players.forEach(player => {
            const isJudge = player.id === judge.id;
            io.to(player.id).emit('start_reveal', { ...revealData, isJudge, phonePartyMode: true });
        });
    } else {
        io.to(room.hostId).emit('start_reveal', revealData);
        io.to(judge.id).emit('judge_reveal', { prompt: room.currentPrompt });
        room.players.forEach(player => {
            if (player.id !== judge.id) io.to(player.id).emit('watch_reveal');
        });
    }
}

function revealNextCard(roomCode, requesterId) {
    const room = games[roomCode];
    if (!room || room.state !== 'reveal') return;

    const judge = getJudge(room);
    if (!judge) return;

    const canReveal = room.phonePartyMode
        ? judge.id === requesterId
        : room.hostId === requesterId;

    if (!canReveal) return;

    if (room.revealIndex < room.shuffledSubmissions.length) {
        const submission = room.shuffledSubmissions[room.revealIndex];
        const isLast = room.revealIndex === room.shuffledSubmissions.length - 1;

        const revealData = { cards: submission.cards, index: room.revealIndex, isLast };

        if (room.phonePartyMode) {
            room.players.forEach(player => {
                const isJudge = player.id === judge.id;
                io.to(player.id).emit('card_revealed', { ...revealData, isJudge });
            });
        } else {
            io.to(room.hostId).emit('card_revealed', revealData);
            io.to(judge.id).emit('card_revealed', { ...revealData, isJudge: true });
        }

        room.revealIndex++;
    }
}

function showWinner(roomCode, winningIndex) {
    const room = games[roomCode];
    const winner = room.shuffledSubmissions[winningIndex];
    const winningPlayer = room.players.find(p => p.id === winner.playerId);
    
    const pointsWon = room.currentRoundConfig.points;
    if (winningPlayer) winningPlayer.score += pointsWon;
    
    room.state = 'winner';
    
    const scores = room.players.map(p => ({ name: p.name, avatar: p.avatar, score: p.score }));
    
    const winnerData = {
        winnerName: winningPlayer ? winningPlayer.name : 'Unknown',
        winnerAvatar: winningPlayer ? winningPlayer.avatar : '❓',
        winningCards: winner.cards,
        prompt: room.currentPrompt,
        pointsWon,
        scores
    };
    
    if (room.phonePartyMode) {
        room.players.forEach(player => {
            io.to(player.id).emit('round_winner', {
                ...winnerData,
                isYou: player.id === winner.playerId,
                phonePartyMode: true,
                isHost: player.id === room.hostId
            });
        });
    } else {
        io.to(room.hostId).emit('round_winner', winnerData);
        room.players.forEach(player => {
            io.to(player.id).emit('round_winner', {
                ...winnerData,
                isYou: player.id === winner.playerId
            });
        });
    }
    
    console.log(`🏆 ${winningPlayer?.name} won round ${room.currentRound} (+${pointsWon} pts)`);
}

function endGame(roomCode) {
    const room = games[roomCode];
    room.state = 'ended';
    
    const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
    
    const gameOverData = {
        leaderboard: sortedPlayers.map(p => ({ name: p.name, avatar: p.avatar, score: p.score })),
        winner: sortedPlayers[0]
    };
    
    if (room.phonePartyMode) {
        room.players.forEach(player => {
            io.to(player.id).emit('game_over', { ...gameOverData, isHost: player.id === room.hostId, phonePartyMode: true });
        });
    } else {
        io.to(roomCode).emit('game_over', gameOverData);
        io.to(room.hostId).emit('game_over', { ...gameOverData, isHost: true });
    }
    
    console.log(`🎮 Game ended | Winner: ${sortedPlayers[0]?.name} with ${sortedPlayers[0]?.score} pts`);
}

// ============ SOCKET HANDLERS ============
io.on('connection', (socket) => {
    console.log('🎮 User connected:', socket.id);

    // Rate limit wrapper for socket events
    const rateLimitedHandler = (handler) => (...args) => {
        if (isRateLimited(socket.id)) {
            socket.emit('error_msg', 'Slow down! Too many requests.');
            return;
        }
        handler(...args);
    };

    socket.on('create_game', rateLimitedHandler((options = {}) => {
        let roomCode = generateRoomCode();
        while (games[roomCode]) roomCode = generateRoomCode();
        
        const phonePartyMode = options.phonePartyMode || false;
        const selectedPacks = options.packs || settings.defaultPacks;
        const decks = buildDecks(selectedPacks);
        
        games[roomCode] = {
            hostId: socket.id,
            players: [],
            state: 'lobby',
            currentRound: 0,
            judgeIndex: -1,
            decks,
            originalPrompts: [...decks.prompts],
            originalResponses: [...decks.responses],
            currentPrompt: null,
            currentRoundConfig: null,
            submissions: {},
            shuffledSubmissions: [],
            phonePartyMode,
            selectedPacks,
            lastActivity: Date.now()
        };
        
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;
        
        let sessionToken = null;
        if (phonePartyMode && options.hostName) {
            const hostName = sanitizeName(options.hostName);
            if (!hostName) {
                socket.emit('error_msg', 'Enter a valid name!');
                delete games[roomCode];
                return;
            }
            sessionToken = generateSessionToken();
            const player = { id: socket.id, name: hostName, score: 0, avatar: getRandomEmoji(), hand: [], sessionToken };
            games[roomCode].players.push(player);
            socket.playerName = hostName;
            socket.sessionToken = sessionToken;
        }

        // Get pack info for display
        const packIcons = selectedPacks.map(p => cardsData.packs[p]?.icon || '📦').join(' ');

        socket.emit('game_created', {
            roomCode,
            phonePartyMode,
            hostName: options.hostName,
            hostAvatar: games[roomCode].players[0]?.avatar,
            packs: packIcons,
            selectedPacks,
            sessionToken
        });
        
        console.log(`🏠 Game created: ${roomCode} | Packs: ${selectedPacks.join(', ')}`);
    }));

    socket.on('join_game', rateLimitedHandler((data) => {
        const roomCode = (data.roomCode || '').toUpperCase().trim();
        const playerName = sanitizeName(data.playerName);

        if (!playerName) {
            socket.emit('error_msg', 'Enter a valid name!');
            return;
        }

        if (!isValidRoomCode(roomCode)) {
            socket.emit('error_msg', 'Invalid room code!');
            return;
        }

        const room = games[roomCode];

        if (room) {
            if (room.state !== 'lobby') {
                socket.emit('error_msg', 'Game already in progress!');
                return;
            }
            
            if (room.players.length >= settings.maxPlayers) {
                socket.emit('error_msg', 'Room is full!');
                return;
            }
            
            if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
                socket.emit('error_msg', 'Name already taken!');
                return;
            }

            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.playerName = playerName;

            const sessionToken = generateSessionToken();
            socket.sessionToken = sessionToken;

            const player = { id: socket.id, name: playerName, score: 0, avatar: getRandomEmoji(), hand: [], sessionToken };
            room.players.push(player);

            const packIcons = room.selectedPacks.map(p => cardsData.packs[p]?.icon || '📦').join(' ');

            socket.emit('joined_success', { playerName, avatar: player.avatar, packs: packIcons, roomCode, sessionToken });
            updateGameActivity(roomCode);

            const joinData = { playerName, avatar: player.avatar, playerCount: room.players.length };
            if (room.phonePartyMode) {
                joinData.players = room.players.map(pl => ({ name: pl.name, avatar: pl.avatar }));
            }
            emitToRoom(room, roomCode, 'player_joined', joinData);
            
            console.log(`👤 ${playerName} joined ${roomCode} (${room.players.length} players)`);
        } else {
            socket.emit('error_msg', 'Room not found! Check the code.');
        }
    }));

    socket.on('start_game', rateLimitedHandler(() => {
        const room = games[socket.roomCode];
        if (room && socket.isHost && room.state === 'lobby') {
            if (room.players.length < settings.minPlayers) {
                socket.emit('error_msg', `Need at least ${settings.minPlayers} players!`);
                return;
            }

            updateGameActivity(socket.roomCode);

            if (room.phonePartyMode) {
                room.players.forEach(p => io.to(p.id).emit('game_starting'));
            }

            startRound(socket.roomCode);
        }
    }));

    socket.on('submit_cards', rateLimitedHandler((cardIndices) => {
        const room = games[socket.roomCode];
        if (!room || room.state !== 'playing') return;

        const judge = getJudge(room);
        const player = room.players.find(p => p.id === socket.id);
        if (!player || (judge && judge.id === socket.id)) return;
        if (room.submissions[socket.id]) return;
        
        const indices = Array.isArray(cardIndices) ? cardIndices : [cardIndices];
        if (indices.length !== room.currentRoundConfig.cardsNeeded) return;
        
        const playedCards = [];
        const sortedIndices = [...indices].sort((a, b) => b - a);
        
        for (const idx of indices) {
            if (player.hand[idx]) playedCards.push(player.hand[idx]);
        }
        
        if (playedCards.length !== room.currentRoundConfig.cardsNeeded) return;
        
        for (const idx of sortedIndices) player.hand.splice(idx, 1);
        
        room.submissions[socket.id] = playedCards;
        socket.emit('card_submitted');
        updateGameActivity(socket.roomCode);
        
        const submittedCount = Object.keys(room.submissions).length;
        const totalPlayers = room.players.length - 1;

        emitToRoom(room, socket.roomCode, 'player_submitted', {
            playerName: player.name, playerAvatar: player.avatar, submittedCount, totalPlayers
        });
        
        console.log(`📝 ${player.name} submitted ${playedCards.length} cards`);
        
        if (checkAllSubmitted(socket.roomCode)) {
            setTimeout(() => startReveal(socket.roomCode), settings.revealDelay);
        }
    }));

    socket.on('reveal_next', rateLimitedHandler(() => {
        updateGameActivity(socket.roomCode);
        revealNextCard(socket.roomCode, socket.id);
    }));

    socket.on('pick_winner', rateLimitedHandler((cardIndex) => {
        const room = games[socket.roomCode];
        if (!room || room.state !== 'reveal') return;

        const judge = getJudge(room);
        if (!judge || socket.id !== judge.id) return;

        updateGameActivity(socket.roomCode);
        showWinner(socket.roomCode, cardIndex);
    }));

    socket.on('next_round', rateLimitedHandler(() => {
        const room = games[socket.roomCode];
        if (!room) return;

        const canTrigger = room.phonePartyMode ? socket.id === room.hostId : socket.isHost;
        if (!canTrigger) return;

        updateGameActivity(socket.roomCode);

        if (room.currentRound >= roundsConfig.totalRounds) {
            endGame(socket.roomCode);
        } else {
            startRound(socket.roomCode);
        }
    }));

    socket.on('leave_game', rateLimitedHandler(() => {
        const room = games[socket.roomCode];
        if (!room) return;

        // Host leaving ends the game
        if (socket.isHost) {
            io.to(socket.roomCode).emit('game_ended', 'Host left the game');
            delete games[socket.roomCode];
            console.log(`💀 Game ${socket.roomCode} ended - host left`);
        } else {
            // Remove player from room
            room.players = room.players.filter(p => p.id !== socket.id);
            delete room.submissions[socket.id];

            emitToRoom(room, socket.roomCode, 'player_left', {
                playerName: socket.playerName, playerCount: room.players.length
            });

            console.log(`👋 ${socket.playerName} left ${socket.roomCode}`);
        }

        socket.leave(socket.roomCode);
        socket.roomCode = null;
    }));

    socket.on('play_again', rateLimitedHandler(() => {
        const room = games[socket.roomCode];
        if (!room || socket.id !== room.hostId) return;

        updateGameActivity(socket.roomCode);
        const decks = buildDecks(room.selectedPacks);
        room.state = 'lobby';
        room.currentRound = 0;
        room.judgeIndex = -1;
        room.decks = decks;
        room.originalPrompts = [...decks.prompts];
        room.originalResponses = [...decks.responses];
        room.submissions = {};
        room.shuffledSubmissions = [];
        room.players.forEach(p => { p.score = 0; p.hand = []; });

        if (room.phonePartyMode) {
            room.players.forEach(p => {
                io.to(p.id).emit('back_to_lobby', {
                    players: room.players.map(pl => ({ name: pl.name, avatar: pl.avatar })),
                    phonePartyMode: true,
                    isHost: p.id === room.hostId
                });
            });
        } else {
            io.to(socket.roomCode).emit('reset_to_lobby');
            io.to(room.hostId).emit('back_to_lobby', {
                players: room.players.map(p => ({ name: p.name, avatar: p.avatar }))
            });
        }
    }));

    socket.on('rejoin_game', rateLimitedHandler((data) => {
        const sessionToken = data.sessionToken;
        if (!sessionToken) {
            socket.emit('rejoin_failed', 'No session token');
            return;
        }

        const result = reconnectPlayer(socket, sessionToken);
        if (!result) {
            socket.emit('rejoin_failed', 'Session expired or game ended');
            return;
        }

        const { room, player, roomCode } = result;

        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.playerName = player.name;
        socket.sessionToken = sessionToken;
        socket.isHost = room.hostId === socket.id;

        // Send current game state to rejoined player
        const packIcons = room.selectedPacks.map(p => cardsData.packs[p]?.icon || '📦').join(' ');
        const isJudge = room.players[room.judgeIndex]?.id === socket.id;

        socket.emit('rejoin_success', {
            roomCode,
            playerName: player.name,
            avatar: player.avatar,
            packs: packIcons,
            gameState: room.state,
            currentRound: room.currentRound,
            maxRounds: roundsConfig.totalRounds,
            prompt: room.currentPrompt,
            hand: player.hand,
            isJudge,
            hasSubmitted: !!room.submissions[socket.id],
            cardsNeeded: room.currentRoundConfig?.cardsNeeded || 1
        });

        console.log(`🔄 ${player.name} rejoined ${roomCode}`);
    }));

    socket.on('disconnect', () => {
        console.log('👋 User disconnected:', socket.id);

        if (socket.roomCode && games[socket.roomCode]) {
            const room = games[socket.roomCode];

            if (socket.isHost) {
                io.to(socket.roomCode).emit('game_ended', 'Host disconnected');
                delete games[socket.roomCode];
                console.log(`💀 Game ${socket.roomCode} ended - host left`);
            } else if (socket.sessionToken) {
                // Mark as disconnected, allow rejoin within timeout
                markPlayerDisconnected(socket.roomCode, socket.id, socket.sessionToken);
                console.log(`⏳ ${socket.playerName} disconnected, can rejoin within 60s`);
            } else {
                // No session token, remove immediately
                room.players = room.players.filter(p => p.id !== socket.id);

                emitToRoom(room, socket.roomCode, 'player_left', {
                    playerName: socket.playerName, playerCount: room.players.length
                });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 TRASH TALK running on port ${PORT}`);
    console.log(`📦 Packs available: ${Object.keys(cardsData.packs).join(', ')}`);
});
