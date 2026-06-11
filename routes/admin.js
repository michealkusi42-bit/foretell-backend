const express = require('express');
const { User, Transaction } = require('../config/store');

const router = express.Router();

const gameOverrides = {
  dice: null,
  crash: null,
  roulette: null,
  luckyspin: null,
  maintenanceMode: false,
};

function adminOnly(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin access denied' });
  }
  next();
}

router.use(adminOnly);

router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const transactions = await Transaction.find({});
    const gameTx = transactions.filter(t => ['dice','crash','roulette','luckyspin'].includes(t.type));
    const totalGames = gameTx.length;
    const totalWagered = gameTx.reduce((s, t) => s + (t.bet || 0), 0);
    const totalPayout = gameTx.reduce((s, t) => s + (t.payout || 0), 0);
    const houseEdge = totalWagered > 0 ? (((totalWagered - totalPayout) / totalWagered) * 100).toFixed(2) : '0.00';

    res.json({ totalUsers, totalGames, totalWagered, totalPayout, houseProfit: totalWagered - totalPayout, houseEdgePercent: houseEdge, maintenanceMode: gameOverrides.maintenanceMode });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await User.find({});
    res.json({ users: users.map(u => ({ username: u.username, balance: u.balance, createdAt: u.createdAt })) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:username/adjust-balance', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { amount, reason } = req.body;
    user.balance = parseFloat((user.balance + parseFloat(amount)).toFixed(8));
    await user.save();
    res.json({ message: Balance adjusted by ${amount}, username: user.username, newBalance: user.balance, reason });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:username/ban', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.banned = true;
    await user.save();
    res.json({ message: ${req.params.username} has been banned });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/overrides', (req, res) => res.json(gameOverrides));

router.post('/overrides', (req, res) => {
  const { game, value } = req.body;
  if (!(game in gameOverrides)) return res.status(400).json({ error: Unknown game. });
  gameOverrides[game] = value ?? null;
  res.json({ message: 'Override set', game, value: gameOverrides[game], overrides: gameOverrides });
});

router.post('/maintenance', (req, res) => {
  gameOverrides.maintenanceMode = !!req.body.enabled;
  res.json({ maintenanceMode: gameOverrides.maintenanceMode });
});

module.exports = { router, gameOverrides };
