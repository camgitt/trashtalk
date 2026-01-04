/**
 * Core game logic functions
 */

const { shuffle, getRoundConfig, dealCards, getPromptForRound, getJudge } = require('./helpers');

/**
 * Create the game logic module with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.store - GameStore instance
 * @param {Object} deps.io - Socket.io instance
 * @param {Object} deps.settings - Game settings
 * @param {Object} deps.roundsConfig - Rounds configuration
 */
function createGameLogic({ store, io, settings, roundsConfig }) {

    function startRound(roomCode) {
        const room = store.get(roomCode);
        if (!room || room.players.length < 2) return;

        room.currentRound++;
        room.state = 'playing';
        room.submissions = {};
        room.revealIndex = 0;

        const roundConfig = getRoundConfig(room.currentRound, roundsConfig);
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
        const room = store.get(roomCode);
        if (!room) return false;
        const playersWhoSubmit = room.players.filter((_, i) => i !== room.judgeIndex);
        return playersWhoSubmit.every(p => room.submissions[p.id]);
    }

    function startReveal(roomCode) {
        const room = store.get(roomCode);
        if (!room) return;

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
        const room = store.get(roomCode);
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
        const room = store.get(roomCode);
        if (!room) return;

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
        const room = store.get(roomCode);
        if (!room) return;

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

    // Emit to host (TV mode) or all players (phone party mode)
    function emitToRoom(room, roomCode, event, data) {
        if (room.phonePartyMode) {
            room.players.forEach(p => io.to(p.id).emit(event, data));
        } else {
            io.to(room.hostId).emit(event, data);
        }
    }

    return {
        startRound,
        checkAllSubmitted,
        startReveal,
        revealNextCard,
        showWinner,
        endGame,
        emitToRoom
    };
}

module.exports = createGameLogic;
