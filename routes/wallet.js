const express = require('express');
const { User, Transaction } = require('../config/store');
const { authenticateToken } = require('../middleware/auth');
const { payoutWithdrawal } = require('./paystack');

const router = express.Router();

const userGameOverrides = {};
const gameOverrides = {};

function getUserOverride(username, game) {
  if (userGameOverrides[username] && userGameOverrides[username][game] !== undefined) {
    return userGameOverrides[username][game];
  }
  return gameOverrides[game] !== undefined ? gameOverrides[game] : null;
}

function clearUserOverride(username, game) {
  if (userGameOverrides[username]) {
    delete userGameOverrides[username][game];
  }
}

function detectMomoNetwork(phone) {
  const clean = (phone || '').replace(/\D/g, '');
  const prefix = clean.slice(-9, -7);
  const mtnPrefixes = ['24', '25', '53', '54', '55', '59'];
  const telecelPrefixes = ['20', '50'];
  const airtelTigoPrefixes = ['26', '56', '27', '57'];
  if (mtnPrefixes.includes(prefix)) return 'MTN';
  if (telecelPrefixes.includes(prefix)) return 'VOD';
  if (airtelTigoPrefixes.includes(prefix)) return 'ATL';
  return 'MTN';
}

async function adminOnly(req, res, next) {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user || !user.isAdmin) return res.status(403).json({ error: 'Admin only' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

router.use(authenticateToken);
router.use(adminOnly);

router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalDeposits = await Transaction.aggregate([
      { $match: { type: 'deposit', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalWithdrawals = await Transaction.aggregate([
      { $match: { type: 'withdraw', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalBets = await Transaction.aggregate([
      { $match: { type: { $in: ['coinflip','dice','hilo','mines','roulette','updown','crash','lottery','racing','bingo','poker'] } } },
      { $group: { _id: null, total: { $sum: '$bet' }, payout: { $sum: '$payout' } } }
    ]);
    const pendingDeposits = await Transaction.countDocuments({ type: 'deposit', status: 'pending' });
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
    res.json({
      success: true,
      data: {
        totalUsers,
        pendingDeposits,
        pendingWithdrawals,
        totalDeposited: totalDeposits[0]?.total || 0,
        totalWithdrawn: totalWithdrawals[0]?.total || 0,
        totalBets: totalBets[0]?.total || 0,
        totalPayouts: totalBets[0]?.payout || 0,
        houseProfit: (totalBets[0]?.total || 0) - (totalBets[0]?.payout || 0)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/deposits', async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const query = { type: 'deposit' };
    if (status !== 'all') query.status = status;
    const deposits = await Transaction.find(query).sort({ timestamp: -1 }).limit(100);
    res.json({ success: true, data: deposits });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/deposits/:id/approve', async (req, res) => {
  try {
    const tx = await Transaction.findOne({ id: req.params.id, type: 'deposit' });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    const user = await User.findOne({ username: tx.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.balance = parseFloat((user.balance + tx.amount).toFixed(2));
    await user.save();
    tx.status = 'approved';
    tx.processedAt = new Date();
    await tx.save();
    res.json({ success: true, message: `Deposit of GHS ${tx.amount} approved for ${tx.username}`, newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/deposits/:id/reject', async (req, res) => {
  try {
    const tx = await Transaction.findOne({ id: req.params.id, type: 'deposit' });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    tx.status = 'rejected';
    tx.processedAt = new Date();
    await tx.save();
    res.json({ success: true, message: `Deposit rejected for ${tx.username}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/withdrawals', async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const query = { type: 'withdraw' };
    if (status !== 'all') query.status = status;
    const withdrawals = await Transaction.find(query).sort({ timestamp: -1 }).limit(100);
    res.json({ success: true, data: withdrawals });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const tx = await Transaction.findOne({ id: req.params.id, type: 'withdraw' });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    if (tx.method === 'momo') {
      try {
        await payoutWithdrawal({
          username: tx.username,
          amount: tx.amount,
          accountNumber: tx.address,
          bankCode: detectMomoNetwork(tx.address),
          accountName: tx.username
        });
        tx.payoutStatus = 'sent';
      } catch (payoutErr) {
        tx.payoutStatus = 'failed';
        await tx.save();
        return res.status(500).json({ error: `Paystack payout failed: ${payoutErr.response?.data?.message || payoutErr.message}` });
      }
    } else {
      tx.payoutStatus = 'manual_required';
    }
    tx.status = 'approved';
    tx.processedAt = new Date();
    await tx.save();
    res.json({
      success: true,
      message: tx.payoutStatus === 'sent'
        ? `Withdrawal of GHS ${tx.amount} approved and paid out via Paystack to ${tx.username}`
        : `Withdrawal of GHS ${tx.amount} approved for ${tx.username} — manual crypto payout required`
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const tx = await Transaction.findOne({ id: req.params.id, type: 'withdraw' });
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    const user = await User.findOne({ username: tx.username });
    if (user) {
      user.balance = parseFloat((user.balance + tx.amount).toFixed(2));
      await user.save();
    }
    tx.status = 'rejected';
    tx.processedAt = new Date();
    await tx.save();
    res.json({ success: true, message: `Withdrawal rejected and refunded for ${tx.username}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 }).sort({ balance: -1 });
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:username/adjust-balance', async (req, res) => {
  try {
    const { amount, action } = req.body;
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (action === 'add') user.balance = parseFloat((user.balance + parseFloat(amount)).toFixed(2));
    else if (action === 'deduct') user.balance = Math.max(0, parseFloat((user.balance - parseFloat(amount)).toFixed(2)));
    else if (action === 'set') user.balance = parseFloat(parseFloat(amount).toFixed(2));
    await user.save();
    res.json({ success: true, newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:username/suspend', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.suspended = !user.suspended;
    await user.save();
    res.json({ success: true, suspended: user.suspended });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/overrides/:username', async (req, res) => {
  try {
    const { game, value } = req.body;
    if (!userGameOverrides[req.params.username]) userGameOverrides[req.params.username] = {};
    userGameOverrides[req.params.username][game] = value;
    res.json({ success: true, message: `Override set: ${req.params.username} → ${game} → ${JSON.stringify(value)}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/overrides/:username', async (req, res) => {
  res.json({ success: true, data: userGameOverrides[req.params.username] || {} });
});

router.delete('/overrides/:username', async (req, res) => {
  delete userGameOverrides[req.params.username];
  res.json({ success: true, message: 'All overrides cleared' });
});

router.delete('/overrides/:username/:game', async (req, res) => {
  if (userGameOverrides[req.params.username]) {
    delete userGameOverrides[req.params.username][req.params.game];
  }
  res.json({ success: true, message: `Override cleared: ${req.params.username} → ${req.params.game}` });
});

module.exports = router;
