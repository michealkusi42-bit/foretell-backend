const express = require('express');
const { User, Transaction } = require('../config/store');

const router = express.Router();

// GET /api/leaderboard
router.get('/', async (req, res) => {
  try {
    const users = await User.find({});
    const board = [];

    for (const user of users) {
      const userTx = await Transaction.find({ username: user.username });
      const gameTx = userTx.filter(t => ['dice','crash','roulette','luckyspin'].includes(t.type));
      const totalWagered = gameTx.reduce((s, t) => s + (t.bet || 0), 0);
      const totalProfit = gameTx.reduce((s, t) => s + (t.profit || 0), 0);
      const wins = gameTx.filter(t => t.payout > 0).length;

      board.push({
        username: user.username,
        balance: user.balance,
        totalWagered: parseFloat(totalWagered.toFixed(8)),
        totalProfit: parseFloat(totalProfit.toFixed(8)),
        wins,
        gamesPlayed: gameTx.length,
      });
    }

    board.sort((a, b) => b.totalProfit - a.totalProfit);
    res.json({ leaderboard: board.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
