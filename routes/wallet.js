const express = require('express');
const { Resend } = require('resend');
const { User, Transaction } = require('../config/store');

const router = express.Router();

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendWithdrawalEmail(username, amount, network, address, accountName) {
  try {
    await resend.emails.send({
      from: 'Foretell <onboarding@resend.dev>',
      to: 'michealkusi42@gmail.com',
      subject: '🚨 New Withdrawal Request - Foretell',
      html: `
        <h2>New Withdrawal Request</h2>
        <p><b>User:</b> ${username}</p>
        <p><b>Amount:</b> GHS ${amount}</p>
        <p><b>Network:</b> ${network}</p>
        <p><b>Account Name:</b> ${accountName || 'Not provided'}</p>
        <p><b>MoMo Number:</b> ${address}</p>
        <p><b>Time:</b> ${new Date().toLocaleString()}</p>
        <br/>
        <p>Login to your admin panel to approve or reject.</p>
        <a href="https://foretell-bet.vercel.app/admin">Open Admin Panel</a>
      `
    });
  } catch (err) {
    console.error('Email notification failed:', err.message);
  }
}

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

// Save MoMo number
router.patch('/momo', async (req, res) => {
  try {
    const { momoNetwork, momoNumber, momoName } = req.body;
    if (!momoNetwork || !momoNumber) return res.status(400).json({ error: 'Network and number required' });
    if (!momoName || momoName.trim().length < 3) return res.status(400).json({ error: 'Account name required' });
    if (momoNumber.length < 10) return res.status(400).json({ error: 'Invalid MoMo number' });

    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.momoNetwork = momoNetwork;
    user.momoNumber = momoNumber;
    user.momoName = momoName;
    await user.save();

    res.json({ success: true, message: 'MoMo number saved successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get saved MoMo
router.get('/momo', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, momoNetwork: user.momoNetwork || '', momoNumber: user.momoNumber || '', momoName: user.momoName || '' });
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

    const withdrawAddress = address || user.momoNumber;
    const withdrawNetwork = user.momoNetwork || method || 'momo';
    const withdrawName = user.momoName || 'Not provided';

    if (!withdrawAddress) return res.status(400).json({ error: 'Please bind your MoMo number in profile settings first' });

    user.balance = parseFloat((user.balance - withdrawAmount).toFixed(2));
    await user.save();

    const tx = new Transaction({
      id: Date.now().toString(),
      username: req.user.username,
      type: 'withdraw',
      amount: withdrawAmount,
      method: withdrawNetwork,
      address: withdrawAddress,
      status: 'pending',
      timestamp: new Date()
    });
    await tx.save();

    await sendWithdrawalEmail(req.user.username, withdrawAmount, withdrawNetwork, withdrawAddress, withdrawName);

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
