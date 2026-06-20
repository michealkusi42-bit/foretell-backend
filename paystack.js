const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { User, Transaction } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const PAYSTACK_BASE = 'https://api.paystack.co';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

const paystackClient = axios.create({
  baseURL: PAYSTACK_BASE,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    'Content-Type': 'application/json'
  }
});

// ─── 1. START A DEPOSIT ──────────────────────────────────────────────────────
// User enters an amount → we ask Paystack for a payment link → user pays there.
// No balance is touched here — only the webhook below credits balance,
// so a user can't fake a deposit by just hitting this endpoint.
router.post('/deposit/initialize', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Enter a valid amount' });
    }

    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Paystack expects amounts in the smallest currency unit (e.g. pesewas for GHS)
    const amountInSubunit = Math.round(parseFloat(amount) * 100);

    const reference = `dep_${user.username}_${Date.now()}`;

    const response = await paystackClient.post('/transaction/initialize', {
      email: user.email,
      amount: amountInSubunit,
      currency: 'GHS',
      reference,
      callback_url: `${process.env.FRONTEND_URL}/wallet/deposit`,
      metadata: { username: user.username, type: 'deposit' }
    });

    // Record as pending — webhook flips it to approved once Paystack confirms
    await Transaction.create({
      id: reference,
      username: user.username,
      type: 'deposit',
      amount: parseFloat(amount),
      status: 'pending',
      method: 'paystack',
      reference,
      timestamp: new Date()
    });

    res.json({
      success: true,
      paymentUrl: response.data.data.authorization_url,
      reference
    });
  } catch (err) {
    console.error('Paystack init error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not start payment' });
  }
});

// ─── 2. PAYSTACK WEBHOOK ─────────────────────────────────────────────────────
// Paystack calls THIS automatically once a payment succeeds — this is the
// only place that actually credits a user's balance for a deposit.
// Must use the raw body for signature verification, so this route needs to be
// registered BEFORE express.json() in server.js, or with express.raw() here.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET)
      .update(req.body)
      .digest('hex');

    if (hash !== signature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body.toString());

    if (event.event === 'charge.success') {
      const { reference, amount, metadata } = event.data;
      const username = metadata?.username;

      const tx = await Transaction.findOne({ id: reference, type: 'deposit' });
      if (!tx) return res.status(200).json({ received: true }); // unknown ref, ignore safely
      if (tx.status === 'approved') return res.status(200).json({ received: true }); // already processed

      const user = await User.findOne({ username: username || tx.username });
      if (!user) return res.status(200).json({ received: true });

      const amountInGHS = amount / 100;
      user.balance = parseFloat((user.balance + amountInGHS).toFixed(2));
      await user.save();

      tx.status = 'approved';
      tx.processedAt = new Date();
      await tx.save();

      console.log(`✅ Deposit confirmed via Paystack: ${user.username} +GHS ${amountInGHS}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Paystack webhook error:', err.message);
    res.status(200).json({ received: true }); // always 200 so Paystack doesn't retry endlessly
  }
});

// ─── 3. CHECK DEPOSIT STATUS (for the frontend to poll after redirect back) ──
router.get('/deposit/status/:reference', authenticateToken, async (req, res) => {
  try {
    const tx = await Transaction.findOne({ id: req.params.reference, type: 'deposit' });
    if (!tx) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, status: tx.status, amount: tx.amount });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── 4. PAYOUT A WITHDRAWAL (called by admin.js AFTER manual approval) ──────
// This is exported as a function, not a route — admin.js calls it directly
// from inside the approve-withdrawal endpoint, so Paystack only ever pays
// out after you've personally approved the request in the admin panel.
async function payoutWithdrawal({ username, amount, accountNumber, bankCode, accountName }) {
  // Step 1: create a "transfer recipient" — Paystack needs to know who to pay
  const recipientRes = await paystackClient.post('/transferrecipient', {
    type: 'mobile_money', // for Ghana MoMo payouts; use 'nuban' for bank accounts
    name: accountName || username,
    account_number: accountNumber,
    bank_code: bankCode, // e.g. MTN, Vodafone/Telecel, AirtelTigo code from Paystack's bank list
    currency: 'GHS'
  });

  const recipientCode = recipientRes.data.data.recipient_code;

  // Step 2: actually send the money
  const transferRes = await paystackClient.post('/transfer', {
    source: 'balance',
    amount: Math.round(amount * 100),
    recipient: recipientCode,
    reason: `Withdrawal payout for ${username}`
  });

  return transferRes.data.data;
}

module.exports = { router, payoutWithdrawal };
