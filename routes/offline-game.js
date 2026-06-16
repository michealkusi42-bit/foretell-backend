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
    if (Array.isArray(override)) {
      minePositions.push(...override);
    } else {
      while (minePositions.length < mines) {
        const pos = Math.floor(Math.random() * 25);
        if (!minePositions.includes(pos)) minePositions.push(pos);
      }
      if (override === 'lose') minePositions[0] = 0;
    }
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
    else if (override !== null && override !== undefined) result = parseInt(override);
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

// UPDOWN
router.post('/updown/play', async (req, res) => {
  try {
    const { betAmount, prediction } = req.body;
    if (!betAmount || betAmount <= 0 || !['up', 'down'].includes(prediction))
      return res.status(400).json({ error: 'Invalid bet or prediction' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['updown'];
    let outcome;
    if (override === 'win') outcome = prediction;
    else if (override === 'lose') outcome = prediction === 'up' ? 'down' : 'up';
    else if (override === 'up' || override === 'down') outcome = override;
    else outcome = Math.random() < 0.5 ? 'up' : 'down';
    const win = outcome === prediction;
    const payout = win ? parseFloat((betAmount * 1.9).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'updown', parseFloat(betAmount), payout, user.balance, { outcome, prediction });
    res.json({ success: true, data: { outcome, win, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// CRASH
router.post('/crash/play', async (req, res) => {
  try {
    const { betAmount, autoCashout } = req.body;
    if (!betAmount || betAmount <= 0) return res.status(400).json({ error: 'Invalid bet' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['crash'];
    const crashAt = override !== null && override !== undefined
      ? parseFloat(override)
      : parseFloat(Math.max(1, (0.99 / Math.random())).toFixed(2));
    const cashedOutAt = autoCashout && autoCashout <= crashAt ? parseFloat(autoCashout) : null;
    const win = cashedOutAt !== null;
    const payout = win ? parseFloat((betAmount * cashedOutAt).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'crash', parseFloat(betAmount), payout, user.balance, { crashAt, cashedOutAt });
    res.json({ success: true, data: { crashAt, cashedOutAt, win, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// LOTTERY
router.post('/lottery/play', async (req, res) => {
  try {
    const { betAmount, numbers } = req.body;
    if (!betAmount || betAmount <= 0 || !Array.isArray(numbers) || numbers.length !== 5)
      return res.status(400).json({ error: 'Pick exactly 5 numbers' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['lottery'];
    let winningNumbers;
    if (Array.isArray(override)) {
      winningNumbers = override;
    } else {
      winningNumbers = [];
      while (winningNumbers.length < 5) {
        const n = Math.floor(Math.random() * 50) + 1;
        if (!winningNumbers.includes(n)) winningNumbers.push(n);
      }
    }
    const matches = numbers.filter(n => winningNumbers.includes(n)).length;
    const multipliers = { 0: 0, 1: 0, 2: 0, 3: 2, 4: 10, 5: 100 };
    const payout = parseFloat((betAmount * multipliers[matches]).toFixed(8));
    if (payout > 0) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'lottery', parseFloat(betAmount), payout, user.balance, { winningNumbers, matches });
    res.json({ success: true, data: { winningNumbers, matches, win: payout > 0, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// RACING
router.post('/racing/play', async (req, res) => {
  try {
    const { betAmount, horse } = req.body;
    if (!betAmount || betAmount <= 0 || !horse || horse < 1 || horse > 8)
      return res.status(400).json({ error: 'Pick a horse 1-8' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['racing'];
    let winner;
    if (override === 'win') winner = parseInt(horse);
    else if (override === 'lose') winner = parseInt(horse) === 1 ? 2 : 1;
    else if (override !== null && override !== undefined) winner = parseInt(override);
    else winner = Math.floor(Math.random() * 8) + 1;
    const win = parseInt(horse) === winner;
    const payout = win ? parseFloat((betAmount * 7.5).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'racing', parseFloat(betAmount), payout, user.balance, { winner, horse });
    res.json({ success: true, data: { winner, win, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// BINGO
router.post('/bingo/play', async (req, res) => {
  try {
    const { betAmount, card } = req.body;
    if (!betAmount || betAmount <= 0 || !Array.isArray(card))
      return res.status(400).json({ error: 'Invalid bet or card' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['bingo'];
    let drawnNumbers;
    if (Array.isArray(override)) {
      drawnNumbers = override;
    } else {
      drawnNumbers = [];
      while (drawnNumbers.length < 15) {
        const n = Math.floor(Math.random() * 75) + 1;
        if (!drawnNumbers.includes(n)) drawnNumbers.push(n);
      }
    }
    const matches = card.filter(n => drawnNumbers.includes(n)).length;
    const win = matches >= 5;
    const payout = win ? parseFloat((betAmount * 3).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'bingo', parseFloat(betAmount), payout, user.balance, { drawnNumbers, matches });
    res.json({ success: true, data: { drawnNumbers, matches, win, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// ─── POKER (Video Poker - Jacks or Better) ───────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

function createDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function evaluateHand(cards) {
  const ranks = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => a - b);
  const suits = cards.map(c => c.suit);
  const rankCounts = {};
  for (const r of ranks) rankCounts[r] = (rankCounts[r] || 0) + 1;
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = ranks[4] - ranks[0] === 4 && counts[0] === 1;
  const isRoyalStraight = isStraight && ranks[0] === 10;

  if (isFlush && isRoyalStraight) return { name: 'Royal Flush', multiplier: 800 };
  if (isFlush && isStraight) return { name: 'Straight Flush', multiplier: 50 };
  if (counts[0] === 4) return { name: 'Four of a Kind', multiplier: 25 };
  if (counts[0] === 3 && counts[1] === 2) return { name: 'Full House', multiplier: 9 };
  if (isFlush) return { name: 'Flush', multiplier: 6 };
  if (isStraight) return { name: 'Straight', multiplier: 4 };
  if (counts[0] === 3) return { name: 'Three of a Kind', multiplier: 3 };
  if (counts[0] === 2 && counts[1] === 2) return { name: 'Two Pair', multiplier: 2 };
  if (counts[0] === 2) {
    const pairRank = parseInt(Object.keys(rankCounts).find(r => rankCounts[r] === 2));
    if (pairRank >= 11) return { name: 'Jacks or Better', multiplier: 1 };
  }
  return { name: 'No Win', multiplier: 0 };
}

const activePokerGames = {};

router.post('/poker/deal', async (req, res) => {
  try {
    const { betAmount } = req.body;
    if (!betAmount || betAmount <= 0) return res.status(400).json({ error: 'Invalid bet' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    await user.save();
    const deck = shuffle(createDeck());
    const hand = deck.splice(0, 5);
    const remaining = deck;
    activePokerGames[req.user.username] = { betAmount: parseFloat(betAmount), hand, deck: remaining };
    res.json({ success: true, data: { hand, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

router.post('/poker/draw', async (req, res) => {
  try {
    const { holdIndexes } = req.body;
    const game = activePokerGames[req.user.username];
    if (!game) return res.status(400).json({ success: false, message: 'No active poker game' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const newHand = game.hand.map((card, i) => {
      if (holdIndexes.includes(i)) return card;
      return game.deck.shift();
    });
    const result = evaluateHand(newHand);
    const payout = parseFloat((game.betAmount * result.multiplier).toFixed(8));
    if (payout > 0) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'poker', game.betAmount, payout, user.balance, {
      finalHand: newHand,
      handName: result.name,
      multiplier: result.multiplier
    });
    delete activePokerGames[req.user.username];
    res.json({
      success: true,
      data: { hand: newHand, result: result.name, multiplier: result.multiplier, payout, win: payout > 0, newBalance: user.balance }
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

router.get('/poker/active', async (req, res) => {
  const game = activePokerGames[req.user.username];
  if (!game) return res.json({ success: true, data: null });
  res.json({ success: true, data: { betAmount: game.betAmount, hand: game.hand } });
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
@michealkusi42-bit
Comment

Leave a comment
