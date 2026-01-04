// ============ GAME STATE ============
const socket = io();
let playerCount = 0;
let isHost = false;
let isJudge = false;
let phonePartyMode = false;
let cardsNeeded = 1;
let selectedCards = [];
let currentHand = [];
let selectedPacks = [];
let availablePacks = {};

// ============ SESSION MANAGEMENT ============
function saveSession(roomCode, sessionToken) {
    localStorage.setItem('trashTalkSession', JSON.stringify({ roomCode, sessionToken, timestamp: Date.now() }));
}

function getSession() {
    try {
        const data = JSON.parse(localStorage.getItem('trashTalkSession'));
        // Session expires after 60 seconds
        if (data && Date.now() - data.timestamp < 60000) {
            return data;
        }
    } catch (e) {}
    clearSession();
    return null;
}

function clearSession() {
    localStorage.removeItem('trashTalkSession');
}

// Try to rejoin on page load
(function tryRejoin() {
    const session = getSession();
    if (session) {
        socket.emit('rejoin_game', { sessionToken: session.sessionToken });
    }
})();

// ============ SCREEN NAVIGATION ============
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
    window.scrollTo(0, 0);
}

function showStartScreen() { showScreen('start-screen'); }
function showModeSelect() { playSound('click'); showScreen('mode-screen'); }
function showJoinScreen() { playSound('click'); showScreen('join-screen'); document.getElementById('p-name').focus(); }

function showPhonePartySetup() { 
    playSound('click'); 
    loadPacks().then(() => {
        showScreen('phone-party-setup'); 
        document.getElementById('host-name').focus(); 
    });
}

function showTVPackSelect() {
    playSound('click');
    loadPacks().then(() => {
        showScreen('tv-pack-select');
    });
}

// ============ PACK MANAGEMENT ============
async function loadPacks() {
    if (Object.keys(availablePacks).length > 0) return;
    
    try {
        const res = await fetch('/api/packs');
        availablePacks = await res.json();
        renderPackSelectors();
        // Select all by default
        selectedPacks = Object.keys(availablePacks);
        updatePackButtons();
    } catch (err) {
        console.error('Failed to load packs:', err);
    }
}

function renderPackSelectors() {
    const containers = document.querySelectorAll('.pack-selector');
    containers.forEach(container => {
        container.innerHTML = '';
        for (const [id, pack] of Object.entries(availablePacks)) {
            const btn = document.createElement('button');
            btn.className = 'pack-btn selected';
            btn.dataset.pack = id;
            btn.innerHTML = `<span class="pack-icon">${pack.icon}</span><span class="pack-name">${pack.name}</span>`;
            btn.onclick = () => togglePack(id);
            container.appendChild(btn);
        }
    });
}

function togglePack(packId) {
    playSound('select');
    const idx = selectedPacks.indexOf(packId);
    if (idx > -1) {
        if (selectedPacks.length > 1) {
            selectedPacks.splice(idx, 1);
        }
    } else {
        selectedPacks.push(packId);
    }
    updatePackButtons();
}

function updatePackButtons() {
    document.querySelectorAll('.pack-btn').forEach(btn => {
        btn.classList.toggle('selected', selectedPacks.includes(btn.dataset.pack));
    });
    
    const countDisplays = document.querySelectorAll('.pack-count');
    countDisplays.forEach(d => d.innerText = `${selectedPacks.length} pack${selectedPacks.length !== 1 ? 's' : ''} selected`);
}

// ============ HOST FUNCTIONS ============
function hostTVMode() {
    playSound('click');
    isHost = true;
    phonePartyMode = false;
    socket.emit('create_game', { phonePartyMode: false, packs: selectedPacks });
}

function hostPhoneParty() {
    const name = document.getElementById('host-name').value.trim();
    if (!name) { alert('Enter your name!'); return; }
    playSound('click');
    isHost = true;
    phonePartyMode = true;
    socket.emit('create_game', { phonePartyMode: true, hostName: name, packs: selectedPacks });
}

