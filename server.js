const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ─── IN-MEMORY DATABASE ───────────────────────────────────────────────────────
// Replace with MongoDB/PostgreSQL for production
let users = {};
let bets = [];
let transactions = [];
let notifications = [];
let settings = {
  siteName: process.env.VITE_APP_NAME || '87 Casino',
  maintenanceMode: false,
  minDeposit: 10,
  maxBet: 10000,
  houseEdge: 5, // percent
};
// Admin outcome control: game -> { forceResult: null | 'win' | 'lose' }
let adminControls = {
  crash: { forceMultiplier: null },   // e.g. set to 1.5 to crash at 1.5x
  dice: { forceResult: null },        // 'win' or 'lose'
  roulette: { forceNumber: null },
  luckySpin: { forceIndex: null },
  globalForce: null,                  // 'win' | 'lose' | null
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const adminAuth = (req, res, next) => {
  auth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ message: 'Admin only' });
    next();
  });
};

const getUser = (id) => users[id];
const saveUser = (user) => { users[user.id] = user; };

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, referralCode } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ message: 'All fields required' });

  const exists = Object.values(users).find(u => u.email === email || u.username === username);
  if (exists) return res.status(409).json({ message: 'User already exists' });

  const hashed = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    username,
    email,
    password: hashed,
    balance: 1000, // welcome bonus
    isAdmin: false,
    isVerified: false,
    referralCode: uuidv4().slice(0, 8).toUpperCase(),
    referredBy: referralCode || null,
    createdAt: new Date().toISOString(),
    totalWagered: 0,
    totalWon: 0,
  };
  saveUser(user);

  const token = jwt.sign({ id: user.id, isAdmin: false }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser, message: 'Registered successfully' });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = Object.values(users).find(u => u.email === email);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ message: 'Invalid password' });

  const token = jwt.sign({ id: user.id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// ─── PLAYER ROUTES ───────────────────────────────────────────────────────────
app.get('/api/player/profile', auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const { password: _, ...safeUser } = user;
  res.json(safeUser);
});

app.put('/api/player/profile', auth, (req, res) => {
  const user = getUser(req.user.id);
  const { username, avatar } = req.body;
  if (username) user.username = username;
  if (avatar) user.avatar = avatar;
  saveUser(user);
  const { password: _, ...safeUser } = user;
  res.json(safeUser);
});

app.get('/api/player/balance', auth, (req, res) => {
  const user = getUser(req.user.id);
  res.json({ balance: user.balance });
});

app.get('/api/player/transactions', auth, (req, res) => {
  const userTxs = transactions.filter(t => t.userId === req.user.id);
  res.json(userTxs);
});

app.get('/api/player/bets', auth, (req, res) => {
  const userBets = bets.filter(b => b.userId === req.user.id);
  res.json(userBets);
});

// ─── VERIFY ROUTES ───────────────────────────────────────────────────────────
app.post('/api/verify/request', auth, (req, res) => {
  const user = getUser(req.user.id);
  user.verificationStatus = 'pending';
  saveUser(user);
  res.json({ message: 'Verification request submitted' });
});

app.get('/api/verify/status', auth, (req, res) => {
  const user = getUser(req.user.id);
  res.json({ status: user.verificationStatus || 'unverified' });
});

// ─── PAYMENT ROUTES ──────────────────────────────────────────────────────────
app.post('/api/payment/deposit', auth, (req, res) => {
  const { amount, method } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

  const user = getUser(req.user.id);
  user.balance += parseFloat(amount);
  saveUser(user);

  const tx = {
    id: uuidv4(),
    userId: req.user.id,
    type: 'deposit',
    amount,
    method: method || 'crypto',
    status: 'completed',
    createdAt: new Date().toISOString(),
  };
  transactions.push(tx);

  io.to(req.user.id).emit('balance_update', { balance: user.balance });
  res.json({ message: 'Deposit successful', balance: user.balance, transaction: tx });
});

app.post('/api/payment/withdraw', auth, (req, res) => {
  const { amount, address } = req.body;
  const user = getUser(req.user.id);
  if (user.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });

  user.balance -= parseFloat(amount);
  saveUser(user);

  const tx = {
    id: uuidv4(),
    userId: req.user.id,
    type: 'withdrawal',
    amount,
    address,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  transactions.push(tx);

  io.to(req.user.id).emit('balance_update', { balance: user.balance });
  res.json({ message: 'Withdrawal request submitted', transaction: tx });
});

// ─── CASINO / GAME ROUTES ────────────────────────────────────────────────────
const resolveBet = (game, betData) => {
  // Admin global force
  if (adminControls.globalForce === 'win') return { win: true, multiplier: 2 };
  if (adminControls.globalForce === 'lose') return { win: false, multiplier: 0 };

  if (game === 'dice') {
    if (adminControls.dice.forceResult === 'win') return { win: true, multiplier: 2 };
    if (adminControls.dice.forceResult === 'lose') return { win: false, multiplier: 0 };
    const roll = Math.random() * 100;
    const win = roll < (betData.prediction || 50);
    return { win, multiplier: win ? 2 : 0, roll };
  }

  if (game === 'crash') {
    const multiplier = adminControls.crash.forceMultiplier ||
      Math.max(1, 1 / (Math.random() * (1 - settings.houseEdge / 100)));
    return { win: betData.cashoutAt <= multiplier, multiplier };
  }

  if (game === 'roulette') {
    const number = adminControls.roulette.forceNumber !== null
      ? adminControls.roulette.forceNumber
      : Math.floor(Math.random() * 37);
    const win = betData.betOn === number.toString() ||
      (betData.betOn === 'red' && [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(number)) ||
      (betData.betOn === 'black' && [2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35].includes(number)) ||
      (betData.betOn === 'even' && number % 2 === 0 && number !== 0) ||
      (betData.betOn === 'odd' && number % 2 !== 0);
    return { win, number, multiplier: win ? (betData.betOn.length > 2 ? 35 : 2) : 0 };
  }

  // Default: coin flip
  const win = Math.random() > 0.5;
  return { win, multiplier: win ? 2 : 0 };
};

app.post('/api/casino/bet', auth, (req, res) => {
  const { game, amount, ...betData } = req.body;
  const user = getUser(req.user.id);

  if (user.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });

  user.balance -= parseFloat(amount);
  user.totalWagered = (user.totalWagered || 0) + parseFloat(amount);

  const result = resolveBet(game, betData);
  const payout = result.win ? amount * result.multiplier : 0;
  user.balance += payout;
  user.totalWon = (user.totalWon || 0) + payout;
  saveUser(user);

  const bet = {
    id: uuidv4(),
    userId: req.user.id,
    game,
    amount,
    betData,
    result,
    payout,
    balanceAfter: user.balance,
    createdAt: new Date().toISOString(),
  };
  bets.push(bet);

  io.to(req.user.id).emit('bet_result', bet);
  io.to(req.user.id).emit('balance_update', { balance: user.balance });
  res.json(bet);
});

app.get('/api/casino/history', auth, (req, res) => {
  res.json(bets.filter(b => b.userId === req.user.id).slice(-50).reverse());
});

app.get('/api/casino/live', (req, res) => {
  // Recent bets across all users (anonymized)
  const recent = bets.slice(-20).reverse().map(b => ({
    game: b.game, amount: b.amount, win: b.result.win, createdAt: b.createdAt
  }));
  res.json(recent);
});

// ─── BONUS ROUTES ────────────────────────────────────────────────────────────
app.get('/api/bonus/available', auth, (req, res) => {
  res.json([
    { id: 1, name: 'Welcome Bonus', amount: 100, type: 'deposit_match', active: true },
    { id: 2, name: 'Daily Spin', amount: 50, type: 'free_spin', active: true },
  ]);
});

app.post('/api/bonus/claim/:id', auth, (req, res) => {
  const user = getUser(req.user.id);
  user.balance += 100;
  saveUser(user);
  io.to(req.user.id).emit('balance_update', { balance: user.balance });
  res.json({ message: 'Bonus claimed!', balance: user.balance });
});

// ─── LUCKY SPIN ───────────────────────────────────────────────────────────────
app.post('/api/luckyspin/spin', auth, (req, res) => {
  const user = getUser(req.user.id);
  const prizes = [10, 25, 50, 100, 200, 500, 5, 15];
  const index = adminControls.luckySpin.forceIndex !== null
    ? adminControls.luckySpin.forceIndex
    : Math.floor(Math.random() * prizes.length);
  const prize = prizes[index];
  user.balance += prize;
  saveUser(user);
  io.to(req.user.id).emit('balance_update', { balance: user.balance });
  res.json({ index, prize, balance: user.balance });
});

// ─── NOTIFICATION ROUTES ─────────────────────────────────────────────────────
app.get('/api/notification', auth, (req, res) => {
  const userNotifs = notifications.filter(n => n.userId === req.user.id || n.global);
  res.json(userNotifs);
});

app.put('/api/notification/:id/read', auth, (req, res) => {
  const n = notifications.find(n => n.id === req.params.id);
  if (n) n.read = true;
  res.json({ message: 'Marked as read' });
});

// ─── AFFILIATE ROUTES ────────────────────────────────────────────────────────
app.get('/api/affiliate/stats', auth, (req, res) => {
  const user = getUser(req.user.id);
  const referred = Object.values(users).filter(u => u.referredBy === user.referralCode);
  res.json({
    referralCode: user.referralCode,
    totalReferred: referred.length,
    totalEarned: referred.length * 10,
  });
});

// ─── SETTINGS ROUTES ─────────────────────────────────────────────────────────
app.get('/api/setting', (req, res) => {
  const { houseEdge, ...publicSettings } = settings;
  res.json(publicSettings);
});

// ─── OFFLINE GAME ROUTES ─────────────────────────────────────────────────────
app.get('/api/offlinegame/list', (req, res) => {
  res.json([
    { id: 1, name: 'Dice', slug: 'dice', active: true },
    { id: 2, name: 'Crash', slug: 'crash', active: true },
    { id: 3, name: 'Roulette', slug: 'roulette', active: true },
    { id: 4, name: 'Lucky Spin', slug: 'luckyspin', active: true },
  ]);
});

// ─── ADMIN ROUTES ────────────────────────────────────────────────────────────
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const totalUsers = Object.keys(users).length;
  const totalBets = bets.length;
  const totalWagered = bets.reduce((s, b) => s + parseFloat(b.amount), 0);
  const totalPayout = bets.reduce((s, b) => s + parseFloat(b.payout), 0);
  res.json({ totalUsers, totalBets, totalWagered, totalPayout, profit: totalWagered - totalPayout });
});

