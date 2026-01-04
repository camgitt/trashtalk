# TRASH TALK 🗑️💬

A party game for terrible people. Like Cards Against Humanity but playable on phones.

## Features

- **📱 Phone Party Mode** - No TV needed, host plays too
- **🖥️ TV Mode** - Display on big screen, players join on phones
- **🎴 Card Packs** - Choose which content packs to play with
- **🔥 Escalating Rounds** - 2 cards in middle rounds, 3 cards in final rounds
- **🔊 Sound Effects** - Fun audio feedback
- **✨ Animations** - Smooth card reveals and confetti

## Card Packs

| Pack | Icon | Description |
|------|------|-------------|
| College Life | 🎓 | Dorms, parties, bad decisions |
| Extra Spicy | 🌶️ | The really dirty ones |
| Family & Marriage | 👨‍👩‍👧 | Kids, spouse, midlife crisis |
| Tame & Wholesome | 😂 | Safe for (most) company |
| Work Life | 💼 | Office, LinkedIn, corporate hell |
| Pop Culture | 🎬 | Memes, celebs, trends |

## File Structure

```
trash-talk-game/
├── server.js              ← Main server (Express + Socket.io)
├── package.json
├── .gitignore
│
├── config/                ← EDIT THESE TO CHANGE GAME
│   ├── cards.json         ← All card packs and content
│   ├── settings.json      ← Min players, hand size, etc.
│   └── rounds.json        ← Round phases and point values
│
└── public/
    ├── index.html         ← Main HTML structure
    │
    ├── css/
    │   ├── base.css       ← Fonts, colors, layout
    │   ├── components.css ← Buttons, inputs, badges
    │   ├── cards.css      ← Card styling
    │   └── animations.css ← All animations
    │
    └── js/
        ├── app.js         ← Main game logic
        ├── sounds.js      ← Audio effects
        └── confetti.js    ← Celebration animation
```

## Quick Edits

| What you want to change | File to edit |
|-------------------------|--------------|
| Add/remove cards | `config/cards.json` |
| Change when combos start | `config/rounds.json` |
| Change min players | `config/settings.json` |
| Change colors/fonts | `public/css/base.css` |
| Change card appearance | `public/css/cards.css` |
| Change animations | `public/css/animations.css` |
| Add new sounds | `public/js/sounds.js` |
| Change game flow | `server.js` |

## Setup

```bash
npm install
npm start
```

Visit `http://localhost:3000`

## Deploy to Render

1. Push to GitHub
2. Create new Web Service on Render
3. Connect your repo
4. Set build command: `npm install`
5. Set start command: `npm start`
6. Deploy!

## Adding New Card Packs

Edit `config/cards.json` and add a new pack:

```json
"yourpack": {
  "name": "Your Pack Name",
  "icon": "🎯",
  "description": "Short description",
  "prompts": ["Prompt with ______."],
  "prompts_2": ["Double prompt: ______ and ______."],
  "prompts_3": ["Triple: ______, ______, and ______."],
  "responses": ["response card text"]
}
```

The pack will automatically appear in the selection screen!