function startGame() { playSound('click'); socket.emit('start_game'); }
function revealNext() { playSound('reveal'); socket.emit('reveal_next'); }
function nextRound() { playSound('click'); socket.emit('next_round'); }
function playAgain() { playSound('click'); socket.emit('play_again'); }

function leaveGame() {
    if (confirm('Leave this game?')) {
        clearSession();
        socket.emit('leave_game');
        location.reload();
    }
}

// ============ QR CODE & SHARING ============
let currentRoomCode = '';

function generateQRCode(roomCode, qrElementId) {
    currentRoomCode = roomCode;
    const joinUrl = `${window.location.origin}?code=${roomCode}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(joinUrl)}`;
    document.getElementById(qrElementId).src = qrApiUrl;
}

async function shareGame(mode) {
    const roomCode = mode === 'phone'
        ? document.getElementById('phone-room-code').innerText
        : document.getElementById('room-code-display').innerText;
    const joinUrl = `${window.location.origin}?code=${roomCode}`;
    const shareText = `Join my TRASH TALK game! Code: ${roomCode}`;

    // Try native share first (mobile)
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'TRASH TALK',
                text: shareText,
                url: joinUrl
            });
            playSound('click');
            return;
        } catch (err) {
            // User cancelled or share failed, fallback to clipboard
        }
    }

    // Fallback: copy to clipboard
    try {
        await navigator.clipboard.writeText(joinUrl);
        playSound('click');
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = '✅ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerText = originalText;
            btn.classList.remove('copied');
        }, 2000);
    } catch (err) {
        alert(`Share this link: ${joinUrl}`);
    }
}

function updateStartButton(count, btnId) {
    const btn = document.getElementById(btnId);
    if (btn) btn.disabled = count < 3;
}

// ============ PLAYER FUNCTIONS ============
function joinGame() {
    const name = document.getElementById('p-name').value.trim();
    const code = document.getElementById('p-code').value.toUpperCase().trim();
    document.getElementById('error-msg').innerText = '';
    
    if (!name) { document.getElementById('error-msg').innerText = 'Enter your name!'; return; }
    if (!code || code.length < 4) { document.getElementById('error-msg').innerText = 'Enter the 4-letter code!'; return; }
    
    playSound('click');
    socket.emit('join_game', { playerName: name, roomCode: code });
}

function toggleCardSelection(index) {
    playSound('select');

    const existingIndex = selectedCards.indexOf(index);
    if (existingIndex > -1) {
        selectedCards.splice(existingIndex, 1);
    } else if (selectedCards.length < cardsNeeded) {
        selectedCards.push(index);
    } else {
        selectedCards.shift();
        selectedCards.push(index);
    }

    updateCardSelectionUI();
    updateSelectionInfo();
}

function updateCardSelectionUI() {
    const container = document.getElementById('game-hand');
    const cards = container.querySelectorAll('.response-card');

    cards.forEach((card, i) => {
        const selectionOrder = selectedCards.indexOf(i);
        if (selectionOrder > -1) {
            card.classList.add('selected');
            card.setAttribute('data-order', selectionOrder + 1);
        } else {
            card.classList.remove('selected');
            card.removeAttribute('data-order');
        }
    });
}

function updateSelectionInfo() {
    const info = document.getElementById('selection-info');
    const btn = document.getElementById('submit-combo-btn');
    
    if (selectedCards.length === cardsNeeded) {
        info.innerText = `✅ ${selectedCards.length}/${cardsNeeded} cards selected`;
        info.className = 'selection-info ready';
        btn.classList.remove('hidden');
    } else {
        info.innerText = `Select ${cardsNeeded - selectedCards.length} more card${cardsNeeded - selectedCards.length > 1 ? 's' : ''} (${selectedCards.length}/${cardsNeeded})`;
        info.className = 'selection-info';
        btn.classList.add('hidden');
    }
}

