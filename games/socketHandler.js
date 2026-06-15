const { User, Transaction } = require('../config/store');
const { gameOverrides, activeRounds } = require('../routes/admin');

// ─── Helper: resolve outcome based on admin override ───────────────────────
// mode: null = random, 'house' = house wins, specific value = forced outcome
function resolveOutcome(game, randomFn) {
  const override = gameOverrides[game];
  if (override === null || override === undefined) {
    return { outcome: randomFn(), manipulated: false };
  }
  if (override === 'random') {
    return { outcome: randomFn(), manipulated: false };
  }
  // Admin has set a forced value
  return { outcome: override, manipulated: true };
}

// ─── Helper: save transaction & update balance ──────────────────────────────
async function settle(userId, game, bet, payout) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  user.balance = parseFloat((user.balance + payout - bet).toFixed(8));
  await user.save();
  await Transaction.create({
    userId,
    type: game,
    bet,
    payout,
    profit: payout - bet,
    balanceAfter: user.balance,
    createdAt: new Date()
  });
  return user.balance;
}

// ─── Helper: validate bet ───────────────────────────────────────────────────
async function validateBet(userId, bet) {
  if (!bet || bet <= 0) throw new Error('Invalid bet amount');
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (user.balance < bet) throw new Error('Insufficient balance');
  return user;
}

// ════════════════════════════════════════════════════════════════════════════
//  GAME HANDLERS
// ════════════════════════════════════════════════════════════════════════════

// ─── 1. COINFLIP ────────────────────────────────────────────────────────────
function registerCoinflip(io, socket) {
  socket.on('coinflip:bet', async ({ bet, choice }) => {
    // choice: 'heads' | 'tails'
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('coinflip:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      const { outcome } = resolveOutcome('coinflip', () =>
        Math.random() < 0.5 ? 'heads' : 'tails'
      );

      const win = outcome === choice;
      const payout = win ? bet * 2 : 0;
      const newBalance = await settle(socket.user.id, 'coinflip', bet, payout);

      socket.emit('coinflip:result', { outcome, win, payout, bet, newBalance });
    } catch (err) {
      socket.emit('coinflip:error', { error: err.message });
    }
  });
}

// ─── 2. DICE ────────────────────────────────────────────────────────────────
function registerDice(io, socket) {
  socket.on('dice:bet', async ({ bet, guess }) => {
    // guess: 1-6
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('dice:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      const { outcome } = resolveOutcome('dice', () =>
        Math.floor(Math.random() * 6) + 1
      );

      const win = parseInt(outcome) === parseInt(guess);
      const payout = win ? bet * 5 : 0;
      const newBalance = await settle(socket.user.id, 'dice', bet, payout);

      socket.emit('dice:result', { outcome, guess, win, payout, bet, newBalance });
    } catch (err) {
      socket.emit('dice:error', { error: err.message });
    }
  });
}

