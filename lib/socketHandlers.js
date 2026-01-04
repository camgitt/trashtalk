/**
 * Socket.io event handlers
 */

const { sanitizeName, isValidRoomCode, RateLimiter } = require('./validation');
const { getRandomEmoji, generateSessionToken, generateRoomCode, buildDecks, getJudge } = require('./helpers');

/**
 * Setup socket handlers with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.io - Socket.io instance
 * @param {Object} deps.store - GameStore instance
 * @param {Object} deps.gameLogic - Game logic functions
 * @param {Object} deps.settings - Game settings
 * @param {Object} deps.roundsConfig - Rounds configuration
 * @param {Object} deps.cardsData - Cards data
 */
function setupSocketHandlers({ io, store, gameLogic, settings, roundsConfig, cardsData }) {
    const rateLimiter = new RateLimiter(1000, 10);

    io.on('connection', (socket) => {
        console.log('🎮 User connected:', socket.id);

        // Rate limit wrapper for socket events
        const rateLimitedHandler = (handler) => (...args) => {
            if (rateLimiter.isLimited(socket.id)) {
                socket.emit('error_msg', 'Slow down! Too many requests.');
                return;
            }
            handler(...args);
        };

        socket.on('create_game', rateLimitedHandler((options = {}) => {
            let roomCode = generateRoomCode(settings.roomCodeWords);
            while (store.exists(roomCode)) roomCode = generateRoomCode(settings.roomCodeWords);

            const phonePartyMode = options.phonePartyMode || false;
            const selectedPacks = options.packs || settings.defaultPacks;
            const decks = buildDecks(selectedPacks, cardsData);

            store.create(roomCode, {
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
                selectedPacks
            });

            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.isHost = true;

            let sessionToken = null;
            if (phonePartyMode && options.hostName) {
                const hostName = sanitizeName(options.hostName);
                if (!hostName) {
                    socket.emit('error_msg', 'Enter a valid name!');
                    store.delete(roomCode);
                    return;
                }
                sessionToken = generateSessionToken();
                const player = { id: socket.id, name: hostName, score: 0, avatar: getRandomEmoji(), hand: [], sessionToken };
                store.get(roomCode).players.push(player);
                socket.playerName = hostName;
                socket.sessionToken = sessionToken;
            }

            // Get pack info for display
            const packIcons = selectedPacks.map(p => cardsData.packs[p]?.icon || '📦').join(' ');

            socket.emit('game_created', {
                roomCode,
                phonePartyMode,
                hostName: options.hostName,
                hostAvatar: store.get(roomCode).players[0]?.avatar,
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

            const room = store.get(roomCode);

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
                store.updateActivity(roomCode);

                const joinData = { playerName, avatar: player.avatar, playerCount: room.players.length };
                if (room.phonePartyMode) {
                    joinData.players = room.players.map(pl => ({ name: pl.name, avatar: pl.avatar }));
                }
                gameLogic.emitToRoom(room, roomCode, 'player_joined', joinData);

                console.log(`👤 ${playerName} joined ${roomCode} (${room.players.length} players)`);
            } else {
                socket.emit('error_msg', 'Room not found! Check the code.');
            }
        }));

        socket.on('start_game', rateLimitedHandler(() => {
            const room = store.get(socket.roomCode);
            if (room && socket.isHost && room.state === 'lobby') {
                if (room.players.length < settings.minPlayers) {
                    socket.emit('error_msg', `Need at least ${settings.minPlayers} players!`);
                    return;
                }

                store.updateActivity(socket.roomCode);

                if (room.phonePartyMode) {
                    room.players.forEach(p => io.to(p.id).emit('game_starting'));
                }

                gameLogic.startRound(socket.roomCode);
            }
        }));

        socket.on('submit_cards', rateLimitedHandler((cardIndices) => {
            const room = store.get(socket.roomCode);
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
            store.updateActivity(socket.roomCode);

            const submittedCount = Object.keys(room.submissions).length;
            const totalPlayers = room.players.length - 1;

            gameLogic.emitToRoom(room, socket.roomCode, 'player_submitted', {
                playerName: player.name, playerAvatar: player.avatar, submittedCount, totalPlayers
            });

            console.log(`📝 ${player.name} submitted ${playedCards.length} cards`);

            if (gameLogic.checkAllSubmitted(socket.roomCode)) {
                setTimeout(() => gameLogic.startReveal(socket.roomCode), settings.revealDelay);
            }
        }));

        socket.on('reveal_next', rateLimitedHandler(() => {
            store.updateActivity(socket.roomCode);
            gameLogic.revealNextCard(socket.roomCode, socket.id);
        }));

        socket.on('pick_winner', rateLimitedHandler((cardIndex) => {
            const room = store.get(socket.roomCode);
            if (!room || room.state !== 'reveal') return;

            const judge = getJudge(room);
            if (!judge || socket.id !== judge.id) return;

            store.updateActivity(socket.roomCode);
            gameLogic.showWinner(socket.roomCode, cardIndex);
        }));

        socket.on('next_round', rateLimitedHandler(() => {
            const room = store.get(socket.roomCode);
            if (!room) return;

            const canTrigger = room.phonePartyMode ? socket.id === room.hostId : socket.isHost;
            if (!canTrigger) return;

            store.updateActivity(socket.roomCode);

            if (room.currentRound >= roundsConfig.totalRounds) {
                gameLogic.endGame(socket.roomCode);
            } else {
                gameLogic.startRound(socket.roomCode);
            }
        }));

        socket.on('leave_game', rateLimitedHandler(() => {
            const room = store.get(socket.roomCode);
            if (!room) return;

            // Host leaving ends the game
            if (socket.isHost) {
                io.to(socket.roomCode).emit('game_ended', 'Host left the game');
                store.delete(socket.roomCode);
                console.log(`💀 Game ${socket.roomCode} ended - host left`);
            } else {
                // Remove player from room
                room.players = room.players.filter(p => p.id !== socket.id);
                delete room.submissions[socket.id];

                gameLogic.emitToRoom(room, socket.roomCode, 'player_left', {
                    playerName: socket.playerName, playerCount: room.players.length
                });

                console.log(`👋 ${socket.playerName} left ${socket.roomCode}`);
            }

            socket.leave(socket.roomCode);
            socket.roomCode = null;
        }));

        socket.on('play_again', rateLimitedHandler(() => {
            const room = store.get(socket.roomCode);
            if (!room || socket.id !== room.hostId) return;

            store.updateActivity(socket.roomCode);
            const decks = buildDecks(room.selectedPacks, cardsData);
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

            const result = store.reconnectPlayer(socket.id, sessionToken);
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

            if (socket.roomCode && store.exists(socket.roomCode)) {
                const room = store.get(socket.roomCode);

                if (socket.isHost) {
                    io.to(socket.roomCode).emit('game_ended', 'Host disconnected');
                    store.delete(socket.roomCode);
                    console.log(`💀 Game ${socket.roomCode} ended - host left`);
                } else if (socket.sessionToken) {
                    // Mark as disconnected, allow rejoin within timeout
                    store.markPlayerDisconnected(socket.roomCode, socket.id, socket.sessionToken);
                    console.log(`⏳ ${socket.playerName} disconnected, can rejoin within 60s`);
                } else {
                    // No session token, remove immediately
                    room.players = room.players.filter(p => p.id !== socket.id);

                    gameLogic.emitToRoom(room, socket.roomCode, 'player_left', {
                        playerName: socket.playerName, playerCount: room.players.length
                    });
                }
            }
        });
    });
}

module.exports = setupSocketHandlers;
