# 🗑️ TRASH TALK

A Cards Against Humanity-style party game with Jackbox-style phone controllers.

## Play Online

Host the game on any device, players join on their phones with a 4-letter code.

## Deploy Your Own

### Render (Recommended - Free)
1. Push this code to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Click Deploy

### Railway (Also Free)
1. Push to GitHub
2. Go to [railway.app](https://railway.app)
3. New Project → Deploy from GitHub repo
4. Done - it auto-detects Node.js

### Local Development
```bash
npm install
npm start
# Open http://localhost:3000
```

## How to Play

1. **Host** opens the game on a TV/laptop and clicks "Host Game"
2. **Players** go to the URL on their phones and enter the room code
3. Each round, a **Judge** is selected (rotates each round)
4. Players pick their funniest response card
5. Judge reveals cards one by one and picks the winner
6. First to win the most rounds after 10 rounds wins!

## Tech Stack
- Node.js + Express
- Socket.io for real-time multiplayer
- Vanilla JS frontend (no build step)

## Adding Cards

Edit the arrays in `server.js`:
- `PROMPT_CARDS` - The black "fill in the blank" cards
- `RESPONSE_CARDS` - The white answer cards
