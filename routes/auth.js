const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { User } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ✅ Generate unique referral code
function generateReferralCode(username) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = username.toUpperCase().slice(0, 3);
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

router.post('/register', [
  body('username').trim().isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('email').optional().isEmail().withMessage('Invalid email address'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { username, password, email, referralCode } = req.body;

  try {
    const existingUsername = await User.findOne({ username });
    if (existingUsername) return res.status(409).json({ error: 'Username already taken' });

    if (email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) return res.status(409).json({ error: 'Email already registered' });
    }

    // ✅ Generate unique referral code for new user
    let newReferralCode = generateReferralCode(username);
    // Make sure it's unique
    let codeExists = await User.findOne({ referralCode: newReferralCode });
    while (codeExists) {
      newReferralCode = generateReferralCode(username);
      codeExists = await User.findOne({ referralCode: newReferralCode });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const startingBalance = parseFloat(process.env.STARTING_BALANCE) || 1000;

    // ✅ Check if referred by someone
    let referredByUsername = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
      if (referrer) {
        referredByUsername = referrer.username;
        // ✅ Give referrer bonus (5% of starting balance)
        const referralBonus = parseFloat((startingBalance * 0.05).toFixed(2));
        referrer.balance = parseFloat((referrer.balance + referralBonus).toFixed(2));
        referrer.referralCount = (referrer.referralCount || 0) + 1;
        referrer.referralEarnings = parseFloat(((referrer.referralEarnings || 0) + referralBonus).toFixed(2));
        await referrer.save();
      }
    }

    const user = new User({
      username,
      email,
      password: hashedPassword,
      balance: startingBalance,
      referralCode: newReferralCode,
      referredBy: referredByUsername
    });

    await user.save();

    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

    res.json({
      token,
      username,
      balance: user.balance,
      referralCode: newReferralCode
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { login, password } = req.body;
  try {
    const user = await User.findOne({
      $or: [{ username: login }, { email: login }]
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });
    const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ token, username: user.username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ username: user.username, email: user.email, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ Get referral info
router.get('/referral', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Generate code if user doesn't have one yet
    if (!user.referralCode) {
      let code = generateReferralCode(user.username);
      let exists = await User.findOne({ referralCode: code });
      while (exists) {
        code = generateReferralCode(user.username);
        exists = await User.findOne({ referralCode: code });
      }
      user.referralCode = code;
      await user.save();
    }

    const referralLink = `${process.env.FRONTEND_URL || 'https://foretell-bet.vercel.app'}/signup?ref=${user.referralCode}`;

    res.json({
      success: true,
      data: {
        referralCode: user.referralCode,
        referralLink,
        referralCount: user.referralCount || 0,
        referralEarnings: user.referralEarnings || 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
