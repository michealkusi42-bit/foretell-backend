const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { users } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// In-memory affiliate store
const affiliates = new Map(); // code -> { ownerId, code, earnings, referrals[] }
const usedCodes = new Map();  // userId -> code (so each user can only use one code)
const claimedBonuses = new Set(); // userId:bonusType

const BONUSES = {
  welcome: { amount: 10, description: 'Welcome bonus for new players' },
  daily: { amount: 5, description: 'Daily login bonus' },
};

// ── POST /api/affiliates/create — generate a referral code
router.post('/create', authenticateToken, (req, res) => {
  const existing = [...affiliates.values()].find(a => a.ownerId === req.user.id);
  if (existing) return res.json({ code: existing.code, earnings: existing.earnings, referrals: existing.referrals.length });

  const code = `${req.user.username.toUpperCase().slice(0, 5)}-${uuidv4().slice(0, 6).toUpperCase()}`;
  affiliates.set(code, { ownerId: req.user.id, ownerUsername: req.user.username, code, earnings: 0, referrals: [] });
  res.status(201).json({ code, earnings: 0, referrals: 0 });
});

// ── GET /api/affiliates/mine — check your referral stats
router.get('/mine', authenticateToken, (req, res) => {
  const aff = [...affiliates.values()].find(a => a.ownerId === req.user.id);
  if (!aff) return res.status(404).json({ error: 'No affiliate code yet. POST /affiliates/create first.' });
  res.json({ code: aff.code, earnings: aff.earnings, referrals: aff.referrals.length });
});

// ── POST /api/affiliates/use — apply someone's referral code on signup
router.post('/use', authenticateToken, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  if (usedCodes.has(req.user.id)) return res.status(409).json({ error: 'You already used a referral code' });

  const aff = affiliates.get(code.toUpperCase());
  if (!aff) return res.status(404).json({ error: 'Invalid referral code' });
  if (aff.ownerId === req.user.id) return res.status(400).json({ error: 'Cannot use your own code' });

  // Reward referrer
  const referrer = [...users.values()].find(u => u.id === aff.ownerId);
  if (referrer) {
    referrer.balance = parseFloat((referrer.balance + 10).toFixed(8));
    aff.earnings += 10;
  }

  // Reward new player
  const user = users.get(req.user.username);
  user.balance = parseFloat((user.balance + 5).toFixed(8));
  aff.referrals.push({ userId: req.user.id, username: req.user.username, joinedAt: new Date() });
  usedCodes.set(req.user.id, code);

  res.json({ message: 'Referral applied! You received +5 CRYPT bonus.', balance: user.balance });
});

// ── POST /api/affiliates/bonus/claim — claim welcome or daily bonus
router.post('/bonus/claim', authenticateToken, (req, res) => {
  const { type } = req.body;
  const bonus = BONUSES[type];
  if (!bonus) return res.status(400).json({ error: `Invalid bonus type. Available: ${Object.keys(BONUSES).join(', ')}` });

  const key = `${req.user.id}:${type}`;
  if (type === 'daily') {
    // Allow once per day
    const lastClaimKey = `${key}:lastClaim`;
    const lastClaim = claimedBonuses.get ? null : null; // simplified: just check the set
    if (claimedBonuses.has(key)) {
      return res.status(409).json({ error: 'Daily bonus already claimed today. Come back tomorrow!' });
    }
    claimedBonuses.add(key);
    // Reset daily after 24 hours
    setTimeout(() => claimedBonuses.delete(key), 24 * 60 * 60 * 1000);
  } else {
    if (claimedBonuses.has(key)) return res.status(409).json({ error: `${type} bonus already claimed` });
    claimedBonuses.add(key);
  }

  const user = users.get(req.user.username);
  user.balance = parseFloat((user.balance + bonus.amount).toFixed(8));
  res.json({ message: `${bonus.description} claimed! +${bonus.amount} CRYPT`, balance: user.balance });
});

module.exports = router;