// ─── 3. HILO ────────────────────────────────────────────────────────────────
function registerHiLo(io, socket) {
  // Game state per socket
  const state = {};

  socket.on('hilo:start', async ({ bet }) => {
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('hilo:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      const firstCard = Math.floor(Math.random() * 13) + 1; // 1-13 (Ace to King)
      state[socket.user.id] = { bet, currentCard: firstCard, multiplier: 1, active: true };

      socket.emit('hilo:card', { card: firstCard, multiplier: 1 });
    } catch (err) {
      socket.emit('hilo:error', { error: err.message });
    }
  });

  socket.on('hilo:guess', async ({ guess }) => {
    // guess: 'high' | 'low'
    try {
      const s = state[socket.user.id];
      if (!s || !s.active) return socket.emit('hilo:error', { error: 'No active game' });

      const { outcome: nextCard } = resolveOutcome('hilo', () =>
        Math.floor(Math.random() * 13) + 1
      );

      const win = guess === 'high' ? nextCard > s.currentCard : nextCard < s.currentCard;

      if (win) {
        s.multiplier = parseFloat((s.multiplier * 1.5).toFixed(2));
        s.currentCard = nextCard;
        socket.emit('hilo:card', { card: nextCard, multiplier: s.multiplier, win: true });
      } else {
        s.active = false;
        await settle(socket.user.id, 'hilo', s.bet, 0);
        const user = await User.findById(socket.user.id);
        socket.emit('hilo:bust', { card: nextCard, newBalance: user.balance });
        delete state[socket.user.id];
      }
    } catch (err) {
      socket.emit('hilo:error', { error: err.message });
    }
  });

  socket.on('hilo:cashout', async () => {
    try {
      const s = state[socket.user.id];
      if (!s || !s.active) return socket.emit('hilo:error', { error: 'No active game' });
      s.active = false;
      const payout = parseFloat((s.bet * s.multiplier).toFixed(8));
      const newBalance = await settle(socket.user.id, 'hilo', s.bet, payout);
      socket.emit('hilo:cashout', { payout, multiplier: s.multiplier, newBalance });
      delete state[socket.user.id];
    } catch (err) {
      socket.emit('hilo:error', { error: err.message });
    }
  });
}

// ─── 4. MINES ───────────────────────────────────────────────────────────────
function registerMines(io, socket) {
  const state = {};

  socket.on('mines:start', async ({ bet, mineCount = 3 }) => {
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('mines:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      // 25 tiles, place mines
      let minePositions;
      const override = gameOverrides['mines'];
      if (override && Array.isArray(override)) {
        minePositions = override; // Admin sets mine positions
      } else {
        minePositions = [];
        while (minePositions.length < mineCount) {
          const pos = Math.floor(Math.random() * 25);
          if (!minePositions.includes(pos)) minePositions.push(pos);
        }
      }

      state[socket.user.id] = {
        bet, mineCount, minePositions,
        revealed: [], multiplier: 1, active: true
      };

      socket.emit('mines:started', { mineCount, totalTiles: 25 });
    } catch (err) {
      socket.emit('mines:error', { error: err.message });
    }
  });

  socket.on('mines:reveal', async ({ tile }) => {
    try {
      const s = state[socket.user.id];
      if (!s || !s.active) return socket.emit('mines:error', { error: 'No active game' });
      if (s.revealed.includes(tile)) return socket.emit('mines:error', { error: 'Already revealed' });

      if (s.minePositions.includes(tile)) {
        s.active = false;
        await settle(socket.user.id, 'mines', s.bet, 0);
        const user = await User.findById(socket.user.id);
        socket.emit('mines:boom', { tile, minePositions: s.minePositions, newBalance: user.balance });
        delete state[socket.user.id];
      } else {
        s.revealed.push(tile);
        const safeCount = 25 - s.mineCount;
        s.multiplier = parseFloat((1 + (s.revealed.length / safeCount) * 3).toFixed(2));
        socket.emit('mines:safe', { tile, multiplier: s.multiplier, revealed: s.revealed });
      }
    } catch (err) {
      socket.emit('mines:error', { error: err.message });
    }
  });

  socket.on('mines:cashout', async () => {
    try {
      const s = state[socket.user.id];
      if (!s || !s.active) return socket.emit('mines:error', { error: 'No active game' });
      s.active = false;
      const payout = parseFloat((s.bet * s.multiplier).toFixed(8));
      const newBalance = await settle(socket.user.id, 'mines', s.bet, payout);
      socket.emit('mines:cashout', { payout, multiplier: s.multiplier, newBalance });
      delete state[socket.user.id];
    } catch (err) {
      socket.emit('mines:error', { error: err.message });
    }
  });
}

