const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { User, VipSpinWin } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const REFERRALS_NEEDED = 10;   // total invites required
const QUALIFIED_NEEDED = 5;    // of those, how many must place a qualifying bet (>= GHS50)

// Weighted random prize pool for the wheel
const PRIZES = [
  { type: 'credit', label: 'GHS 5 Bonus', value: 5, weight: 30 },
  { type: 'credit', label: 'GHS 10 Bonus', value: 10, weight: 20 },
  { type: 'credit', label: 'GHS 20 Bonus', value: 20, weight: 10 },
  { type: 'free_spins', label: '5 Free Spins', value: 5, weight: 20 },
  { type: 'free_spins', label: '10 Free Spins', value: 10, weight: 10 },
  { type: 'merch', label: 'Foretell T-Shirt', value: 1, weight: 8 },
  { type: 'credit', label: 'GHS 50 Jackpot', value: 50, weight: 2 },
];

function computeSpinsAvailable(user) {
  const earned = Math.floor(Math.min(
    (user.referralCount || 0) / REFERRALS_NEEDED,
    (user.qualifiedReferralCount || 0) / QUALIFIED_NEEDED
  ));
  return Math.max(0, earned - (user.vipSpinsUsed || 0));
}

// GET /api/vip-spin/status — how close is this user to a spin
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      referralCount: user.referralCount || 0,
      qualifiedReferralCount: user.qualifiedReferralCount || 0,
      referralsNeeded: REFERRALS_NEEDED,
      qualifiedNeeded: QUALIFIED_NEEDED,
      spinsAvailable: computeSpinsAvailable(user)
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/vip-spin/spin — actually spin the wheel
router.post('/spin', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const spinsAvailable = computeSpinsAvailable(user);
    if (spinsAvailable <= 0) {
      return res.status(400).json({ error: 'No spins available yet. Keep inviting friends!' });
    }

    const totalWeight = PRIZES.reduce((sum, p) => sum + p.weight, 0);
    let rand = Math.random() * totalWeight;
    let prize = PRIZES[0];
    for (const p of PRIZES) {
      rand -= p.weight;
      if (rand <= 0) { prize = p; break; }
    }

    if (prize.type === 'credit') {
      user.balance = parseFloat(((user.balance || 0) + prize.value).toFixed(8));
    } else if (prize.type === 'free_spins') {
      user.freeSpinsBalance = (user.freeSpinsBalance || 0) + prize.value;
    }
    // merch: no balance change, just logged below for admin fulfillment

    user.vipSpinsUsed = (user.vipSpinsUsed || 0) + 1;
    await user.save();

    const win = new VipSpinWin({
      id: uuidv4(),
      username: user.username,
      prizeType: prize.type,
      prizeLabel: prize.label,
      prizeValue: prize.value,
      timestamp: new Date()
    });
    await win.save();

    res.json({
      prize: { type: prize.type, label: prize.label, value: prize.value },
      balance: user.balance,
      freeSpinsBalance: user.freeSpinsBalance || 0,
      spinsAvailable: computeSpinsAvailable(user)
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/vip-spin/winners — public recent-winners feed (fixes the 404 you saw)
router.get('/winners', async (req, res) => {
  try {
    const winners = await VipSpinWin.find().sort({ timestamp: -1 }).limit(20);
    res.json({ winners });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
