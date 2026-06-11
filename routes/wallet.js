const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { users, transactions } = require('../config/store');

const router = express.Router();

// GET /api/wallet/balance
router.get('/balance', (req, res) => {
  const user = users.get(req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ balance: user.balance, currency: 'CRYPT' });
});

// POST /api/wallet/deposit  (mock — replace with real crypto gateway)
router.post('/deposit', (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const user = users.get(req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.balance = parseFloat((user.balance + parseFloat(amount)).toFixed(8));

  const tx = { id: uuidv4(), type: 'deposit', amount, balanceAfter: user.balance, timestamp: new Date() };
  const userTx = transactions.get(req.user.username) || [];
  userTx.push(tx);
  transactions.set(req.user.username, userTx);

  res.json({ message: 'Deposit successful', balance: user.balance, transaction: tx });
});

// POST /api/wallet/withdraw
router.post('/withdraw', (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const user = users.get(req.user.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  user.balance = parseFloat((user.balance - parseFloat(amount)).toFixed(8));

  const tx = { id: uuidv4(), type: 'withdrawal', amount, balanceAfter: user.balance, timestamp: new Date() };
  const userTx = transactions.get(req.user.username) || [];
  userTx.push(tx);
  transactions.set(req.user.username, userTx);

  res.json({ message: 'Withdrawal successful', balance: user.balance, transaction: tx });
});

// GET /api/wallet/transactions
router.get('/transactions', (req, res) => {
  const userTx = transactions.get(req.user.username) || [];
  res.json({ transactions: userTx.slice(-50).reverse() }); // last 50
});

module.exports = router;
