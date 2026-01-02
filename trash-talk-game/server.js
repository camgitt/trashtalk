const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const games = {}; 

// ============ CARD DECKS ============
const PROMPT_CARDS = [
    "Sex is great, but have you ever tried ______?",
    "What's the real reason I failed that exam?",
    "My therapist said I need to stop ______.",
    "The RA caught me ______.",
    "I blacked out and woke up with ______.",
    "What's in my browser history at 3am?",
    "My Tinder bio just says ______.",
    "The worst thing to say during a job interview: ______.",
    "I'm not an alcoholic, I just really enjoy ______.",
    "What ruined Thanksgiving dinner?",
    "______ is why I'm in debt.",
    "My parents would disown me if they knew about ______.",
    "What's keeping me up at night?",
    "The walk of shame was made worse by ______.",
    "I spent my entire paycheck on ______.",
    "What did I drunk text my ex?",
    "My roommate walked in on me ______.",
    "The real pandemic was ______ all along.",
    "What's that smell in my apartment?",
    "I peaked in high school because of ______.",
    "What's the worst thing to yell during graduation?",
    "My professor reported me to the dean for ______.",
    "______ is my love language.",
    "I'm dropping out because of ______.",
    "What's in the mysterious Tupperware in my fridge?",
];

const RESPONSE_CARDS = [
    "Crying in the campus library at 2am",
    "A Juul pod and a dream",
    "Accidentally calling your professor 'Mom'",
    "The Walk of Shame in last night's Halloween costume",
    "Microdosing mushrooms during a family Zoom call",
    "Sending a nude to the group chat",
    "Getting chlamydia from a bean bag chair",
    "A bong made out of a Gatorade bottle and despair",
    "Thinking you can fix him/her",
    "An emotional support vape",
    "Blacking out and buying crypto",
    "Your ex's finsta",
    "Crying during sex",
    "A $200 DoorDash order at 4am",
    "Academic probation",
    "Hot girl summer (depression edition)",
    "LinkedIn influencers",
    "Posting thirst traps for validation",
    "White Claw and regret",
    "The guy with an acoustic guitar at parties",
    "Undiagnosed ADHD",
    "Daddy issues",
    "Mommy issues",
    "The entire football team",
    "Crippling student loan debt",
    "A mental breakdown in the Target parking lot",
    "Situationship trauma",
    "Main character syndrome",
    "Being too online",
    "Roman Empire thoughts",
    "The talking stage that never ends",
    "Bare minimum behavior",
    "A parasocial relationship",
    "That one weird kid from high school",
    "Weaponized incompetence",
    "Your toxic trait",
    "The ick",
    "Delulu as the solulu",
    "Ghosting someone mid-conversation",
    "Stalking someone's Instagram from 2015",
    "An 'accidental' double tap on a 3-year-old photo",
    "Drunk crying at an Applebee's",
    "Getting kicked out of an Uber",
    "Throwing up in your own purse/backpack",
    "A completely unhinged group project partner",
    "Selling feet pics for textbooks",
    "That weird rash that won't go away",
    "Pretending to read the syllabus",
    "Living off free campus event food",
    "Three roommates and zero boundaries",
];

