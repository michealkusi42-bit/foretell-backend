const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { User } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const affiliates = new Map();
const usedCodes = new Map();
const claimedBonuses = new Map();

const BONUSES = {
  welcome: { amount: 10, description: 'Welcome bonus for new players' },
  daily: { amount: 5, description: 'Daily login bonus' },
};

router.post('/create', authenticateToken, async (req, res) => {
  const existing = [...affiliates.values()].find(a => a.ownerUsername === req.user.username);
  if (existing) return res.json({ code: existing.code, earnings: existing.earnings, referrals: existing.referrals.length });

  const code = req.user.username.toUpperCase().slice(0, 5) + '-' + uuidv4().slice(0, 6).toUpperCase();
  affiliates.set(code, { ownerUsername: req.user.username, code, earnings: 0, referrals: [] });
  res.status(201).json({ code, earnings: 0, referrals: 0 });
});

router.get('/mine', authenticateToken, (req, res) => {
  const aff = [...affiliates.values()].find(a => a.ownerUsername === req.user.username);
  if (!aff) return res.status(404).json({ error: 'No affiliate code yet.' });
  res.json({ code: aff.code, earnings: aff.earnings, referrals: aff.referrals.length });
});

router.post('/use', authenticateToken, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  if (usedCodes.has(req.user.username)) return res.status(409).json({ error: 'You already used a referral code' });

  const aff = affiliates.get(code.toUpperCase());
  if (!aff) return res.status(404).json({ error: 'Invalid referral code' });
  if (aff.ownerUsername === req.user.username) return res.status(400).json({ error: 'Cannot use your own code' });

  try {
    const referrer = await User.findOne({ username: aff.ownerUsername });
    if (referrer) {
      referrer.balance = (referrer.balance || 0) + 5;
      await referrer.save();
    }
    aff.earnings += 5;
    aff.referrals.push(req.user.username);
    usedCodes.set(req.user.username, code);
    res.json({ message: 'Referral code applied successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to apply referral code' });
  }
});

router.get('/bonuses', authenticateToken, (req, res) => {
  res.json(BONUSES);
});

router.post('/claim', authenticateToken, async (req, res) => {
  const { type } = req.body;
  if (!BONUSES[type]) return res.status(400).json({ error: 'Invalid bonus type' });

  const key = req.user.username + ':' + type;
  if (claimedBonuses.has(key)) return res.status(409).json({ error: 'Bonus already claimed' });

  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.balance = (user.balance || 0) + BONUSES[type].amount;
    await user.save();
    claimedBonuses.set(key, true);
    res.json({ message: 'Bonus claimed', amount: BONUSES[type].amount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to claim bonus' });
  }
});

module.exports = router;
