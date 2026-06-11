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

  const code = ${req.user.username.toUpperCase().slice(0, 5)}-${uuidv4().slice(0, 6).toUpperCase()};
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
    const refer