app.get('/api/admin/users', adminAuth, (req, res) => {
  const safeUsers = Object.values(users).map(({ password: _, ...u }) => u);
  res.json(safeUsers);
});

app.put('/api/admin/users/:id/balance', adminAuth, (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  user.balance = parseFloat(req.body.balance);
  saveUser(user);
  io.to(req.params.id).emit('balance_update', { balance: user.balance });
  res.json({ message: 'Balance updated', balance: user.balance });
});

app.put('/api/admin/users/:id/ban', adminAuth, (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  user.banned = req.body.banned;
  saveUser(user);
  res.json({ message: `User ${user.banned ? 'banned' : 'unbanned'}` });
});

// ADMIN: Control game outcomes
app.get('/api/admin/controls', adminAuth, (req, res) => {
  res.json(adminControls);
});

app.put('/api/admin/controls', adminAuth, (req, res) => {
  const { game, control, value } = req.body;
  if (game === 'global') {
    adminControls.globalForce = value; // 'win', 'lose', or null
  } else if (adminControls[game]) {
    adminControls[game][control] = value;
  }
  res.json({ message: 'Control updated', adminControls });
});

app.put('/api/admin/settings', adminAuth, (req, res) => {
  settings = { ...settings, ...req.body };
  res.json({ message: 'Settings updated', settings });
});