// ============ HELPER FUNCTIONS ============
function generateRoomCode() {
    const words = ['BEER', 'YEET', 'VIBE', 'SEND', 'BRUH', 'COPE', 'SLAY', 'YOLO', 'FLEX', 'MOOD'];
    if (Math.random() > 0.5) {
        return words[Math.floor(Math.random() * words.length)];
    }
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getRandomEmoji() {
    const emojis = ['🍺', '🎉', '💀', '🔥', '😈', '🤡', '👻', '🍕', '🌮', '🎯', '💩', '🦄', '🐸', '🍆', '🌶️'];
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

function startRound(roomCode) {
    const room = games[roomCode];
    if (!room) return;
    
    room.currentRound++;
    room.state = 'playing';
    room.submissions = {};
    
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
    
    // Notify host
    io.to(room.hostId).emit('round_start', {
        round: room.currentRound,
        maxRounds: room.maxRounds,
        prompt: room.currentPrompt,
        judgeName: judge.name,
        judgeAvatar: judge.avatar
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
    
    // Shuffle submissions so judge can't tell who submitted what
    const submissions = Object.entries(room.submissions).map(([playerId, card]) => ({
        playerId,
        card
    }));
    room.shuffledSubmissions = shuffle(submissions);
    
    io.to(room.hostId).emit('start_reveal', {
        prompt: room.currentPrompt,
        submissionCount: room.shuffledSubmissions.length
    });
    
    // Tell judge to get ready to pick
    const judge = room.players[room.judgeIndex];
    io.to(judge.id).emit('judge_reveal', {
        prompt: room.currentPrompt
    });
    
    // Tell other players to watch
    room.players.forEach(player => {
        if (player.id !== judge.id) {
            io.to(player.id).emit('watch_reveal');
        }
    });
}

function showWinner(roomCode, winningIndex) {
    const room = games[roomCode];
    const winner = room.shuffledSubmissions[winningIndex];
    const winningPlayer = room.players.find(p => p.id === winner.playerId);
    
    if (winningPlayer) {
        winningPlayer.score++;
    }
    
    room.state = 'winner';
    
    // Send to host
    io.to(room.hostId).emit('round_winner', {
        winnerName: winningPlayer ? winningPlayer.name : 'Unknown',
        winnerAvatar: winningPlayer ? winningPlayer.avatar : '❓',
        winningCard: winner.card,
        prompt: room.currentPrompt,
        scores: room.players.map(p => ({ name: p.name, avatar: p.avatar, score: p.score }))
    });
    
    // Send to all players
    room.players.forEach(player => {
        io.to(player.id).emit('round_winner', {
            winnerName: winningPlayer ? winningPlayer.name : 'Unknown',
            winnerAvatar: winningPlayer ? winningPlayer.avatar : '❓',
            winningCard: winner.card,
            isYou: player.id === winner.playerId
        });
    });
    
    console.log(`🏆 ${winningPlayer?.name} won round ${room.currentRound} in ${roomCode}`);
}

function endGame(roomCode) {
    const room = games[roomCode];
    room.state = 'ended';
    
    const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
    
    io.to(roomCode).emit('game_over', {
        leaderboard: sortedPlayers.map(p => ({
            name: p.name,
            avatar: p.avatar,
            score: p.score
        })),
        winner: sortedPlayers[0]
    });
    
    io.to(room.hostId).emit('game_over', {
        leaderboard: sortedPlayers.map(p => ({
            name: p.name,
            avatar: p.avatar,
            score: p.score
        })),
        winner: sortedPlayers[0],
        isHost: true
    });
    
    console.log(`🎮 Game ended in ${roomCode} | Winner: ${sortedPlayers[0]?.name}`);
}

// ============ SOCKET HANDLERS ============
io.on('connection', (socket) => {
    console.log('🎮 User connected:', socket.id);

    socket.on('create_game', () => {
        let roomCode = generateRoomCode();
        while (games[roomCode]) {
            roomCode = generateRoomCode();
        }
        
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
            shuffledSubmissions: []
        };
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;
        socket.emit('game_created', roomCode);
        console.log(`🏠 Game created: ${roomCode}`);
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
            
            io.to(room.hostId).emit('player_joined', { 
                playerName, 
                avatar: player.avatar,
                playerCount: room.players.length 
            });
            
            console.log(`👤 ${playerName} joined room ${roomCode} (${room.players.length} players)`);
        } else {
            socket.emit('error_msg', 'Room not found! Check the code.');
        }
    });

    // HOST: Start the game
    socket.on('start_game', () => {
        const room = games[socket.roomCode];
        if (room && socket.isHost && room.state === 'lobby') {
            if (room.players.length < 3) {
                socket.emit('error_msg', 'Need at least 3 players!');
                return;
            }
            startRound(socket.roomCode);
        }
    });

    // PLAYER: Submit a card
    socket.on('submit_card', (cardIndex) => {
        const room = games[socket.roomCode];
        if (!room || room.state !== 'playing') return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player || room.players[room.judgeIndex].id === socket.id) return;
        
        if (room.submissions[socket.id]) return; // Already submitted
        
        const card = player.hand[cardIndex];
        if (!card) return;
        
        room.submissions[socket.id] = card;
        player.hand.splice(cardIndex, 1);
        
        socket.emit('card_submitted');
        
        // Tell host someone submitted
        io.to(room.hostId).emit('player_submitted', {
            playerName: player.name,
            playerAvatar: player.avatar,
            submittedCount: Object.keys(room.submissions).length,
            totalPlayers: room.players.length - 1
        });
        
        console.log(`📝 ${player.name} submitted in ${socket.roomCode}`);
        
        // Check if everyone submitted
        if (checkAllSubmitted(socket.roomCode)) {
            startReveal(socket.roomCode);
        }
    });

    // HOST: Reveal next card
    socket.on('reveal_next', () => {
        const room = games[socket.roomCode];
        if (!room || room.state !== 'reveal' || !socket.isHost) return;
        
        if (!room.revealIndex) room.revealIndex = 0;
        
        if (room.revealIndex < room.shuffledSubmissions.length) {
            const submission = room.shuffledSubmissions[room.revealIndex];
            
            io.to(room.hostId).emit('card_revealed', {
                card: submission.card,
                index: room.revealIndex,
                isLast: room.revealIndex === room.shuffledSubmissions.length - 1
            });
            
            // Send to judge for selection
            const judge = room.players[room.judgeIndex];
            io.to(judge.id).emit('card_revealed', {
                card: submission.card,
                index: room.revealIndex
            });
            
            room.revealIndex++;
        }
    });

    // JUDGE: Pick winner
    socket.on('pick_winner', (cardIndex) => {
        const room = games[socket.roomCode];
        if (!room || room.state !== 'reveal') return;
        
        const judge = room.players[room.judgeIndex];
        if (socket.id !== judge.id) return;
        
        room.revealIndex = 0;
        showWinner(socket.roomCode, cardIndex);
    });

    // HOST: Next round
    socket.on('next_round', () => {
        const room = games[socket.roomCode];
        if (!room || !socket.isHost) return;
        
        if (room.currentRound >= room.maxRounds) {
            endGame(socket.roomCode);
        } else {
            startRound(socket.roomCode);
        }
    });

    // HOST: Play again
    socket.on('play_again', () => {
        const room = games[socket.roomCode];
        if (!room || !socket.isHost) return;
        
        // Reset game state
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
        
        io.to(socket.roomCode).emit('reset_to_lobby');
        io.to(room.hostId).emit('back_to_lobby', {
            players: room.players.map(p => ({ name: p.name, avatar: p.avatar }))
        });
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
                io.to(room.hostId).emit('player_left', { 
                    playerName: socket.playerName,
                    playerCount: room.players.length
                });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 TRASH TALK running on port ${PORT}`);
});
