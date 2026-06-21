const express = require('express');
const https = require('https');
const { User, Transaction } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// Helper to call Paystack API
function paystackRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// ─── DEPOSIT: Initialize MoMo payment ────────────────────────────────────────
router.post('/deposit/initialize', authenticateToken, async (req, res) => {
  try {
    const { amount, phone, provider } = req.body;
    // provider: mtn, vodafone, tigo

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    if (!provider) return res.status(400).json({ error: 'Provider required (mtn/vodafone/tigo)' });

    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Create transaction record
    const txRef = uuidv4();
    const tx = new Transaction({
      id: txRef,
      username: user.username,
      type: 'deposit',
      amount: parseFloat(amount),
      balanceAfter: user.balance,
      status: 'pending',
      reference: txRef,
      method: 'momo',
      provider,
      phone,
      timestamp: new Date()
    });
    await tx.save();

    // Initialize Paystack charge
    const response = await paystackRequest('POST', '/charge', {
      email: user.email || `${user.username}@foretellbet.com`,
      amount: Math.round(parseFloat(amount) * 100), // Paystack uses pesewas
      currency: 'GHS',
      mobile_money: {
        phone,
        provider
      },
      reference: txRef,
      metadata: {
        username: user.username,
        custom_fields: [
          { display_name: 'Username', variable_name: 'username', value: user.username }
        ]
      }
    });

    if (response.status) {
      res.json({
        success: true,
        reference: txRef,
        status: response.data?.status,
        displayText: response.data?.display_text || 'Check your phone to approve payment'
      });
    } else {
      tx.status = 'rejected';
      await tx.save();
      res.status(400).json({ error: response.message || 'Failed to initialize payment' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DEPOSIT: Verify payment status ──────────────────────────────────────────
router.get('/deposit/verify/:reference', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.params;

    const response = await paystackRequest('GET', `/transaction/verify/${reference}`);

    if (response.status && response.data?.status === 'success') {
      // Credit user balance
      const tx = await Transaction.findOne({ id: reference });
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });

      if (tx.status === 'success') {
        return res.json({ success: true, status: 'success', message: 'Already credited' });
      }

      const user = await User.findOne({ username: tx.username });
      if (!user) return res.status(404).json({ error: 'User not found' });

      user.balance = parseFloat((user.balance + tx.amount).toFixed(2));
      tx.status = 'success';
      tx.balanceAfter = user.balance;
      await user.save();
      await tx.save();

      res.json({
        success: true,
        status: 'success',
        message: `GHS ${tx.amount} credited to your account!`,
        newBalance: user.balance
      });
    } else {
      res.json({
        success: true,
        status: response.data?.status || 'pending',
        message: 'Payment pending — check your phone'
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── WEBHOOK: Paystack sends payment confirmation ────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const crypto = require('crypto');
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET)
      .update(JSON.parse(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(req.body);

    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const tx = await Transaction.findOne({ id: reference, type: 'deposit' });

      if (tx && tx.status === 'pending') {
        const user = await User.findOne({ username: tx.username });
        if (user) {
          user.balance = parseFloat((user.balance + tx.amount).toFixed(2));
          tx.status = 'success';
          tx.balanceAfter = user.balance;
          await user.save();
          await tx.save();
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ─── WITHDRAWAL: Admin approves → Paystack pays user ─────────────────────────
router.post('/withdrawal/approve/:txId', async (req, res) => {
  try {
    const adminPassword = req.headers['x-admin-password'];
    if (adminPassword !== process.env.ADMIN_PANEL_PASSWORD) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const tx = await Transaction.findOne({ id: req.params.txId, type: 'withdraw' });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    // Create Paystack transfer recipient
    const recipientRes = await paystackRequest('POST', '/transferrecipient', {
      type: 'mobile_money',
      name: tx.username,
      account_number: tx.address,
      bank_code: tx.provider === 'mtn' ? 'MTN' : tx.provider === 'vodafone' ? 'VOD' : 'TGO',
      currency: 'GHS'
    });

    if (!recipientRes.status) {
      return res.status(400).json({ error: 'Failed to create recipient: ' + recipientRes.message });
    }

    const recipientCode = recipientRes.data.recipient_code;

    // Send transfer
    const transferRes = await paystackRequest('POST', '/transfer', {
      source: 'balance',
      amount: Math.round(tx.amount * 100),
      recipient: recipientCode,
      reason: `Foretell withdrawal for ${tx.username}`,
      currency: 'GHS'
    });

    if (transferRes.status) {
      tx.status = 'success';
      tx.processedAt = new Date();
      tx.paystackTransferCode = transferRes.data?.transfer_code;
      await tx.save();

      res.json({
        success: true,
        message: `GHS ${tx.amount} sent to ${tx.address}`,
        transferCode: transferRes.data?.transfer_code
      });
    } else {
      res.status(400).json({ error: transferRes.message || 'Transfer failed' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
