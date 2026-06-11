const express = require('express');
const { users, transactions } = require('../config/store');

const router = express.Router();

// GET /api/leaderboard — top players by total winnings
router.get('/', (req, res) => {
  const board = [];

  for (const [username, user] of users.entries()) {
    const userTx = transactions.get(username) || [];
    const gameTx = userTx.filter(t => ['dice','crash','roulette','luckyspin'].includes(t.type));
    const totalWagered = gameTx.reduce((s, t) => s + t.bet, 0);
    const totalProfit = gameTx.reduce((s, t) => s + t.profit, 0);
    const wins = gameTx.filter(t => t.payout > 0).length;

    board.push({
      username,
      balance: user.balance,
      totalWagered: parseFloat(totalWagered.toFixed(8)),
      totalProfit: parseFloat(totalProfit.toFixed(8)),
      wins,
      gamesPlayed: gameTx.length,
    });
  }

  board.sort((a, b) => b.totalProfit - a.totalProfit);
  res.json({ leaderboard: board.slice(0, 20) });
});

module.exports = router;
