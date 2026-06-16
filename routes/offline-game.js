const express = require('express');
const { User, Transaction } = require('../config/store');
const { gameOverrides } = require('./admin');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);

async function deductBet(user, bet) {
  if (user.balance < bet) throw new Error('Insufficient balance');
  user.balance = parseFloat((user.balance - bet).toFixed(8));
}

function applyWin(user, payout) {
  user.balance = parseFloat((user.balance + payout).toFixed(8));
}

async function recordTx(username, type, bet, payout, balanceAfter, meta) {
  const tx = new Transaction({
    id: uuidv4(),
    username,
    type,
    bet,
    payout,
    profit: payout - bet,
    balanceAfter,
    timestamp: new Date(),
    ...meta
  });
  await tx.save();
  return tx;
}

// COINFLIP
router.post('/coinflip/play', async (req, res) => {
  try {
    const { betAmount, choice } = req.body;
    if (!betAmount || betAmount <= 0) return res.status(400).json({ error: 'Invalid bet' });
    if (!choice || !['heads', 'tails'].includes(choice)) return res.status(400).json({ error: 'Choice must be heads or tails' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['coinflip'];
    let outcome;
    if (override === 'win') outcome = choice;
    else if (override === 'lose') outcome = choice === 'heads' ? 'tails' : 'heads';
    else if (override === 'heads' || override === 'tails') outcome = override;
    else outcome = Math.random() < 0.5 ? 'heads' : 'tails';
    const win = outcome === choice;
    const multiplier = 1.98;
    const payout = win ? parseFloat((betAmount * multiplier).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'coinflip', parseFloat(betAmount), payout, user.balance, { outcome, choice, multiplier });
    res.json({ success: true, data: { outcome, win, payout, betAmount: parseFloat(betAmount), newBalance: user.balance, multiplier } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// DICE
router.post('/dice/play', async (req, res) => {
  try {
    const { betAmount, rollOver } = req.body;
    if (!betAmount || betAmount <= 0 || !rollOver || rollOver < 2 || rollOver > 98) return res.status(400).json({ error: 'Invalid bet or target' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['dice'];
    let roll;
    if (override === 'win') roll = rollOver + 1;
    else if (override === 'lose') roll = rollOver - 1;
    else roll = parseFloat((Math.random() * 100).toFixed(2));
    const win = roll > rollOver;
    const chance = (100 - rollOver) / 100;
    const multiplier = parseFloat((0.99 / chance).toFixed(4));
    const payout = win ? parseFloat((betAmount * multiplier).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'dice', parseFloat(betAmount), payout, user.balance, { roll, rollOver, multiplier });
    res.json({ success: true, data: { roll, win, payout, multiplier, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// HILO
router.post('/hilo/play', async (req, res) => {
  try {
    const { betAmount, choice, currentCardNumber } = req.body;
    if (!betAmount || betAmount <= 0 || !choice || !currentCardNumber) return res.status(400).json({ error: 'Invalid request' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['hilo'];
    let nextCard;
    if (override === 'win') nextCard = choice === 'higher' ? Math.min(currentCardNumber + 1, 13) : Math.max(currentCardNumber - 1, 1);
    else if (override === 'lose') nextCard = choice === 'higher' ? Math.max(currentCardNumber - 1, 1) : Math.min(currentCardNumber + 1, 13);
    else nextCard = Math.floor(Math.random() * 13) + 1;
    const win = choice === 'higher' ? nextCard > currentCardNumber : choice === 'lower' ? nextCard < currentCardNumber : false;
    const multiplier = 1.9;
    const payout = win ? parseFloat((betAmount * multiplier).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'hilo', parseFloat(betAmount), payout, user.balance, { currentCardNumber, nextCard, choice });
    res.json({ success: true, data: { nextCard, win, payout, multiplier, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// MINES
const activeMineGames = {};

router.post('/mines/start', async (req, res) => {
  try {
    const { betAmount, mineCount } = req.body;
    if (!betAmount || betAmount <= 0) return res.status(400).json({ error: 'Invalid bet' });
    const mines = mineCount || 3;
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const minePositions = [];
    const override = gameOverrides['mines'];
    while (minePositions.length < mines) {
      const pos = Math.floor(Math.random() * 25);
      if (!minePositions.includes(pos)) minePositions.push(pos);
    }
    if (override === 'lose') minePositions[0] = 0;
    activeMineGames[req.user.username] = { betAmount: parseFloat(betAmount), minePositions, revealed: [], mineCount: mines };
    await user.save();
    res.json({ success: true, data: { totalTiles: 25, mineCount: mines, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

router.post('/mines/click', async (req, res) => {
  try {
    const { tileIndex } = req.body;
    const game = activeMineGames[req.user.username];
    if (!game) return res.status(400).json({ success: false, message: 'No active game' });
    const isMine = game.minePositions.includes(tileIndex);
    if (isMine) {
      const user = await User.findOne({ username: req.user.username });
      await recordTx(req.user.username, 'mines', game.betAmount, 0, user.balance, { revealed: game.revealed, mineHit: tileIndex });
      delete activeMineGames[req.user.username];
      return res.json({ success: true, data: { isMine: true, minePositions: game.minePositions, win: false, payout: 0 } });
    }
    game.revealed.push(tileIndex);
    const multiplier = parseFloat((1 + game.revealed.length * 0.2).toFixed(2));
    res.json({ success: true, data: { isMine: false, revealed: game.revealed, multiplier, potentialPayout: parseFloat((game.betAmount * multiplier).toFixed(8)) } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

router.post('/mines/cashout', async (req, res) => {
  try {
    const game = activeMineGames[req.user.username];
    if (!game) return res.status(400).json({ success: false, message: 'No active game' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const multiplier = parseFloat((1 + game.revealed.length * 0.2).toFixed(2));
    const payout = parseFloat((game.betAmount * multiplier).toFixed(8));
    applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'mines', game.betAmount, payout, user.balance, { revealed: game.revealed, multiplier });
    delete activeMineGames[req.user.username];
    res.json({ success: true, data: { payout, multiplier, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

router.get('/mines/active', async (req, res) => {
  const game = activeMineGames[req.user.username];
  if (!game) return res.json({ success: true, data: null });
  res.json({ success: true, data: { betAmount: game.betAmount, revealed: game.revealed, mineCount: game.mineCount } });
});

// ROULETTE
router.post('/roulette/play', async (req, res) => {
  try {
    const { bets } = req.body;
    if (!bets || Object.keys(bets).length === 0) return res.status(400).json({ error: 'Invalid bets' });
    const totalBet = Object.values(bets).reduce((sum, val) => sum + val, 0);
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(totalBet));
    const redNumbers = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    const override = gameOverrides['roulette'];
    let result;
    if (override === 'win') result = bets['red'] ? 1 : bets['black'] ? 2 : bets['green'] ? 0 : parseInt(Object.keys(bets)[0]);
    else if (override === 'lose') result = bets['red'] ? 2 : bets['black'] ? 1 : 5;
    else result = Math.floor(Math.random() * 37);
    const color = result === 0 ? 'green' : redNumbers.includes(result) ? 'red' : 'black';
    let totalPayout = 0;
    for (const [betType, betAmt] of Object.entries(bets)) {
      let win = false, multiplier = 0;
      if (betType === 'red' || betType === 'black') { win = color === betType; multiplier = 2; }
      else if (betType === 'green') { win = color === 'green'; multiplier = 14; }
      else if (!isNaN(parseInt(betType))) { win = parseInt(betType) === result; multiplier = 36; }
      if (win) totalPayout += parseFloat((betAmt * multiplier).toFixed(8));
    }
    if (totalPayout > 0) applyWin(user, totalPayout);
    await user.save();
    await recordTx(req.user.username, 'roulette', parseFloat(totalBet), totalPayout, user.balance, { result, color, bets });
    res.json({ success: true, data: { result, color, win: totalPayout > 0, payout: totalPayout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// HISTORY
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const history = await Transaction.find({ username: req.user.username }).sort({ timestamp: -1 }).limit(limit);
    res.json({ success: true, data: history });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/:gameType/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const history = await Transaction.find({ username: req.user.username, type: req.params.gameType }).sort({ timestamp: -1 }).limit(limit);
    res.json({ success: true, data: history });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