// ─── 5. UPDOWN ──────────────────────────────────────────────────────────────
function registerUpDown(io, socket) {
  socket.on('updown:bet', async ({ bet, choice }) => {
    // choice: 'up' | 'down'
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('updown:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      const { outcome } = resolveOutcome('updown', () =>
        Math.random() < 0.5 ? 'up' : 'down'
      );

      const win = outcome === choice;
      const payout = win ? bet * 1.95 : 0; // slight house edge
      const newBalance = await settle(socket.user.id, 'updown', bet, payout);

      socket.emit('updown:result', { outcome, win, payout, bet, newBalance });
    } catch (err) {
      socket.emit('updown:error', { error: err.message });
    }
  });
}

// ─── 6. ROULETTE ────────────────────────────────────────────────────────────
function registerRoulette(io, socket) {
  socket.on('roulette:bet', async ({ bet, betType, value }) => {
    // betType: 'number'(0-36) | 'color'(red/black) | 'evenodd' | 'dozen' | 'half'
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('roulette:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      const redNumbers = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

      const { outcome: spinResult } = resolveOutcome('roulette', () =>
        Math.floor(Math.random() * 37) // 0-36
      );

      const num = parseInt(spinResult);
      const isRed = redNumbers.includes(num);
      const color = num === 0 ? 'green' : isRed ? 'red' : 'black';

      let win = false;
      let multiplier = 0;

      switch (betType) {
        case 'number':
          win = num === parseInt(value);
          multiplier = 36;
          break;
        case 'color':
          win = (value === 'red' && isRed) || (value === 'black' && !isRed && num !== 0);
          multiplier = 2;
          break;
        case 'evenodd':
          win = num !== 0 && ((value === 'even' && num % 2 === 0) || (value === 'odd' && num % 2 !== 0));
          multiplier = 2;
          break;
        case 'dozen':
          const d = parseInt(value); // 1, 2, or 3
          win = num >= (d-1)*12+1 && num <= d*12;
          multiplier = 3;
          break;
        case 'half':
          win = num !== 0 && ((value === '1' && num <= 18) || (value === '2' && num >= 19));
          multiplier = 2;
          break;
      }

      const payout = win ? bet * multiplier : 0;
      const newBalance = await settle(socket.user.id, 'roulette', bet, payout);

      socket.emit('roulette:result', { outcome: num, color, win, payout, bet, newBalance });
    } catch (err) {
      socket.emit('roulette:error', { error: err.message });
    }
  });
}

// ─── 7. BINGO ───────────────────────────────────────────────────────────────
function registerBingo(io, socket) {
  socket.on('bingo:buy', async ({ bet }) => {
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('bingo:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      // Give player a 5x5 card (1-75)
      const card = [];
      while (card.length < 25) {
        const n = Math.floor(Math.random() * 75) + 1;
        if (!card.includes(n)) card.push(n);
      }

      // Draw 30 numbers
      let drawnNumbers;
      const override = gameOverrides['bingo'];
      if (override && Array.isArray(override)) {
        drawnNumbers = override;
      } else {
        drawnNumbers = [];
        const pool = Array.from({ length: 75 }, (_, i) => i + 1);
        for (let i = 0; i < 30; i++) {
          const idx = Math.floor(Math.random() * pool.length);
          drawnNumbers.push(pool.splice(idx, 1)[0]);
        }
      }

      const matched = card.filter(n => drawnNumbers.includes(n));
      const win = matched.length >= 5; // simplified win condition
      const payout = win ? bet * 10 : matched.length >= 3 ? bet * 2 : 0;
      const newBalance = await settle(socket.user.id, 'bingo', bet, payout);

      socket.emit('bingo:result', { card, drawnNumbers, matched, win, payout, newBalance });
    } catch (err) {
      socket.emit('bingo:error', { error: err.message });
    }
  });
}

