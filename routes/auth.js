const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { User } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');
const { Resend } = require('resend');

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateReferralCode(username) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = username.toUpperCase().slice(0, 3);
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ✅ SEND OTP
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const otp = generateOTP();
    const expiry = Date.now() + 10 * 60 * 1000;
    otpStore.set(email, { otp, expiry });
    await resend.emails.send({
      from: 'Foretell <onboarding@resend.dev>',
      to: email,
      subject: 'Your Foretell Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #0f212e; color: #fff; padding: 30px; border-radius: 12px;">
          <h1 style="color: #00e701;">$ FORETELL</h1>
          <h2>Email Verification</h2>
          <p style="color: #94a3b8;">Your verification code expires in 10 minutes.</p>
          <div style="background: #213743; border: 2px solid #00BAE6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #00BAE6; font-size: 42px; letter-spacing: 8px; margin: 0;">${otp}</h1>
          </div>
          <p style="color: #64748b; font-size: 12px;">If you didn't request this, ignore this email.</p>
        </div>
      `
    });
    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// ✅ VERIFY OTP
router.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
  const stored = otpStore.get(email);
  if (!stored) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
  if (Date.now() > stored.expiry) {
    otpStore.delete(email);
    return res.status(400).json({ error: 'OTP has expired.' });
  }
  if (stored.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
  otpStore.set(email, { ...stored, verified: true });
  res.json({ success: true, message: 'Email verified successfully' });
});

// ✅ REGISTER
router.post('/register', [
  body('username').trim().isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('email').isEmail().withMessage('Invalid email address'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { username, password, email, referralCode } = req.body;
  try {
    const existingUsername = await User.findOne({ username });
    if (existingUsername) return res.status(409).json({ error: 'Username already taken' });
    const existingEmail = await User.findOne({ email });
    if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

    let newReferralCode = generateReferralCode(username);
    let codeExists = await User.findOne({ referralCode: newReferralCode });
    while (codeExists) {
      newReferralCode = generateReferralCode(username);
      codeExists = await User.findOne({ referralCode: newReferralCode });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const startingBalance = parseFloat(process.env.STARTING_BALANCE) || 1000;

    let referredByUsername = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
      if (referrer) {
        referredByUsername = referrer.username;
        const referralBonus = parseFloat((startingBalance * 0.05).toFixed(2));
        referrer.balance = parseFloat((referrer.balance + referralBonus).toFixed(2));
        referrer.referralCount = (referrer.referralCount || 0) + 1;
        referrer.referralEarnings = parseFloat(((referrer.referralEarnings || 0) + referralBonus).toFixed(2));
        await referrer.save();
      }
    }

    const user = new User({
      username, email, password: hashedPassword,
      balance: startingBalance,
      referralCode: newReferralCode,
      referredBy: referredByUsername
    });
    await user.save();
    otpStore.delete(email);

    await resend.emails.send({
      from: 'Foretell <onboarding@resend.dev>',
      to: email,
      subject: 'Welcome to Foretell! 🎉',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #0f212e; color: #fff; padding: 30px; border-radius: 12px;">
          <h1 style="color: #00e701;">$ FORETELL</h1>
          <h2>Welcome, ${username}! 🎉</h2>
          <p style="color: #94a3b8;">Your account has been created successfully.</p>
          <div style="background: #213743; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0; color: #00e701; font-size: 18px; font-weight: bold;">Starting Balance: GHS ${startingBalance}</p>
          </div>
          <p style="color: #94a3b8;">Referral code: <strong style="color: #00BAE6;">${newReferralCode}</strong></p>
        </div>
      `
    }).catch(() => {});

    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ token, username, balance: user.balance, referralCode: newReferralCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ LOGIN
router.post('/login', async (req, res) => {
  const { login, password } = req.body;
  try {
    const user = await User.findOne({ $or: [{ username: login }, { email: login }] });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.suspended) return res.status(403).json({ error: 'Account suspended' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });
    const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ token, username: user.username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ GET ME
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      username: user.username,
      email: user.email,
      balance: user.balance,
      momoNumber: user.momoNumber || '',
      momoProvider: user.momoProvider || 'mtn',
      cryptoAddress: user.cryptoAddress || '',
      cryptoNetwork: user.cryptoNetwork || '',
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ GET saved payment details
router.get('/payment-details', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      momoNumber: user.momoNumber || '',
      momoProvider: user.momoProvider || 'mtn',
      cryptoAddress: user.cryptoAddress || '',
      cryptoNetwork: user.cryptoNetwork || '',
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ SAVE payment details
router.post('/payment-details', authenticateToken, async (req, res) => {
  try {
    const { momoNumber, momoProvider, cryptoAddress, cryptoNetwork } = req.body;
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (momoNumber !== undefined) user.momoNumber = momoNumber;
    if (momoProvider !== undefined) user.momoProvider = momoProvider;
    if (cryptoAddress !== undefined) user.cryptoAddress = cryptoAddress;
    if (cryptoNetwork !== undefined) user.cryptoNetwork = cryptoNetwork;
    await user.save();
    res.json({ success: true, message: 'Payment details saved!' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ REFERRAL
router.get('/referral', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
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
    const referralLink = `${process.env.FRONTEND_URL || 'https://fortellbet.com'}/signup?ref=${user.referralCode}`;
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