app.get('/api/admin/bets', adminAuth, (req, res) => {
  res.json(bets.slice(-100).reverse());
});

app.get('/api/admin/transactions', adminAuth, (req, res) => {
  res.json(transactions.slice(-100).reverse());
});

app.put('/api/admin/transactions/:id', adminAuth, (req, res) => {
  const tx = transactions.find(t => t.id === req.params.id);
  if (!tx) return res.status(404).json({ message: 'Not found' });
  tx.status = req.body.status;
  if (req.body.status === 'completed' && tx.type === 'withdrawal') {
    // already deducted on request
  }
  res.json({ message: 'Transaction updated', tx });
});

app.post('/api/admin/notify', adminAuth, (req, res) => {
  const { message, userId } = req.body;
  const notif = {
    id: uuidv4(),
    message,
    userId: userId || null,
    global: !userId,
    read: false,
    createdAt: new Date().toISOString(),
  };
  notifications.push(notif);
  if (userId) {
    io.to(userId).emit('notification', notif);
  } else {
    io.emit('notification', notif);
  }
  res.json({ message: 'Notification sent' });
});

// Admin: create first admin account
app.post('/api/admin/setup', async (req, res) => {
  const { secret, username, email, password } = req.body;
  if (secret !== (process.env.ADMIN_SETUP_SECRET || 'setup-secret-123'))
    return res.status(403).json({ message: 'Invalid setup secret' });

  const hashed = await bcrypt.hash(password, 10);
  const admin = {
    id: uuidv4(),
    username,
    email,
    password: hashed,
    balance: 0,
    isAdmin: true,
    isVerified: true,
    referralCode: 'ADMIN',
    createdAt: new Date().toISOString(),
    totalWagered: 0,
    totalWon: 0,
  };
  saveUser(admin);
  res.json({ message: 'Admin created successfully' });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', name: settings.siteName }));

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.join(decoded.id);
      socket.userId = decoded.id;
    } catch {}
  });

  socket.on('disconnect', () => {});
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Casino backend running on port ${PORT}`));