// ─── 8. RACING ──────────────────────────────────────────────────────────────
function registerRacing(io, socket) {
  socket.on('racing:bet', async ({ bet, horse }) => {
    // horse: 1-6
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('racing:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      const { outcome } = resolveOutcome('racing', () =>
        Math.floor(Math.random() * 6) + 1
      );

      // Simulate race progress
      const raceResults = Array.from({ length: 6 }, (_, i) => ({
        horse: i + 1,
        position: 0,
        finished: false
      }));

      const win = parseInt(outcome) === parseInt(horse);
      const payout = win ? bet * 5 : 0;
      const newBalance = await settle(socket.user.id, 'racing', bet, payout);

      socket.emit('racing:result', { winner: outcome, yourHorse: horse, win, payout, bet, newBalance });
    } catch (err) {
      socket.emit('racing:error', { error: err.message });
    }
  });
}

// ─── 9. LOTTERY ─────────────────────────────────────────────────────────────
function registerLottery(io, socket) {
  socket.on('lottery:buy', async ({ bet, picks }) => {
    // picks: array of 6 numbers (1-49)
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('lottery:error', { error: 'Game under maintenance' });
      if (!Array.isArray(picks) || picks.length !== 6) return socket.emit('lottery:error', { error: 'Pick 6 numbers' });
      await validateBet(socket.user.id, bet);

      let drawn;
      const override = gameOverrides['lottery'];
      if (override && Array.isArray(override)) {
        drawn = override;
      } else {
        drawn = [];
        const pool = Array.from({ length: 49 }, (_, i) => i + 1);
        for (let i = 0; i < 6; i++) {
          const idx = Math.floor(Math.random() * pool.length);
          drawn.push(pool.splice(idx, 1)[0]);
        }
      }

      const matched = picks.filter(n => drawn.includes(n)).length;
      let payout = 0;
      if (matched === 6) payout = bet * 1000;
      else if (matched === 5) payout = bet * 100;
      else if (matched === 4) payout = bet * 20;
      else if (matched === 3) payout = bet * 5;
      else if (matched === 2) payout = bet * 2;

      const newBalance = await settle(socket.user.id, 'lottery', bet, payout);
      socket.emit('lottery:result', { drawn, picks, matched, payout, newBalance });
    } catch (err) {
      socket.emit('lottery:error', { error: err.message });
    }
  });
}

// ─── 10. POKER (Video Poker - Jacks or Better) ──────────────────────────────
function registerPoker(io, socket) {
  const state = {};
  const SUITS = ['♠','♥','♦','♣'];
  const VALUES = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

  function newDeck() {
    const deck = [];
    for (const s of SUITS) for (const v of VALUES) deck.push({ suit: s, value: v });
    return deck.sort(() => Math.random() - 0.5);
  }

  function cardVal(card) { return VALUES.indexOf(card.value); }

  function evaluateHand(hand) {
    const vals = hand.map(cardVal).sort((a,b) => a-b);
    const suits = hand.map(c => c.suit);
    const counts = {};
    vals.forEach(v => counts[v] = (counts[v]||0)+1);
    const freq = Object.values(counts).sort((a,b) => b-a);
    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = vals[4]-vals[0]===4 && new Set(vals).size===5;
    const isRoyalStraight = JSON.stringify(vals) === JSON.stringify([8,9,10,11,12]);

    if (isFlush && isRoyalStraight) return { name: 'Royal Flush', mult: 250 };
    if (isFlush && isStraight) return { name: 'Straight Flush', mult: 50 };
    if (freq[0]===4) return { name: 'Four of a Kind', mult: 25 };
    if (freq[0]===3 && freq[1]===2) return { name: 'Full House', mult: 9 };
    if (isFlush) return { name: 'Flush', mult: 6 };
    if (isStraight) return { name: 'Straight', mult: 4 };
    if (freq[0]===3) return { name: 'Three of a Kind', mult: 3 };
    if (freq[0]===2 && freq[1]===2) return { name: 'Two Pair', mult: 2 };
    // Jacks or better
    const pairs = Object.entries(counts).filter(([v,c]) => c===2).map(([v]) => parseInt(v));
    if (pairs.some(v => v >= VALUES.indexOf('J'))) return { name: 'Jacks or Better', mult: 1 };
    return { name: 'No Win', mult: 0 };
  }

  socket.on('poker:deal', async ({ bet }) => {
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('poker:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      const deck = newDeck();
      const hand = deck.splice(0, 5);
      state[socket.user.id] = { bet, hand, deck };
      socket.emit('poker:hand', { hand });
    } catch (err) {
      socket.emit('poker:error', { error: err.message });
    }
  });

  socket.on('poker:hold', async ({ holdIndexes }) => {
    try {
      const s = state[socket.user.id];
      if (!s) return socket.emit('poker:error', { error: 'No active game' });

      // Replace non-held cards
      let finalHand;
      const override = gameOverrides['poker'];
      if (override && Array.isArray(override)) {
        finalHand = override; // Admin forces specific hand
      } else {
        finalHand = s.hand.map((card, i) =>
          holdIndexes.includes(i) ? card : s.deck.splice(0, 1)[0]
        );
      }

      const result = evaluateHand(finalHand);
      const payout = parseFloat((s.bet * result.mult).toFixed(8));
      const newBalance = await settle(socket.user.id, 'poker', s.bet, payout);

      socket.emit('poker:result', { hand: finalHand, result: result.name, payout, newBalance });
      delete state[socket.user.id];
    } catch (err) {
      socket.emit('poker:error', { error: err.message });
    }
  });
}

