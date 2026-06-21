const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { User, Transaction } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const PAYSTACK_BASE = 'https://api.paystack.co';

// POST /api/paystack/initialize — start a deposit. Returns a URL to redirect the user to.
router.post('/initialize', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.email) return res.status(400).json({ error: 'Account needs an email on file to deposit' });

    const reference = 'PSK-' + uuidv4();

    const psRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(parseFloat(amount) * 100), // pesewas
        currency: 'GHS',
        reference,
        callback_url: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/wallet` : undefined,
        metadata: { username: user.username }
      })
    });

    const psData = await psRes.json();
    if (!psData.status) {
      return res.status(400).json({ error: psData.message || 'Failed to start payment' });
    }

    const tx = new Transaction({
      id: uuidv4(),
      username: user.username,
      type: 'deposit',
      amount: parseFloat(amount),
      balanceAfter: user.balance,
      status: 'pending',
      reference,
      method: 'paystack',
      timestamp: new Date()
    });
    await tx.save();

    res.json({ authorizationUrl: psData.data.authorization_url, reference });
  } catch (err) {
    console.error('Paystack initialize error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/paystack/webhook
// server.js applies express.raw({ type: 'application/json' }) to this exact
// path BEFORE express.json() runs — so req.body here arrives as a raw Buffer,
// not a parsed object. We verify the signature against that raw buffer first,
// then parse it ourselves.
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const expected = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(req.body)
      .digest('hex');

    if (!signature || signature !== expected) {
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));

    if (event.event === 'charge.success') {
      const { reference } = event.data;
      const tx = await Transaction.findOne({ reference, type: 'deposit' });

      if (tx && tx.status === 'pending') {
        const user = await User.findOne({ username: tx.username });
        if (user) {
          user.balance = parseFloat((user.balance + tx.amount).toFixed(2));
          await user.save();

          tx.status = 'success';
          tx.balanceAfter = user.balance;
          await tx.save();
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Paystack webhook error:', err);
    res.sendStatus(500);
  }
});

// GET /api/paystack/verify/:reference — lets the frontend check status right after
// the user is redirected back, without waiting on the webhook to arrive.
router.get('/verify/:reference', authenticateToken, async (req, res) => {
  try {
    const tx = await Transaction.findOne({ reference: req.params.reference, username: req.user.username });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ status: tx.status, amount: tx.amount });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router };
