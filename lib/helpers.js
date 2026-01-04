/**
 * Helper utilities for the game
 */

const EMOJIS = ['🍺', '🎉', '💀', '🔥', '😈', '🤡', '👻', '🍕', '🌮', '🎯', '💩', '🦄', '🐸', '🍆', '🌶️', '🎪', '🚀', '👽', '🤠', '🧠'];

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getRandomEmoji() {
    return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

function generateSessionToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function generateRoomCode(roomCodeWords = []) {
    if (Math.random() > 0.5 && roomCodeWords.length > 0) {
        return roomCodeWords[Math.floor(Math.random() * roomCodeWords.length)];
    }
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function buildDecks(selectedPacks, cardsData) {
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

function getRoundConfig(round, roundsConfig) {
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

module.exports = {
    shuffle,
    getRandomEmoji,
    generateSessionToken,
    generateRoomCode,
    buildDecks,
    getRoundConfig,
    dealCards,
    getPromptForRound,
    getJudge
};