function submitCombo() {
    if (selectedCards.length !== cardsNeeded) return;
    playSound('submit');
    socket.emit('submit_cards', selectedCards);
}

function pickWinner(index) {
    playSound('click');
    socket.emit('pick_winner', index);
}

function renderHand(hand) {
    currentHand = hand;
    const container = document.getElementById('game-hand');
    container.innerHTML = '';
    
    hand.forEach((card, i) => {
        const div = document.createElement('div');
        div.className = 'response-card';
        
        const selectionOrder = selectedCards.indexOf(i);
        if (selectionOrder > -1) {
            div.classList.add('selected');
            div.setAttribute('data-order', selectionOrder + 1);
        }
        
        div.innerText = card;
        div.onclick = () => toggleCardSelection(i);
        container.appendChild(div);
    });
}

function renderComboCards(cards) {
    return cards.map(card => `<div class="combo-card">${card}</div>`).join('<div class="combo-plus">+</div>');
}

function renderPlayers(players, listId) {
    const list = document.getElementById(listId);
    list.innerHTML = '';
    players.forEach((p, i) => {
        const li = document.createElement('li');
        const isYou = (phonePartyMode && isHost && i === 0) ? ' (you)' : '';
        li.innerHTML = `<span>${p.avatar}</span> ${p.name}${isYou}`;
        list.appendChild(li);
    });
}

// ============ SOCKET EVENTS ============

socket.on('game_created', (data) => {
    playSound('join');
    if (data.sessionToken) {
        saveSession(data.roomCode, data.sessionToken);
    }
    if (data.phonePartyMode) {
        showScreen('phone-lobby-screen');
        document.getElementById('phone-room-code').innerText = data.roomCode;
        document.getElementById('phone-join-url').innerText = window.location.origin;
        document.getElementById('phone-packs-display').innerText = data.packs;
        document.getElementById('phone-players-list').innerHTML = `<li><span>${data.hostAvatar}</span> ${data.hostName} (you)</li>`;
        generateQRCode(data.roomCode, 'phone-qr-code');
        playerCount = 1;
        updateStartButton(playerCount, 'phone-start-btn');
    } else {
        showScreen('host-screen');
        document.getElementById('room-code-display').innerText = data.roomCode;
        document.getElementById('join-url').innerText = window.location.origin;
        document.getElementById('host-packs-display').innerText = data.packs;
        generateQRCode(data.roomCode, 'host-qr-code');
    }
});

socket.on('player_joined', (data) => {
    playSound('join');
    playerCount = data.playerCount;
    
    if (phonePartyMode && isHost) {
        renderPlayers(data.players, 'phone-players-list');
        updateStartButton(playerCount, 'phone-start-btn');
    } else if (isHost) {
        document.getElementById('player-count').innerText = playerCount;
        const li = document.createElement('li');
        li.innerHTML = `<span>${data.avatar}</span> ${data.playerName}`;
        document.getElementById('players-list').appendChild(li);
        updateStartButton(playerCount, 'start-btn');
    }
});

socket.on('joined_success', (data) => {
    playSound('join');
    if (data.sessionToken) {
        saveSession(data.roomCode, data.sessionToken);
    }
    showScreen('waiting-screen');
    document.getElementById('my-name-display').innerText = data.playerName;
    document.getElementById('my-avatar').innerText = data.avatar;
    document.getElementById('waiting-packs').innerText = data.packs;
});

socket.on('error_msg', (msg) => { document.getElementById('error-msg').innerText = msg; });
socket.on('game_starting', () => { playSound('click'); });

