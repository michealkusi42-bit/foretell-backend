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
    res.json({ balance: user.balance, currency: 'GHS' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/wallet/deposit
router.post('/deposit', authenticateToken, async (req, res) => {
  const { amount, reference, method, status, rowsPerPage, currentPage, date } = req.body;

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

  if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tx = new Transaction({
      id: uuidv4(),
      username: user.username,
      type: 'deposit',
      amount: parseFloat(amount),
      balanceAfter: user.balance,
      status: 'pending',
      reference: reference || '',
      method: method || 'momo',
      timestamp: new Date()
    });
    await tx.save();

    res.json({ success: true, message: 'Deposit request submitted', transaction: tx });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/wallet/withdraw
router.post('/withdraw', authenticateToken, async (req, res) => {
  const { amount, address, method, status, rowsPerPage, currentPage, date } = req.body;

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

  if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.balance < parseFloat(amount)) return res.status(400).json({ error: 'Insufficient balance' });

    user.balance = parseFloat((user.balance - parseFloat(amount)).toFixed(8));
    await user.save();

    const tx = new Transaction({
      id: uuidv4(),
      username: user.username,
      type: 'withdraw',
      amount: parseFloat(amount),
      balanceAfter: user.balance,
      status: 'pending',
      address: address || '',
      method: method || 'momo',
      timestamp: new Date()
    });
    await tx.save();

    res.json({ success: true, message: 'Withdrawal request submitted', balance: user.balance, transaction: tx });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/wallet/transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const transactions = await Transaction.find({ username: req.user.username })
      .sort({ timestamp: -1 })
      .limit(50);
    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/wallet/transaction/:id
router.get('/transaction/:id', authenticateToken, async (req, res) => {
  try {
    const tx = await Transaction.findOne({ id: req.params.id, username: req.user.username });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ success: true, data: tx });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/wallet/admin/transaction/:id
router.patch('/admin/transaction/:id', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'under_review', 'success', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const tx = await Transaction.findOne({ id: req.params.id });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const prevStatus = tx.status;
    tx.status = status;
    tx.updatedAt = new Date();
    await tx.save();

    if (tx.type === 'deposit' && status === 'success' && prevStatus !== 'success') {
      const user = await User.findOne({ username: tx.username });
      if (user) {
        user.balance = parseFloat((user.balance + tx.amount).toFixed(8));
        tx.balanceAfter = user.balance;
        await user.save();
        await tx.save();
      }
    }

    if (tx.type === 'withdraw' && status === 'rejected' && prevStatus !== 'rejected') {
      const user = await User.findOne({ username: tx.username });
      if (user) {
        user.balance = parseFloat((user.balance + tx.amount).toFixed(8));
        await user.save();
      }
    }

    res.json({ success: true, transaction: tx });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/wallet/admin/transactions
router.get('/admin/transactions', authenticateToken, async (req, res) => {
  try {
    const { status, type } = req.query;
    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;
    const transactions = await Transaction.find(query).sort({ timestamp: -1 }).limit(100);
    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
