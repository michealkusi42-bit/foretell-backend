const express = require('express');
const rateLimit = require('express-rate-limit');
const { User, Transaction } = require('../config/store');
const { Resend } = require('resend');

const router = express.Router();

// Matches the same Resend setup already used in routes/wallet.js
const resend = new Resend(process.env.RESEND_API_KEY);

const userGameOverrides = {};
const gameOverrides = {};

// WIN RATE — stored in memory (persists until server restart)
let globalWinRate = 50; // default 50%

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

function getWinRate() {
  return globalWinRate;
}

function shouldPlayerWin() {
  return Math.random() * 100 < globalWinRate;
}

// ─── EMAIL: Deposit confirmation (sent to the USER, not the admin) ─────────
async function sendDepositConfirmationEmail({ to, name, amount, network, reference, newBalance }) {
  if (!to) {
    console.warn('User has no email on file — skipping deposit confirmation email');
    return;
  }

  const dateStr = new Date().toLocaleString();

  try {
    await resend.emails.send({
      from: 'Foretell <onboarding@resend.dev>',
      to,
      subject: '✅ Deposit Confirmed - GHS ' + amount + ' Credited',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 20px; border-radius: 10px 10px 0 0;">
            <h2 style="color: #00d4aa; margin: 0;">✅ Deposit Confirmed</h2>
          </div>
          <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px;">
            <p style="color: #333;">Dear ${name || 'Valued Customer'},</p>
            <p style="color: #333;">We're writing to confirm that your deposit has been successfully processed and credited to your Foretell account.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; font-weight: bold;">Amount</td>
                <td style="padding: 10px; color: #00d4aa; font-weight: bold; font-size: 18px;">GHS ${amount}</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; font-weight: bold;">Payment Method</td>
                <td style="padding: 10px; color: #333;">${network} Mobile Money</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; font-weight: bold;">Transaction Reference</td>
                <td style="padding: 10px; color: #333; font-family: monospace;">${reference}</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; font-weight: bold;">Date</td>
                <td style="padding: 10px; color: #333;">${dateStr}</td>
              </tr>
              <tr>
                <td style="padding: 10px; color: #666; font-weight: bold;">New Wallet Balance</td>
                <td style="padding: 10px; color: #00b894; font-weight: bold; font-size: 18px;">GHS ${newBalance}</td>
              </tr>
            </table>
            <p style="color: #333; margin-top: 20px;">Your funds are now available for use on the platform. If you did not initiate this transaction, please contact our support team immediately.</p>
            <p style="color: #333;">Thank you for choosing Foretell.</p>
            <p style="color: #333;">Best regards,<br/>The Foretell Team</p>
            <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
              support@fortellbet.com | fortellbet.com
            </p>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Deposit confirmation email failed:', err.message);
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Try again in 15 minutes.' }
});

router.post('/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured on the server' });
  }
  if (password === process.env.ADMIN_PANEL_PASSWORD) {
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Incorrect password' });
});

function requireAdminPassword(req, res, next) {
  const provided = req.headers['x-admin-password'];
  if (!provided || provided !== process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }
  next();
}

router.use(requireAdminPassword);

// ─── WIN RATE ─────────────────────────────────────────────────────────────────
router.get('/win-rate', (req, res) => {
  res.json({ success: true, winRate: globalWinRate });
});

router.post('/win-rate', (req, res) => {
  const { winRate } = req.body;
  if (winRate === undefined || winRate < 0 || winRate > 100) {
    return res.status(400).json({ error: 'Win rate must be between 0 and 100' });
  }
  globalWinRate = Number(winRate);
  res.json({ success: true, winRate: globalWinRate, message: 'Win rate updated to ' + globalWinRate + '%' });
});

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalDeposits = await Transaction.aggregate([
      { $match: { type: 'deposit', status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalWithdrawals = await Transaction.aggregate([
      { $match: { type: 'withdraw', status: 'success' } },
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

// ─── DEPOSITS ────────────────────────────────────────────────────────────────
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

    tx.status = 'success';
    tx.processedAt = new Date();
    await tx.save();

    // Fire-and-forget — don't block the admin response on email delivery
    sendDepositConfirmationEmail({
      to: user.email,
      name: user.username,
      amount: tx.amount,
      network: tx.momoNetwork || 'Mobile Money',
      reference: tx.reference || tx.id,
      newBalance: user.balance
    });

    res.json({ success: true, message: 'Deposit of GHS ' + tx.amount + ' approved for ' + tx.username, newBalance: user.balance });
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

    res.json({ success: true, message: 'Deposit rejected for ' + tx.username });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── WITHDRAWALS ─────────────────────────────────────────────────────────────
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

    tx.status = 'success';
    tx.processedAt = new Date();
    await tx.save();

    res.json({ success: true, message: 'Withdrawal of GHS ' + tx.amount + ' approved for ' + tx.username });
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

    res.json({ success: true, message: 'Withdrawal rejected and refunded for ' + tx.username });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── USERS ───────────────────────────────────────────────────────────────────
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

// ─── SUSPEND / UNSUSPEND (toggle) ────────────────────────────────────────────
router.post('/users/:username/suspend', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.suspended = !user.suspended;
    await user.save();
    res.json({
      success: true,
      suspended: user.suspended,
      message: user.suspended
        ? req.params.username + ' has been suspended'
        : req.params.username + ' has been unsuspended'
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GAME OVERRIDES ──────────────────────────────────────────────────────────
router.post('/overrides/:username', async (req, res) => {
  try {
    const { game, value } = req.body;
    if (!userGameOverrides[req.params.username]) {
      userGameOverrides[req.params.username] = {};
    }
    userGameOverrides[req.params.username][game] = value;
    res.json({ success: true, message: 'Override set: ' + req.params.username + ' → ' + game + ' → ' + JSON.stringify(value) });
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
  res.json({ success: true, message: 'Override cleared: ' + req.params.username + ' → ' + req.params.game });
});

module.exports = { router, gameOverrides, getUserOverride, clearUserOverride, getWinRate, shouldPlayerWin };