socket.on('rejoin_success', (data) => {
    playSound('join');
    saveSession(data.roomCode, getSession()?.sessionToken);

    // Restore game state based on current state
    if (data.gameState === 'lobby') {
        showScreen('waiting-screen');
        document.getElementById('my-name-display').innerText = data.playerName;
        document.getElementById('my-avatar').innerText = data.avatar;
        document.getElementById('waiting-packs').innerText = data.packs;
    } else if (data.gameState === 'playing') {
        cardsNeeded = data.cardsNeeded;
        isJudge = data.isJudge;
        selectedCards = [];

        showScreen('game-screen');
        document.getElementById('game-round').innerText = data.currentRound;
        document.getElementById('game-max-rounds').innerText = data.maxRounds;
        document.getElementById('game-prompt').innerText = data.prompt;

        if (data.hasSubmitted) {
            showScreen('submitted-screen');
        } else if (isJudge) {
            document.getElementById('game-hand-section').classList.add('hidden');
            document.getElementById('game-judge-section').classList.remove('hidden');
        } else {
            document.getElementById('game-hand-section').classList.remove('hidden');
            document.getElementById('game-judge-section').classList.add('hidden');
            renderHand(data.hand);
            updateSelectionInfo();
        }
    } else if (data.gameState === 'reveal') {
        showScreen('reveal-screen');
        document.getElementById('reveal-prompt').innerText = data.prompt;
    }

    console.log('Rejoined game:', data.roomCode);
});

socket.on('rejoin_failed', (reason) => {
    clearSession();
    console.log('Rejoin failed:', reason);
});

socket.on('round_start', (data) => {
    playSound('reveal');
    selectedCards = [];
    cardsNeeded = data.cardsNeeded || 1;
    isJudge = data.isJudge || false;
    
    document.getElementById('game-round').innerText = data.round;
    document.getElementById('game-max-rounds').innerText = data.maxRounds;
    document.getElementById('game-prompt').innerText = data.prompt;
    document.getElementById('game-judge-badge').innerText = `👑 Judge: ${data.judgeAvatar} ${data.judgeName}`;
    document.getElementById('point-badge').innerText = `${data.pointValue} PT${data.pointValue > 1 ? 'S' : ''}`;
    
    const promptCard = document.getElementById('game-prompt');
    const roundLabel = document.getElementById('round-label');
    promptCard.classList.remove('double', 'triple');
    roundLabel.classList.add('hidden');
    
    if (data.cardsNeeded === 2) {
        promptCard.classList.add('double');
        roundLabel.innerText = data.roundLabel || '🔥 DOUBLE COMBO!';
        roundLabel.className = 'round-label double';
    } else if (data.cardsNeeded === 3) {
        promptCard.classList.add('triple');
        roundLabel.innerText = data.roundLabel || '💀 TRIPLE THREAT!';
        roundLabel.className = 'round-label triple';
    }
    
    if (data.phonePartyMode || !isHost) {
        showScreen('game-screen');
        
        if (isJudge) {
            document.getElementById('game-hand-section').classList.add('hidden');
            document.getElementById('game-judge-section').classList.remove('hidden');
            document.getElementById('game-waiting-section').classList.remove('hidden');
            document.getElementById('submit-progress').innerText = `0/${data.playerCount - 1}`;
            document.getElementById('submit-bar').style.width = '0%';
        } else {
            document.getElementById('game-hand-section').classList.remove('hidden');
            document.getElementById('game-judge-section').classList.add('hidden');
            document.getElementById('game-waiting-section').classList.add('hidden');
            document.getElementById('submit-combo-btn').classList.add('hidden');
            renderHand(data.hand);
            updateSelectionInfo();
        }
    } else if (isHost) {
        showScreen('game-screen');
        document.getElementById('game-hand-section').classList.add('hidden');
        document.getElementById('game-judge-section').classList.add('hidden');
        document.getElementById('game-waiting-section').classList.remove('hidden');
        document.getElementById('submit-progress').innerText = '0/?';
    }
});

