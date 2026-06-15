const express = require('express');
const router = express.Router();
const { User, Transaction } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');
const { gameOverrides } = require('./admin');

// ─── Helper: get user ────────────────────────────────────────────────────────
async function getUser(req) {
  const user = await User.findById(req.user.id);
  if (!user) throw new Error('User not found');
  return user;
}

// ─── Helper: validate bet ────────────────────────────────────────────────────
function validateBet(user, betAmount) {
  if (!betAmount || betAmount <= 0) throw new Error('Invalid bet amount');
  if (user.balance < betAmount) throw new Error('Insufficient balance');
}

// ─── Helper: save transaction ────────────────────────────────────────────────
async function saveTransaction(user, type, amount, payout) {
  user.balance = parseFloat((user.balance - amount + payout).toFixed(8));
  await user.save();
  await Transaction.create({
    username: user.username,
    type,
    amount,
    balanceAfter: user.balance,
    timestamp: new Date()
  });
  return user.balance;
}

// ─── Helper: resolve outcome ─────────────────────────────────────────────────
function resolveOutcome(game, randomFn) {
  const override = gameOverrides[game];
  if (override === null || override === undefined || override === 'random') {
    return randomFn();
  }
  return override;
}

// Active mines sessions
const mineSessions = {};

router.use(authenticateToken);

