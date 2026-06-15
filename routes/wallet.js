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

// POST /api/wallet/deposit (create deposit)
router.post('/deposit', authenticateToken, async (req, res) => {
  const { amount, status, rowsPerPage, currentPage, date } = req.body;

  // If it's a list request (from deposit history page)
  if (!amount) {
    try {
      const query = { username: req.user.username, type: 'deposit' };
      if (status && status !== 'all') query.status = status;
      if (date) {
        query.timestamp = { $gte: new Date(date.start), $lte: new Date(date.end) };
      }
      const limit = rowsPerPage || 50;
      const skip = ((currentPage || 1) - 1) * limit;
      const total = await Transaction.countDocuments(query);
      const data = await Transaction.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit);
      return res.json({ total, data });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // Otherwise it's an actual deposit
  if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
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

// POST /api/wallet/withdraw (create or list withdrawals)
router.post('/withdraw', authenticateToken, async (req, res) => {
  const { amount, status, rowsPerPage, currentPage, date } = req.body;

  // If it's a list request
  if (!amount) {
    try {
      const query = { username: req.user.username, type: 'withdraw' };
      if (status && status !== 'all') query.status = status;
      if (date) {
        query.timestamp = { $gte: new Date(date.start), $lte: new Date(date.end) };
      }
      const limit = rowsPerPage || 50;
      const skip = ((currentPage || 1) - 1) * limit;
      const total = await Transaction.countDocuments(query);
      const data = await Transaction.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit);
      return res.json({ total, data });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // Otherwise actual withdrawal
  if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
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
