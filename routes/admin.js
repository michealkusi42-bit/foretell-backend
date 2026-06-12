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

router.post('/users/:username/adjust-balance'
