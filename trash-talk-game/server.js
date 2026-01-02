const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

app.use(express.static(path.join(__dirname, 'public')));

const games = {}; 

// ============ LOAD CARDS FROM FILE ============
function loadCards() {
    const data = fs.readFileSync(path.join(__dirname, 'cards.json'), 'utf8');
    return JSON.parse(data);
}

const cards = loadCards();
const PROMPT_CARDS = cards.prompts;
const RESPONSE_CARDS = cards.responses;

console.log(`📦 Loaded ${PROMPT_CARDS.length} prompts and ${RESPONSE_CARDS.length} responses`);

// ============ HELPER FUNCTIONS ============
function generateRoomCode() {
    const words = ['BEER', 'YEET', 'VIBE', 'SEND', 'BRUH', 'COPE', 'SLAY', 'YOLO', 'FLEX', 'MOOD', 'DRIP', 'SICK', 'DANK', 'CHAD', 'SIMP'];
    if (Math.random() > 0.5) {
        return words[Math.floor(Math.random() * words.length)];
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

function dealCards(room, player, count = 7) {
    while (player.hand.length < count) {
        if (room.responseDeck.length === 0) {
            room.responseDeck = shuffle([...RESPONSE_CARDS]);
        }
        player.hand.push(room.responseDeck.pop());
    }
}

function getMinPlayers(room) {
    // Phone party mode: host plays too, so need 3 total (including host)
    // TV mode: host doesn't play, need 3 players
    return 3;
}

function startRound(roomCode) {
    const room = games[roomCode];
    if (!room) return;
    
    room.currentRound++;
    room.state = 'playing';
    room.submissions = {};
    room.revealIndex = 0;
    
    // Rotate judge
    room.judgeIndex = (room.judgeIndex + 1) % room.players.length;
    const judge = room.players[room.judgeIndex];
    
    // Draw prompt card
    if (room.promptDeck.length === 0) {
        room.promptDeck = shuffle([...PROMPT_CARDS]);
    }
    room.currentPrompt = room.promptDeck.pop();
    
    // Deal cards to all players
    room.players.forEach(p => dealCards(room, p));
    
    // In phone party mode, notify all players (including host who is a player)
    // In TV mode, notify host separately
    
    if (room.phonePartyMode) {
        // Everyone gets notified as players
        room.players.forEach(player => {
            const isJudge = player.id === judge.id;
            io.to(player.id).emit('round_start', {
                round: room.currentRound,
                maxRounds: room.maxRounds,
                prompt: room.currentPrompt,
                judgeName: judge.name,
                judgeAvatar: judge.avatar,
                isJudge,
                hand: isJudge ? [] : player.hand,
                playerCount: room.players.length,
                phonePartyMode: true
            });
        });
    } else {
        // TV mode - notify host separately
        io.to(room.hostId).emit('round_start', {
            round: room.currentRound,
            maxRounds: room.maxRounds,
            prompt: room.currentPrompt,
            judgeName: judge.name,
            judgeAvatar: judge.avatar,
            phonePartyMode: false
        });
        
        // Notify players
        room.players.forEach(player => {
            const isJudge = player.id === judge.id;
            io.to(player.id).emit('your_turn', {
                isJudge,
                prompt: room.currentPrompt,
                hand: isJudge ? [] : player.hand,
                judgeName: judge.name
            });
        });
    }
    
    console.log(`🎲 Round ${room.currentRound} started in ${roomCode} | Judge: ${judge.name}`);
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
    
    // Shuffle submissions
    const submissions = Object.entries(room.submissions).map(([playerId, card]) => ({
        playerId,
        card
    }));
    room.shuffledSubmissions = shuffle(submissions);
    
    if (room.phonePartyMode) {
        // In phone party mode, everyone sees the reveal on their phones
        room.players.forEach(player => {
            const isJudge = room.players[room.judgeIndex].id === player.id;
            io.to(player.id).emit('start_reveal', {
                prompt: room.currentPrompt,
                submissionCount: room.shuffledSubmissions.length,
                isJudge,
                phonePartyMode: true
            });
        });
    } else {
        // TV mode
        io.to(room.hostId).emit('start_reveal', {
            prompt: room.currentPrompt,
            submissionCount: room.shuffledSubmissions.length
        });
        
        const judge = room.players[room.judgeIndex];
        io.to(judge.id).emit('judge_reveal', { prompt: room.currentPrompt });
        
        room.players.forEach(player => {
            if (player.id !== judge.id) {
                io.to(player.id).emit('watch_reveal');
            }
        });
    }
}

function revealNextCard(roomCode, requesterId) {
    const room = games[roomCode];
    if (!room || room.state !== 'reveal') return;
    
    // In phone party mode, only judge can reveal
    // In TV mode, only host can reveal
    const canReveal = room.phonePartyMode 
        ? room.players[room.judgeIndex].id === requesterId
        : room.hostId === requesterId;
    
    if (!canReveal) return;
    
    if (room.revealIndex < room.shuffledSubmissions.length) {
        const submission = room.shuffledSubmissions[room.revealIndex];
        const isLast = room.revealIndex === room.shuffledSubmissions.length - 1;
        
        if (room.phonePartyMode) {
            // Send to all players
            room.players.forEach(player => {
                const isJudge = room.players[room.judgeIndex].id === player.id;
                io.to(player.id).emit('card_revealed', {
                    card: submission.card,
                    index: room.revealIndex,
                    isLast,
                    isJudge
                });
            });
        } else {
            // TV mode
            io.to(room.hostId).emit('card_revealed', {
                card: submission.card,
                index: room.revealIndex,
                isLast
            });
            
            const judge = room.players[room.judgeIndex];
            io.to(judge.id).emit('card_revealed', {
                card: submission.card,
                index: room.revealIndex
            });
        }
        
        room.revealIndex++;
    }
}

function showWinner(roomCode, winningIndex) {
    const room = games[roomCode];
    const winner = room.shuffledSubmissions[winningIndex];
    const winningPlayer = room.players.find(p => p.id === winner.playerId);
    
    if (winningPlayer) {
        winningPlayer.score++;
    }
    
    room.state = 'winner';
    
    const scores = room.players.map(p => ({ name: p.name, avatar: p.avatar, score: p.score }));
    
    if (room.phonePartyMode) {
        // Send to all players
        room.players.forEach(player => {
            io.to(player.id).emit('round_winner', {
                winnerName: winningPlayer ? winningPlayer.name : 'Unknown',
                winnerAvatar: winningPlayer ? winningPlayer.avatar : '❓',
                winningCard: winner.card,
                prompt: room.currentPrompt,
                scores,
                isYou: player.id === winner.playerId,
                phonePartyMode: true,
                isHost: player.id === room.hostId
            });
        });
    } else {
        // TV mode
        io.to(room.hostId).emit('round_winner', {
            winnerName: winningPlayer ? winningPlayer.name : 'Unknown',
            winnerAvatar: winningPlayer ? winningPlayer.avatar : '❓',
            winningCard: winner.card,
            prompt: room.currentPrompt,
            scores
        });
        
        room.players.forEach(player => {
            io.to(player.id).emit('round_winner', {
                winnerName: winningPlayer ? winningPlayer.name : 'Unknown',
                winnerAvatar: winningPlayer ? winningPlayer.avatar : '❓',
                winningCard: winner.card,
                isYou: player.id === winner.playerId
            });
        });
    }
    
    console.log(`🏆 ${winningPlayer?.name} won round ${room.currentRound} in ${roomCode}`);
}

function endGame(roomCode) {
    const room = games[roomCode];
    room.state = 'ended';
    
    const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
    
    const gameOverData = {
        leaderboard: sortedPlayers.map(p => ({
            name: p.name,
            avatar: p.avatar,
            score: p.score
        })),
        winner: sortedPlayers[0]
    };
    
    if (room.phonePartyMode) {
        room.players.forEach(player => {
            io.to(player.id).emit('game_over', {
                ...gameOverData,
                isHost: player.id === room.hostId,
                phonePartyMode: true
            });
        });
    } else {
        io.to(roomCode).emit('game_over', gameOverData);
        io.to(room.hostId).emit('game_over', { ...gameOverData, isHost: true });
    }
    
    console.log(`🎮 Game ended in ${roomCode} | Winner: ${sortedPlayers[0]?.name}`);
}

// ============ SOCKET HANDLERS ============
io.on('connection', (socket) => {
    console.log('🎮 User connected:', socket.id);

    // Create game with mode selection
    socket.on('create_game', (options = {}) => {
        let roomCode = generateRoomCode();
        while (games[roomCode]) {
            roomCode = generateRoomCode();
        }
        
        const phonePartyMode = options.phonePartyMode || false;
        
        games[roomCode] = {
            hostId: socket.id,
            players: [],
            state: 'lobby',
            currentRound: 0,
            maxRounds: 10,
            judgeIndex: -1,
            promptDeck: shuffle([...PROMPT_CARDS]),
            responseDeck: shuffle([...RESPONSE_CARDS]),
            currentPrompt: null,
            submissions: {},
            shuffledSubmissions: [],
            phonePartyMode
        };
        
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;
        
        // In phone party mode, host joins as a player too
        if (phonePartyMode && options.hostName) {
            const player = {
                id: socket.id,
                name: options.hostName,
                score: 0,
                avatar: getRandomEmoji(),
                hand: []
            };
            games[roomCode].players.push(player);
            socket.playerName = options.hostName;
        }
        
        socket.emit('game_created', { 
            roomCode, 
            phonePartyMode,
            hostName: options.hostName,
            hostAvatar: games[roomCode].players[0]?.avatar
        });
        console.log(`🏠 Game created: ${roomCode} (${phonePartyMode ? 'Phone Party' : 'TV'} mode)`);
    });

    socket.on('join_game', (data) => {
        const { roomCode, playerName } = data;
        const room = games[roomCode];

        if (room) {
            if (room.state !== 'lobby') {
                socket.emit('error_msg', 'Game already in progress!');
                return;
            }
            
            if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
                socket.emit('error_msg', 'Name already taken!');
                return;
            }

            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.playerName = playerName;
            
            const player = { 
                id: socket.id, 
                name: playerName, 
                score: 0,
                avatar: getRandomEmoji(),
                hand: []
            };
            room.players.push(player);
            
            socket.emit('joined_success', { playerName, avatar: player.avatar });
            
            // Notify host (and in phone party mode, all players)
            if (room.phonePartyMode) {
                room.players.forEach(p => {
                    io.to(p.id).emit('player_joined', { 
                        playerName, 
                        avatar: player.avatar,
                        playerCount: room.players.length,
                        players: room.players.map(pl => ({ name: pl.name, avatar: pl.avatar }))
                    });
                });
            } else {
                io.to(room.hostId).emit('player_joined', { 
                    playerName, 
                    avatar: player.avatar,
                    playerCount: room.players.length 
                });
            }
            
            console.log(`👤 ${playerName} joined room ${roomCode} (${room.players.length} players)`);
        } else {
            socket.emit('error_msg', 'Room not found! Check the code.');
        }
    });

    socket.on('start_game', () => {
        const room = games[socket.roomCode];
        if (room && socket.isHost && room.state === 'lobby') {
            const minPlayers = getMinPlayers(room);
            if (room.players.length < minPlayers) {
                socket.emit('error_msg', `Need at least ${minPlayers} players!`);
                return;
            }
            
            // Notify all that game is starting
            if (room.phonePartyMode) {
                room.players.forEach(p => {
                    io.to(p.id).emit('game_starting');
                });
            }
            
            startRound(socket.roomCode);
        }
    });

    socket.on('submit_card', (cardIndex) => {
        const room = games[socket.roomCode];
        if (!room || room.state !== 'playing') return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player || room.players[room.judgeIndex].id === socket.id) return;
        
        if (room.submissions[socket.id]) return;
        
        const card = player.hand[cardIndex];
        if (!card) return;
        
        room.submissions[socket.id] = card;
        player.hand.splice(cardIndex, 1);
        
        socket.emit('card_submitted');
        
        // Notify about submission
        const submittedCount = Object.keys(room.submissions).length;
        const totalPlayers = room.players.length - 1;
        
        if (room.phonePartyMode) {
            room.players.forEach(p => {
                io.to(p.id).emit('player_submitted', {
                    playerName: player.name,
                    playerAvatar: player.avatar,
                    submittedCount,
                    totalPlayers
                });
            });
        } else {
            io.to(room.hostId).emit('player_submitted', {
                playerName: player.name,
                playerAvatar: player.avatar,
                submittedCount,
                totalPlayers
            });
        }
        
        console.log(`📝 ${player.name} submitted in ${socket.roomCode}`);
        
        if (checkAllSubmitted(socket.roomCode)) {
            setTimeout(() => startReveal(socket.roomCode), 1000);
        }
    });

    socket.on('reveal_next', () => {
        revealNextCard(socket.roomCode, socket.id);
    });

    socket.on('pick_winner', (cardIndex) => {
        const room = games[socket.roomCode];
        if (!room || room.state !== 'reveal') return;
        
        const judge = room.players[room.judgeIndex];
        if (socket.id !== judge.id) return;
        
        showWinner(socket.roomCode, cardIndex);
    });

    socket.on('next_round', () => {
        const room = games[socket.roomCode];
        if (!room) return;
        
        // In phone party mode, host (who is also a player) triggers next round
        // In TV mode, host triggers
        const canTrigger = room.phonePartyMode 
            ? socket.id === room.hostId
            : socket.isHost;
        
        if (!canTrigger) return;
        
        if (room.currentRound >= room.maxRounds) {
            endGame(socket.roomCode);
        } else {
            startRound(socket.roomCode);
        }
    });

    socket.on('play_again', () => {
        const room = games[socket.roomCode];
        if (!room || socket.id !== room.hostId) return;
        
        room.state = 'lobby';
        room.currentRound = 0;
        room.judgeIndex = -1;
        room.promptDeck = shuffle([...PROMPT_CARDS]);
        room.responseDeck = shuffle([...RESPONSE_CARDS]);
        room.submissions = {};
        room.shuffledSubmissions = [];
        room.players.forEach(p => {
            p.score = 0;
            p.hand = [];
        });
        
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
    });

    socket.on('disconnect', () => {
        console.log('👋 User disconnected:', socket.id);
        
        if (socket.roomCode && games[socket.roomCode]) {
            const room = games[socket.roomCode];
            
            if (socket.isHost) {
                io.to(socket.roomCode).emit('game_ended', 'Host disconnected');
                delete games[socket.roomCode];
                console.log(`💀 Game ${socket.roomCode} ended - host left`);
            } else {
                room.players = room.players.filter(p => p.id !== socket.id);
                
                if (room.phonePartyMode) {
                    room.players.forEach(p => {
                        io.to(p.id).emit('player_left', { 
                            playerName: socket.playerName,
                            playerCount: room.players.length
                        });
                    });
                } else {
                    io.to(room.hostId).emit('player_left', { 
                        playerName: socket.playerName,
                        playerCount: room.players.length
                    });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 TRASH TALK running on port ${PORT}`);
});