// ─── 11. SLOTS ──────────────────────────────────────────────────────────────
function registerSlots(io, socket) {
  const SYMBOLS = ['🍒','🍋','🍊','🍇','💎','7️⃣','⭐','🔔'];
  const WEIGHTS =  [30,  25,  20,  15,  5,   3,   1,   1]; // out of 100

  function spinReel() {
    const total = WEIGHTS.reduce((a,b)=>a+b,0);
    let r = Math.random()*total;
    for (let i=0; i<SYMBOLS.length; i++) {
      r -= WEIGHTS[i];
      if (r <= 0) return SYMBOLS[i];
    }
    return SYMBOLS[0];
  }

  function calcPayout(reels, bet) {
    const [a,b,c] = reels;
    if (a===b && b===c) {
      if (a==='7️⃣') return bet*50;
      if (a==='💎') return bet*20;
      if (a==='⭐') return bet*15;
      if (a==='🔔') return bet*10;
      if (a==='🍇') return bet*5;
      return bet*3;
    }
    if (a===b || b===c || a===c) return bet*1.5;
    if (reels.includes('🍒')) return bet*0.5;
    return 0;
  }

  socket.on('slots:spin', async ({ bet }) => {
    try {
      if (gameOverrides.maintenanceMode) return socket.emit('slots:error', { error: 'Game under maintenance' });
      await validateBet(socket.user.id, bet);

      let reels;
      const override = gameOverrides['slots'];
      if (override && Array.isArray(override)) {
        reels = override; // Admin sets combination
      } else {
        reels = [spinReel(), spinReel(), spinReel()];
      }

      const payout = parseFloat(calcPayout(reels, bet).toFixed(8));
      const newBalance = await settle(socket.user.id, 'slots', bet, payout);

      socket.emit('slots:result', { reels, payout, win: payout > 0, newBalance });
    } catch (err) {
      socket.emit('slots:error', { error: err.message });
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN EXPORT — called from server.js
// ════════════════════════════════════════════════════════════════════════════
function registerGameHandlers(io, socket) {
  registerCoinflip(io, socket);
  registerDice(io, socket);
  registerHiLo(io, socket);
  registerMines(io, socket);
  registerUpDown(io, socket);
  registerRoulette(io, socket);
  registerBingo(io, socket);
  registerRacing(io, socket);
  registerLottery(io, socket);
  registerPoker(io, socket);
  registerSlots(io, socket);
}

function initGames(io) {
  // Nothing needed on startup — rounds are admin-driven
  console.log('✅ All game handlers registered: Coinflip, Dice, HiLo, Mines, UpDown, Roulette, Bingo, Racing, Lottery, Poker, Slots');
}

module.exports = { registerGameHandlers, initGames };
