const express = require('express');
const { User, Transaction } = require('../config/store');

const router = express.Router();

const gameOverrides = {
  updown: null,
  coinflip: null,
  dice: null,
  hilo: null,
  mines: null,
  roulette: null,
  bingo: null,
  racing: null,
  lottery: null,
  poker: null,
  slots: null,
  crash: null,
  luckyspin: null,
  maintenanceMode: false,
};

// Active game rounds
const activeRounds = {};

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
    const allGames = Object.keys(gameOverrides).filter(k => k !== 'maintenanceMode');
    const gameTx = transactions.filter(t => allGames.includes(t.type));
    const totalGames = gameTx.length;
    const totalWagered = gameTx.reduce((s, t) => s + (t.bet || 0), 0);
    const totalPayout = gameTx.reduce((s, t) => s + (t.payout || 0), 0);
    const houseEdge = totalWagered > 0
      ? (((totalWagered - totalPayout) / totalWagered) * 100).toFixed(2)
      : '0.00';
    res.json({
      totalUsers,
      totalGames,
      totalWagered,
      totalPayout,
      houseProfit: totalWagered - totalPayout,
      houseEdgePercent: houseEdge,
      maintenanceMode: gameOverrides.maintenanceMode,
      activeRounds
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await User.find({});
    res.json({
      users: users.map(u => ({
        username: u.username,
        email: u.email,
        balance: u.balance,
        currency: u.currency,
        createdAt: u.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all overrides
router.get('/overrides', (req, res) => res.json(gameOverrides));

// Set game override (admin manually sets outcome)
router.post('/overrides', (req, res) => {
  const { game, value } = req.body;
  if (!(game in gameOverrides)) return res.status(400).json({ error: 'Unknown game.' });
  gameOverrides[game] = value ?? null;
  res.json({
    message: 'Override set',
    game,
    value: gameOverrides[game],
    overrides: gameOverrides
  });
});

// Start a game round
router.post('/round/start', (req, res) => {
  const { game } = req.body;
  if (!game) return res.status(400).json({ error: 'Game required' });
  activeRounds[game] = {
    status: 'betting',
    startTime: Date.now(),
    bets: [],
    outcome: null
  };
  res.json({ message: 'Round started', round: activeRounds[game] });
});

// End a game round with outcome
router.post('/round/end', (req, res) => {
  const { game, outcome } = req.body;
  if (!game || outcome === undefined) {
    return res.status(400).json({ error: 'Game and outcome required' });
  }
  if (!activeRounds[game]) {
    return res.status(400).json({ error: 'No active round for this game' });
  }
  activeRounds[game].status = 'ended';
  activeRounds[game].outcome = outcome;
  activeRounds[game].endTime = Date.now();
  gameOverrides[game] = outcome;
  res.json({ message: 'Round ended', round: activeRounds[game] });
});

// Get active rounds
router.get('/rounds', (req, res) => res.json(activeRounds));

// Maintenance mode
router.post('/maintenance', (req, res) => {
  gameOverrides.maintenanceMode = !!req.body.enabled;
  res.json({ maintenanceMode: gameOverrides.maintenanceMode });
});

// Adjust user balance
router.post('/user/balance', async (req, res) => {
  try {
    const { username, amount } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.balance += amount;
    await user.save();
    res.json({ message: 'Balance updated', balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router, gameOverrides, activeRounds };
