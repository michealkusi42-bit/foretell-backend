const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { User, Transaction } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const PAYSTACK_BASE = 'https://api.paystack.co';

// ✅ Helper function for Paystack API calls
const paystackCall = async (method, path, body) => {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
};

// POST /api/paystack/initialize — start a deposit
router.post('/initialize', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.email) return res.status(400).json({ error: 'Account needs an email to deposit' });

    const reference = 'PSK-' + uuidv4();

    const psData = await paystackCall('POST', '/transaction/initialize', {
      email: user.email,
      amount: Math.round(parseFloat(amount) * 100),
      currency: 'GHS',
      reference,
      callback_url: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/wallet/deposit` : undefined,
      metadata: { username: user.username }
    });

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

// POST /api/paystack/webhook — Paystack calls this after payment
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
          console.log(`Deposit success: ${tx.username} +GHS${tx.amount}`);
        }
      }
    }

    // ✅ Handle transfer success (withdrawal sent)
    if (event.event === 'transfer.success') {
      const { reference } = event.data;
      const tx = await Transaction.findOne({ reference, type: 'withdraw' });
      if (tx) {
        tx.status = 'success';
        tx.updatedAt = new Date();
        await tx.save();
        console.log(`Withdrawal success: ${tx.username} -GHS${tx.amount}`);
      }
    }

    // ✅ Handle transfer failure (withdrawal failed - refund user)
    if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
      const { reference } = event.data;
      const tx = await Transaction.findOne({ reference, type: 'withdraw' });
      if (tx && tx.status !== 'rejected') {
        const user = await User.findOne({ username: tx.username });
        if (user) {
          user.balance = parseFloat((user.balance + tx.amount).toFixed(2));
          await user.save();
        }
        tx.status = 'rejected';
        tx.updatedAt = new Date();
        await tx.save();
        console.log(`Withdrawal failed - refunded: ${tx.username} +GHS${tx.amount}`);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Paystack webhook error:', err);
    res.sendStatus(200); // Always 200 to Paystack
  }
});

// GET /api/paystack/verify/:reference
router.get('/verify/:reference', authenticateToken, async (req, res) => {
  try {
    const tx = await Transaction.findOne({ reference: req.params.reference, username: req.user.username });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ status: tx.status, amount: tx.amount });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ POST /api/paystack/transfer — Admin approves withdrawal, sends money via Paystack
router.post('/transfer', authenticateToken, async (req, res) => {
  try {
    const { transactionId } = req.body;

    const tx = await Transaction.findOne({ id: transactionId, type: 'withdraw' });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status === 'success') return res.status(400).json({ error: 'Already processed' });
    if (tx.status === 'rejected') return res.status(400).json({ error: 'Transaction was rejected' });

    // ✅ Determine bank code based on MoMo number prefix
    const momoNumber = tx.address;
    let bankCode = 'MTN'; // default

    if (momoNumber) {
      const prefix = momoNumber.substring(0, 3);
      // MTN prefixes
      if (['024', '054', '055', '059', '025', '030', '023', '028'].includes(prefix)) bankCode = 'MTN';
      // Telecel (Vodafone) prefixes
      if (['020', '050'].includes(prefix)) bankCode = 'VOD';
      // AirtelTigo prefixes
      if (['027', '057', '026', '056'].includes(prefix)) bankCode = 'ATL';
    }

    // Step 1: Create transfer recipient
    const recipientData = await paystackCall('POST', '/transferrecipient', {
      type: 'mobile_money',
      name: tx.username,
      account_number: momoNumber,
      bank_code: bankCode,
      currency: 'GHS'
    });

    if (!recipientData.status) {
      return res.status(400).json({ error: recipientData.message || 'Failed to create recipient' });
    }

    const recipientCode = recipientData.data.recipient_code;
    const transferReference = 'TRF-' + uuidv4();

    // Step 2: Initiate transfer
    const transferData = await paystackCall('POST', '/transfer', {
      source: 'balance',
      amount: Math.round(tx.amount * 100), // pesewas
      recipient: recipientCode,
      reason: `Withdrawal - ${tx.username}`,
      reference: transferReference,
      currency: 'GHS'
    });

    if (!transferData.status) {
      return res.status(400).json({ error: transferData.message || 'Transfer failed' });
    }

    // Update transaction
    tx.status = 'under_review';
    tx.reference = transferReference;
    tx.updatedAt = new Date();
    await tx.save();

    res.json({
      success: true,
      message: 'Transfer initiated! Paystack is processing payment to user.',
      transferCode: transferData.data.transfer_code
    });
  } catch (err) {
    console.error('Paystack transfer error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ✅ Fixed export - was { router } before which caused the crash!
module.exports = router;