socket.on('your_turn', (data) => {
    playSound('reveal');
    selectedCards = [];
    cardsNeeded = data.cardsNeeded || 1;
    isJudge = data.isJudge;
    
    showScreen('game-screen');
    document.getElementById('game-prompt').innerText = data.prompt;
    document.getElementById('point-badge').innerText = `${data.pointValue} PT${data.pointValue > 1 ? 'S' : ''}`;
    
    const promptCard = document.getElementById('game-prompt');
    const roundLabel = document.getElementById('round-label');
    promptCard.classList.remove('double', 'triple');
    roundLabel.classList.add('hidden');
    
    if (data.cardsNeeded === 2) {
        promptCard.classList.add('double');
        roundLabel.innerText = data.roundLabel || '🔥 DOUBLE COMBO!';
        roundLabel.className = 'round-label double';
    } else if (data.cardsNeeded === 3) {
        promptCard.classList.add('triple');
        roundLabel.innerText = data.roundLabel || '💀 TRIPLE THREAT!';
        roundLabel.className = 'round-label triple';
    }
    
    if (isJudge) {
        document.getElementById('game-judge-badge').innerText = `👑 You are the Judge!`;
        document.getElementById('game-hand-section').classList.add('hidden');
        document.getElementById('game-judge-section').classList.remove('hidden');
        document.getElementById('game-waiting-section').classList.add('hidden');
    } else {
        document.getElementById('game-judge-badge').innerText = `👑 Judge: ${data.judgeName}`;
        document.getElementById('game-hand-section').classList.remove('hidden');
        document.getElementById('game-judge-section').classList.add('hidden');
        document.getElementById('game-waiting-section').classList.add('hidden');
        document.getElementById('submit-combo-btn').classList.add('hidden');
        renderHand(data.hand);
        updateSelectionInfo();
    }
});

socket.on('player_submitted', (data) => {
    playSound('submit');
    const pct = (data.submittedCount / data.totalPlayers) * 100;
    document.getElementById('submit-progress').innerText = `${data.submittedCount}/${data.totalPlayers}`;
    document.getElementById('submit-bar').style.width = pct + '%';
});

socket.on('card_submitted', () => { showScreen('submitted-screen'); });

socket.on('start_reveal', (data) => {
    showScreen('reveal-screen');
    document.getElementById('reveal-prompt').innerText = data.prompt;
    document.getElementById('revealed-cards').innerHTML = '';
    document.getElementById('reveal-status').innerText = `0 of ${data.submissionCount}`;
    document.getElementById('reveal-btn').classList.remove('hidden');
    document.getElementById('reveal-point-badge').innerText = `${data.pointValue} PT${data.pointValue > 1 ? 'S' : ''}`;
    
    const canReveal = data.isJudge || (isHost && !phonePartyMode);
    document.getElementById('reveal-controls').classList.toggle('hidden', !canReveal);
    document.getElementById('judge-pick-section').classList.add('hidden');
    document.getElementById('watch-section').classList.toggle('hidden', canReveal);
});

socket.on('judge_reveal', (data) => {
    showScreen('reveal-screen');
    document.getElementById('reveal-prompt').innerText = data.prompt;
    document.getElementById('revealed-cards').innerHTML = '';
    document.getElementById('reveal-controls').classList.add('hidden');
    document.getElementById('judge-pick-section').classList.add('hidden');
    document.getElementById('watch-section').classList.remove('hidden');
});

socket.on('watch_reveal', () => {
    showScreen('reveal-screen');
    document.getElementById('reveal-controls').classList.add('hidden');
    document.getElementById('judge-pick-section').classList.add('hidden');
    document.getElementById('watch-section').classList.remove('hidden');
});

socket.on('card_revealed', (data) => {
    playSound('reveal');
    
    const div = document.createElement('div');
    div.className = 'combo-submission';
    div.innerHTML = renderComboCards(data.cards);
    div.dataset.index = data.index;
    
    const canPick = data.isJudge || isJudge;
    if (canPick) div.onclick = () => pickWinner(data.index);
    
    document.getElementById('revealed-cards').appendChild(div);
    
    document.getElementById('reveal-status').innerText = data.isLast ? 'All revealed!' : `${data.index + 1} revealed`;
    
    if (data.isLast) {
        document.getElementById('reveal-btn').classList.add('hidden');
        if (canPick) {
            document.getElementById('judge-pick-section').classList.remove('hidden');
            document.getElementById('watch-section').classList.add('hidden');
        }
    }
});

