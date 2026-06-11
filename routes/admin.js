const express = require('express');
const { users, transactions } = require('../config/store');

const router = express.Router();

// In-memory admin overrides
const gameOverrides = {
  dice: null,       // force a specific roll result (null = random)
  crash: null,      // force crash point
  roulette: null,   // force result number
  luckyspin: null,  // force segment index
  maintenanceMode: false,
};

// ── Admin auth middleware ────────────────────────────────────
function adminOnly(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin access denied' });
  }
  next();
}

router.use(adminOnly);

// ── GET /api/admin/stats ─────────────────────────────────────
router.get('/stats', (req, res) => {
  const totalUsers = users.size;
  let totalWagered = 0, totalPayout = 0, totalGames = 0;

  for (const [username] of users.entries()) {
    const userTx = transactions.get(username) || [];
    const gameTx = userTx.filter(t => ['dice','crash','roulette','luckyspin'].includes(t.type));
    totalGames += gameTx.length;
    totalWagered += gameTx.reduce((s, t) => s + t.bet, 0);
    totalPayout += gameTx.reduce((s, t) => s + t.payout, 0);
  }

  const houseEdge = totalWagered > 0 ? (((totalWagered - totalPayout) / totalWagered) * 100).toFixed(2) : '0.00';

  res.json({
    totalUsers,
    totalGames,
    totalWagered: parseFloat(totalWagered.toFixed(8)),
    totalPayout: parseFloat(totalPayout.toFixed(8)),
    houseProfit: parseFloat((totalWagered - totalPayout).toFixed(8)),
    houseEdgePercent: houseEdge,
    maintenanceMode: gameOverrides.maintenanceMode,
  });
});

// ── GET /api/admin/users ─────────────────────────────────────
router.get('/users', (req, res) => {
  const list = [...users.values()].map(u => ({
    id: u.id,
    username: u.username,
    balance: u.balance,
    createdAt: u.createdAt,
  }));
  res.json({ users: list });
});

// ── POST /api/admin/users/:username/adjust-balance ──────────
router.post('/users/:username/adjust-balance', (req, res) => {
  const user = users.get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { amount, reason } = req.body;
  if (amount === undefined) return res.status(400).json({ error: 'amount required' });

  user.balance = parseFloat((user.balance + parseFloat(amount)).toFixed(8));
  res.json({ message: `Balance adjusted by ${amount}`, username: user.username, newBalance: user.balance, reason });
});

// ── POST /api/admin/users/:username/ban ─────────────────────
router.post('/users/:username/ban', (req, res) => {
  const user = users.get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.banned = true;
  res.json({ message: `${req.params.username} has been banned` });
});

// ── GET /api/admin/overrides ─────────────────────────────────
router.get('/overrides', (req, res) => res.json(gameOverrides));

// ── POST /api/admin/overrides ────────────────────────────────
// Body: { game: 'dice', value: 55 } — set a forced outcome
// Body: { game: 'dice', value: null } — reset to random
router.post('/overrides', (req, res) => {
  const { game, value } = req.body;
  if (!(game in gameOverrides)) {
    return res.status(400).json({ error: `Unknown game. Options: ${Object.keys(gameOverrides).join(', ')}` });
  }
  gameOverrides[game] = value ?? null;
  res.json({ message: `Override set`, game, value: gameOverrides[game], overrides: gameOverrides });
});

// ── POST /api/admin/maintenance ─────────────────────────────
router.post('/maintenance', (req, res) => {
  gameOverrides.maintenanceMode = !!req.body.enabled;
  res.json({ maintenanceMode: gameOverrides.maintenanceMode });
});

module.exports = { router, gameOverrides };
