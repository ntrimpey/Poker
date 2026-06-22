# Poker

A multiplayer Texas Hold'em room game designed for a shared TV and phone controllers.

## Features

- Create a five-character room code from the TV/table view.
- Players join from phones with the room code and a display name.
- Private hole cards and betting controls are shown only on each player's phone.
- The TV displays community cards, pot/current bet, seats, dealer/blind badges, winner messages,
  and a live betting-action log.
- In-memory Texas Hold'em engine with blinds, turn order, betting rounds, all-in handling,
  hand evaluation, and side-pot payouts.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL on the TV and choose **Host a TV table**. Players can scan/type the displayed
URL or open the app on their phones and enter the room code.

For a single production process:

```bash
npm run build
npm start
```

The production server serves the built React app and the Socket.IO game server from the same port.