socket.on('round_winner', (data) => {
    playSound('winner');
    showScreen('winner-screen');
    document.getElementById('winner-display').innerText = data.isYou ? '🎉 YOU WON!' : `${data.winnerAvatar} ${data.winnerName}`;
    document.getElementById('points-won-display').innerText = `+${data.pointsWon} point${data.pointsWon > 1 ? 's' : ''}`;
    document.getElementById('winner-prompt').innerText = data.prompt || '';
    document.getElementById('winner-card').innerHTML = renderComboCards(data.winningCards);
    
    if (data.scores) {
        document.getElementById('winner-scores-section').classList.remove('hidden');
        const scoresList = document.getElementById('winner-scores');
        scoresList.innerHTML = '';
        data.scores.sort((a, b) => b.score - a.score).forEach((p, i) => {
            const div = document.createElement('div');
            div.className = 'leaderboard-item' + (i === 0 ? ' first' : '');
            div.innerHTML = `<span>${p.avatar} ${p.name}</span><span class="score">${p.score}</span>`;
            scoresList.appendChild(div);
        });
    } else {
        document.getElementById('winner-scores-section').classList.add('hidden');
    }
    
    const showBtn = data.phonePartyMode ? data.isHost : isHost;
    document.getElementById('next-round-btn').classList.toggle('hidden', !showBtn);
    
    triggerConfetti();
});

socket.on('game_over', (data) => {
    playSound('winner');
    showScreen('gameover-screen');
    document.getElementById('final-winner').innerText = `${data.winner.avatar} ${data.winner.name} - ${data.winner.score} pts`;
    
    const scoresList = document.getElementById('final-scores');
    scoresList.innerHTML = '';
    data.leaderboard.forEach((p, i) => {
        const div = document.createElement('div');
        div.className = 'leaderboard-item' + (i === 0 ? ' first' : '');
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
        div.innerHTML = `<span>${medal} ${p.avatar} ${p.name}</span><span class="score">${p.score}</span>`;
        scoresList.appendChild(div);
    });
    
    const showBtn = data.phonePartyMode ? data.isHost : isHost;
    document.getElementById('play-again-btn').classList.toggle('hidden', !showBtn);
    
    triggerConfetti();
});

socket.on('reset_to_lobby', () => { showScreen('waiting-screen'); });

socket.on('back_to_lobby', (data) => {
    if (data.phonePartyMode) {
        showScreen('phone-lobby-screen');
        renderPlayers(data.players, 'phone-players-list');
        playerCount = data.players.length;
        updateStartButton(playerCount, 'phone-start-btn');
    } else {
        showScreen('host-screen');
        renderPlayers(data.players, 'players-list');
        playerCount = data.players.length;
        document.getElementById('player-count').innerText = playerCount;
        updateStartButton(playerCount, 'start-btn');
    }
});

socket.on('game_ended', (reason) => {
    clearSession();
    document.getElementById('end-reason').innerText = reason;
    showScreen('ended-screen');
});

socket.on('player_left', (data) => {
    playerCount = data.playerCount;
    if (isHost) {
        if (phonePartyMode) updateStartButton(playerCount, 'phone-start-btn');
        else {
            document.getElementById('player-count').innerText = playerCount;
            updateStartButton(playerCount, 'start-btn');
        }
    }
});

// ============ KEYBOARD ============
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (!document.getElementById('join-screen').classList.contains('hidden')) joinGame();
        if (!document.getElementById('phone-party-setup').classList.contains('hidden')) hostPhoneParty();
    }
});

// ============ AUTO-JOIN FROM URL ============
(function checkUrlCode() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
        showJoinScreen();
        document.getElementById('p-code').value = code.toUpperCase();
        document.getElementById('p-name').focus();
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
})();