// COINFLIP
router.post('/coinflip/play', async (req, res) => {
  try {
    const { betAmount, choice } = req.body;
    if (!['heads', 'tails'].includes(choice)) return res.status(400).json({ success: false, message: 'Choice must be heads or tails' });
    const user = await getUser(req);
    validateBet(user, betAmount);
    const outcome = resolveOutcome('coinflip', () => Math.random() < 0.5 ? 'heads' : 'tails');
    const win = outcome === choice;
    const payout = win ? betAmount * 2 : 0;
    const newBalance = await saveTransaction(user, 'coinflip', betAmount, payout);
    res.json({ success: true, outcome, win, payout, betAmount, newBalance });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DICE
router.post('/dice/play', async (req, res) => {
  try {
    const { betAmount, rollOver } = req.body;
    if (rollOver < 2 || rollOver > 98) return res.status(400).json({ success: false, message: 'rollOver must be 2-98' });
    const user = await getUser(req);
    validateBet(user, betAmount);
    const roll = resolveOutcome('dice', () => Math.floor(Math.random() * 100) + 1);
    const win = roll > rollOver;
    const chance = (100 - rollOver) / 100;
    const multiplier = parseFloat((0.99 / chance).toFixed(4));
    const payout = win ? parseFloat((betAmount * multiplier).toFixed(8)) : 0;
    const newBalance = await saveTransaction(user, 'dice', betAmount, payout);
    res.json({ success: true, roll, rollOver, win, multiplier, payout, betAmount, newBalance });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// HILO
router.post('/hilo/play', async (req, res) => {
  try {
    const { betAmount, choice, currentCardNumber } = req.body;
    const user = await getUser(req);
    validateBet(user, betAmount);
    const nextCard = resolveOutcome('hilo', () => Math.floor(Math.random() * 13) + 1);
    const win = choice === 'higher' ? nextCard > currentCardNumber : nextCard < currentCardNumber;
    const payout = win ? parseFloat((betAmount * 1.9).toFixed(8)) : 0;
    const newBalance = await saveTransaction(user, 'hilo', betAmount, payout);
    res.json({ success: true, nextCard, currentCardNumber, choice, win, payout, betAmount, newBalance });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// MINES - Start
router.post('/mines/start', async (req, res) => {
  try {
    const { betAmount, mineCount = 3 } = req.body;
    if (mineCount < 1 || mineCount > 24) return res.status(400).json({ success: false, message: 'mineCount must be 1-24' });
    const user = await getUser(req);
    validateBet(user, betAmount);
    user.balance = parseFloat((user.balance - betAmount).toFixed(8));
    await user.save();
    let minePositions;
    const override = gameOverrides['mines'];
    if (override && Array.isArray(override)) {
      minePositions = override;
    } else {
      minePositions = [];
      while (minePositions.length < mineCount) {
        const pos = Math.floor(Math.random() * 25);
        if (!minePositions.includes(pos)) minePositions.push(pos);
      }
    }
    mineSessions[req.user.id] = { betAmount, mineCount, minePositions, revealed: [], multiplier: 1, active: true };
    res.json({ success: true, mineCount, totalTiles: 25, balance: user.balance });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// MINES - Click
router.post('/mines/click', async (req, res) => {
  try {
    const { tileIndex } = req.body;
    const session = mineSessions[req.user.id];
    if (!session || !session.active) return res.status(400).json({ success: false, message: 'No active game' });
    if (session.revealed.includes(tileIndex)) return res.status(400).json({ success: false, message: 'Already revealed' });
    const isMine = session.minePositions.includes(tileIndex);
    if (isMine) {
      session.active = false;
      const user = await getUser(req);
      await Transaction.create({ username: user.username, type: 'mines', amount: session.betAmount, balanceAfter: user.balance, timestamp: new Date() });
      delete mineSessions[req.user.id];
      res.json({ success: true, isMine: true, minePositions: session.minePositions, newBalance: user.balance });
    } else {
      session.revealed.push(tileIndex);
      const safeTiles = 25 - session.mineCount;
      session.multiplier = parseFloat((1 + (session.revealed.length / safeTiles) * 4).toFixed(2));
      res.json({ success: true, isMine: false, multiplier: session.multiplier, revealed: session.revealed });
    }
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// MINES - Cashout
router.post('/mines/cashout', async (req, res) => {
  try {
    const session = mineSessions[req.user.id];
    if (!session || !session.active) return res.status(400).json({ success: false, message: 'No active game' });
    session.active = false;
    const user = await getUser(req);
    const payout = parseFloat((session.betAmount * session.multiplier).toFixed(8));
    user.balance = parseFloat((user.balance + payout).toFixed(8));
    await user.save();
    await Transaction.create({ username: user.username, type: 'mines', amount: session.betAmount, balanceAfter: user.balance, timestamp: new Date() });
    delete mineSessions[req.user.id];
    res.json({ success: true, payout, multiplier: session.multiplier, newBalance: user.balance });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// MINES - Active
router.get('/mines/active', async (req, res) => {
  const session = mineSessions[req.user.id];
  if (!session || !session.active) return res.json({ active: false });
  res.json({ active: true, mineCount: session.mineCount, revealed: session.revealed, multiplier: session.multiplier });
});

// ROULETTE
router.post('/roulette/play', async (req, res) => {
  try {
    const { bets } = req.body;
    if (!bets || typeof bets !== 'object') return res.status(400).json({ success: false, message: 'Bets required' });
    const totalBet = Object.values(bets).reduce((a, b) => a + b, 0);
    const user = await getUser(req);
    validateBet(user, totalBet);
    const redNumbers = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    const spinResult = resolveOutcome('roulette', () => Math.floor(Math.random() * 37));
    const num = parseInt(spinResult);
    const isRed = redNumbers.includes(num);
    const color = num === 0 ? 'green' : isRed ? 'red' : 'black';
    let totalPayout = 0;
    const betResults = {};
    for (const [betKey, betValue] of Object.entries(bets)) {
      let win = false;
      let multiplier = 0;
      if (betKey.startsWith('number_')) { win = num === parseInt(betKey.split('_')[1]); multiplier = 36; }
      else if (betKey === 'color_red') { win = isRed && num !== 0; multiplier = 2; }
      else if (betKey === 'color_black') { win = !isRed && num !== 0; multiplier = 2; }
      else if (betKey === 'even') { win = num !== 0 && num % 2 === 0; multiplier = 2; }
      else if (betKey === 'odd') { win = num !== 0 && num % 2 !== 0; multiplier = 2; }
      else if (betKey === 'low') { win = num >= 1 && num <= 18; multiplier = 2; }
      else if (betKey === 'high') { win = num >= 19 && num <= 36; multiplier = 2; }
      else if (betKey === 'dozen_1') { win = num >= 1 && num <= 12; multiplier = 3; }
      else if (betKey === 'dozen_2') { win = num >= 13 && num <= 24; multiplier = 3; }
      else if (betKey === 'dozen_3') { win = num >= 25 && num <= 36; multiplier = 3; }
      const payout = win ? betValue * multiplier : 0;
      totalPayout += payout;
      betResults[betKey] = { win, payout };
    }
    const newBalance = await saveTransaction(user, 'roulette', totalBet, totalPayout);
    res.json({ success: true, outcome: num, color, betResults, totalBet, totalPayout, newBalance });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// HISTORY
router.get('/history', async (req, res) => {
  try {
    const user = await getUser(req);
    const limit = parseInt(req.query.limit) || 10;
    const games = ['coinflip','dice','hilo','mines','roulette'];
    const history = await Transaction.find({ username: user.username, type: { $in: games } }).sort({ timestamp: -1 }).limit(limit);
    res.json({ success: true, history });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/:gameType/history', async (req, res) => {
  try {
    const user = await getUser(req);
    const limit = parseInt(req.query.limit) || 5;
    const history = await Transaction.find({ username: user.username, type: req.params.gameType }).sort({ timestamp: -1 }).limit(limit);
    res.json({ success: true, history });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
