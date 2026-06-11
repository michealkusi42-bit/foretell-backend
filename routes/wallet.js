const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { User, Transaction } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/wallet/balance
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ balance: user.balance, currency: 'CRYPT' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/wallet/deposit
router.post('/deposit', authenticateToken, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.balance = parseFloat((user.balance + parseFloat(amount)).toFixed(8));
    await user.save();

    const tx = new Transaction({ id: uuidv4(), username: user.username, type: 'deposit', amount, balanceAfter: user.balance, timestamp: new Date() });
    await tx.save();

    res.json({ balance: user.balance, transaction: tx });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/wallet/withdraw
router.post('/withdraw', authenticateToken, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

    user.balance = parseFloat((user.balance - parseFloat(amount)).toFixed(8));
    await user.save();

    const tx = new Transaction({ id: uuidv4(), username: user.username, type: 'withdraw', amount, balanceAfter: user.balance, timestamp: new Date() });
    await tx.save();

    res.json({ balance: user.balance, transaction: tx });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
