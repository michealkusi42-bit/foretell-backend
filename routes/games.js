const express = require('express');
const { users, transactions } = require('../config/store');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── Helpers ─────────────────────────────────────────────────
function deductBet(user, bet) {
  if (user.balance < bet) throw new Error('Insufficient balance');
  user.balance = parseFloat((user.balance - bet).toFixed(8));
}

function applyWin(user, payout) {
  user.balance = parseFloat((user.balance + payout).toFixed(8));
}

function recordTx(username, type, bet, payout, balanceAfter, meta = {}) {
  const tx = { id: uuidv4(), type, bet, payout, profit: payout - bet, balanceAfter, meta, timestamp: new Date() };
  const userTx = transactions.get(username) || [];
  userTx.push(tx);
  transactions.set(username, userTx);
  return tx;
}

// ── POST /api/games/dice ─────────────────────────────────────
// Body: { bet, target, over } — guess if roll is over/under target (1-100)
router.post('/dice', (req, res) => {
  try {
    const { bet, target, over } = req.body;
    if (!bet || bet <= 0 || !target || target < 2 || target > 98) {
      return res.status(400).json({ error: 'Invalid bet or target (2-98)' });
    }

    const user = users.get(req.user.username);
    deductBet(user, parseFloat(bet));

    const roll = parseFloat((Math.random() * 100).toFixed(2));
    const win = over ? roll > target : roll < target;
    const chance = over ? (100 - target) / 100 : target / 100;
    const multiplier = parseFloat((0.99 / chance).toFixed(4)); // 1% house edge
    const payout = win ? parseFloat((bet * multiplier).toFixed(8)) : 0;

    if (win) applyWin(user, payout);

    const tx = recordTx(req.user.username, 'dice', parseFloat(bet), payout, user.balance, { roll, target, over, multiplier });
    res.json({ roll, win, payout, multiplier, balance: user.balance, transaction: tx });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/games/crash ────────────────────────────────────
// Body: { bet, autoCashout } — cashout before the multiplier crashes
router.post('/crash/start', (req, res) => {
  try {
    const { bet, autoCashout } = req.body;
    if (!bet || bet <= 0) return res.status(400).json({ error: 'Invalid bet' });

    const user = users.get(req.user.username);
    deductBet(user, parseFloat(bet));

    // Provably fair crash point
    const r = Math.random();
    const crashAt = r < 0.01 ? 1.00 : parseFloat(Math.max(1, (0.99 / r)).toFixed(2));
    const cashedOutAt = autoCashout && autoCashout <= crashAt ? parseFloat(autoCashout) : null;
    const win = cashedOutAt !== null;
    const payout = win ? parseFloat((bet * cashedOutAt).toFixed(8)) : 0;

    if (win) applyWin(user, payout);

    const tx = recordTx(req.user.username, 'crash', parseFloat(bet), payout, user.balance, { crashAt, cashedOutAt, autoCashout });
    res.json({ crashAt, cashedOutAt, win, payout, balance: user.balance, transaction: tx });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/games/roulette ─────────────────────────────────
// Body: { bet, betType } — betType: 'red'|'black'|'green'|0-36
router.post('/roulette', (req, res) => {
  try {
    const { bet, betType } = req.body;
    if (!bet || bet <= 0 || betType === undefined) {
      return res.status(400).json({ error: 'Invalid bet or betType' });
    }

    const user = users.get(req.user.username);
    deductBet(user, parseFloat(bet));

    const result = Math.floor(Math.random() * 37); // 0-36
    const redNumbers = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    const color = result === 0 ? 'green' : redNumbers.includes(result) ? 'red' : 'black';

    let win = false;
    let multiplier = 0;

    if (betType === 'red' || betType === 'black') {
      win = color === betType;
      multiplier = 2;
    } else if (betType === 'green') {
      win = color === 'green';
      multiplier = 14;
    } else if (Number.isInteger(parseInt(betType))) {
      win = parseInt(betType) === result;
      multiplier = 36;
    }

    const payout = win ? parseFloat((bet * multiplier).toFixed(8)) : 0;
    if (win) applyWin(user, payout);

    const tx = recordTx(req.user.username, 'roulette', parseFloat(bet), payout, user.balance, { result, color, betType, multiplier });
    res.json({ result, color, win, payout, multiplier, balance: user.balance, transaction: tx });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/games/luckyspin ────────────────────────────────
// Body: { bet }
const SPIN_SEGMENTS = [
  { label: '0x', multiplier: 0, weight: 30 },
  { label: '0.5x', multiplier: 0.5, weight: 25 },
  { label: '1.5x', multiplier: 1.5, weight: 20 },
  { label: '2x', multiplier: 2, weight: 13 },
  { label: '3x', multiplier: 3, weight: 7 },
  { label: '5x', multiplier: 5, weight: 4 },
  { label: '10x', multiplier: 10, weight: 1 },
];

router.post('/luckyspin', (req, res) => {
  try {
    const { bet } = req.body;
    if (!bet || bet <= 0) return res.status(400).json({ error: 'Invalid bet' });

    const user = users.get(req.user.username);
    deductBet(user, parseFloat(bet));

    const totalWeight = SPIN_SEGMENTS.reduce((s, seg) => s + seg.weight, 0);
    let rand = Math.random() * totalWeight;
    let segment = SPIN_SEGMENTS[0];
    for (const seg of SPIN_SEGMENTS) {
      rand -= seg.weight;
      if (rand <= 0) { segment = seg; break; }
    }

    const payout = parseFloat((bet * segment.multiplier).toFixed(8));
    if (payout > 0) applyWin(user, payout);

    const tx = recordTx(req.user.username, 'luckyspin', parseFloat(bet), payout, user.balance, { segment: segment.label, multiplier: segment.multiplier });
    res.json({ segment: segment.label, multiplier: segment.multiplier, payout, win: payout > 0, balance: user.balance, transaction: tx });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── GET /api/games/history ───────────────────────────────────
router.get('/history', (req, res) => {
  const userTx = (transactions.get(req.user.username) || [])
    .filter(t => ['dice','crash','roulette','luckyspin'].includes(t.type))
    .slice(-50).reverse();
  res.json({ history: userTx });
});

module.exports = router;
