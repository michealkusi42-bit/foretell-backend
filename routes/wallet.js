const express = require('express');
const { User, Transaction } = require('../config/store');

const router = express.Router();

// Get balance
router.get('/balance', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get transactions
router.get('/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find({ username: req.user.username }).sort({ timestamp: -1 }).limit(50);
    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Request withdrawal
router.post('/withdraw', async (req, res) => {
  try {
    const { amount, method, address } = req.body;
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.suspended) return res.status(403).json({ error: 'Account suspended' });

    const withdrawAmount = parseFloat(amount);
    if (!withdrawAmount || withdrawAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (withdrawAmount < 10) return res.status(400).json({ error: 'Minimum withdrawal is GHS 10' });
    if (user.balance < withdrawAmount) return res.status(400).json({ error: 'Insufficient balance' });

    user.balance = parseFloat((user.balance - withdrawAmount).toFixed(2));
    await user.save();

    const tx = new Transaction({
      id: Date.now().toString(),
      username: req.user.username,
      type: 'withdraw',
      amount: withdrawAmount,
      method: method || 'momo',
      address: address,
      status: 'pending',
      timestamp: new Date()
    });
    await tx.save();

    res.json({ success: true, message: 'Withdrawal request submitted.', newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Request deposit
router.post('/deposit', async (req, res) => {
  try {
    const { amount, method, reference } = req.body;
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const depositAmount = parseFloat(amount);
    if (!depositAmount || depositAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const tx = new Transaction({
      id: reference || Date.now().toString(),
      username: req.user.username,
      type: 'deposit',
      amount: depositAmount,
      method: method || 'momo',
      status: 'pending',
      timestamp: new Date()
    });
    await tx.save();

    res.json({ success: true, message: 'Deposit request submitted.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
