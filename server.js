const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const gameRoutes = require('./routes/games');
const leaderboardRoutes = require('./routes/leaderboard');
const affiliateRoutes = require('./routes/affiliates');
const vipSpinRoutes = require('./routes/vip-spin');
const adminModule = require('./routes/admin');
const offlineGameRoutes = require('./routes/offline-game');
const { authenticateToken } = require('./middleware/auth');
const { registerGameHandlers } = require('./games/socketHandler');
const { User } = require('./config/store');

const adminRouter = adminModule.router || adminModule;
const gameOverrides = adminModule.gameOverrides || { maintenanceMode: false };

const routeMap = {
  authRoutes,
  walletRoutes,
  gameRoutes,
  leaderboardRoutes,
  affiliateRoutes,
  vipSpinRoutes,
  offlineGameRoutes,
};
Object.entries(routeMap).forEach(([name, r]) => {
  if (typeof r !== 'function') {
    console.error(`❌ BAD EXPORT: ${name} is a ${typeof r}`, r);
  } else {
    console.log(`✅ ${name} OK`);
  }
});

const avatarDir = path.join(__dirname, 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user.username}-${Date.now()}${ext}`);
  }
});
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'https://fortellbet.com',
  'https://www.fortellbet.com',
  'https://foretell-bet.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001'
];

const corsOptions = {
  origin: true, // allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-admin-password']
};

const io = new Server(server, {
  cors: {
    origin: true, // allow all origins
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-password']
  }
});

app.set('trust proxy', 1);

// CORS must come BEFORE helmet so preflight OPTIONS requests are not blocked
app.use(cors({ origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-admin-password'] }));
app.options('*', cors({ origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-admin-password'] }));

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

app.use(express.json());
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/games', (req, res, next) => {
  if (gameOverrides.maintenanceMode) return res.status(503).json({ error: 'Games under maintenance.' });
  next();
});

app.use('/api/offline-game', (req, res, next) => {
  if (gameOverrides.maintenanceMode) return res.status(503).json({ error: 'Games under maintenance.' });
  next();
});

const mockGames = [
  { id: '1', name: 'Sweet Bonanza', image: 'https://placehold.co/200x150?text=Sweet+Bonanza' },
  { id: '2', name: 'Gates of Olympus', image: 'https://placehold.co/200x150?text=Gates+of+Olympus' },
  { id: '3', name: 'Big Bass Bonanza', image: 'https://placehold.co/200x150?text=Big+Bass' },
  { id: '4', name: 'Wolf Gold', image: 'https://placehold.co/200x150?text=Wolf+Gold' },
  { id: '5', name: 'Starburst', image: 'https://placehold.co/200x150?text=Starburst' },
  { id: '6', name: 'Book of Dead', image: 'https://placehold.co/200x150?text=Book+of+Dead' },
  { id: '7', name: 'Gonzo Quest', image: 'https://placehold.co/200x150?text=Gonzo+Quest' },
  { id: '8', name: 'Mega Moolah', image: 'https://placehold.co/200x150?text=Mega+Moolah' },
  { id: '9', name: 'Reactoonz', image: 'https://placehold.co/200x150?text=Reactoonz' },
  { id: '10', name: 'Dead or Alive', image: 'https://placehold.co/200x150?text=Dead+or+Alive' },
  { id: '11', name: 'Fire Joker', image: 'https://placehold.co/200x150?text=Fire+Joker' },
  { id: '12', name: 'Jammin Jars', image: 'https://placehold.co/200x150?text=Jammin+Jars' }
];

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.use('/api/auth', authRoutes);
app.use('/api/wallet', authenticateToken, walletRoutes);
app.use('/api/games', authenticateToken, gameRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/affiliates', affiliateRoutes);
app.use('/api/vip-spin', vipSpinRoutes);
app.use('/api/admin', adminRouter);
app.use('/api/offline-game', offlineGameRoutes);

app.get('/api/setting/site', (req, res) => res.json({}));
app.get('/api/casino/recommend', (req, res) => res.json(mockGames));
app.post('/api/casino/recommend', (req, res) => res.json(mockGames));
app.post('/api/casino/ag-games', (req, res) => res.json({ data: mockGames, count: mockGames.length }));
app.get('/api/casino/ag-category', (req, res) => res.json(['slots', 'live', 'fish', 'poker', 'hot']));
app.post('/api/casino/games', (req, res) => res.json({ data: mockGames, count: mockGames.length }));
app.post('/api/casino/provider', (req, res) => res.json(['Pragmatic', 'NetEnt', 'Microgaming']));
app.post('/api/casino/search', (req, res) => res.json({ data: mockGames, count: mockGames.length }));
app.get('/api/casino/providers', (req, res) => res.json(['Pragmatic', 'NetEnt', 'Microgaming']));
app.get('/api/casino/recent-big-win', (req, res) => res.json([]));
app.post('/api/casino/launch', authenticateToken, (req, res) => res.json({ url: '' }));
app.post('/api/casino/ag-launch', authenticateToken, (req, res) => res.json({ url: '' }));
app.get('/api/preference', authenticateToken, (req, res) => res.json({ language: 'en' }));
app.patch('/api/preference', authenticateToken, (req, res) => res.json({ language: 'en' }));
app.get('/api/notification', authenticateToken, (req, res) => res.json([]));
app.get('/api/player/balance', authenticateToken, (req, res) => res.json({ balance: 0 }));
app.get('/api/sport', (req, res) => res.json([]));
app.get('/api/bonus', (req, res) => res.json([]));
app.get('/api/package', (req, res) => res.json([]));
app.get('/api/player/my-games', authenticateToken, (req, res) => res.json([]));
app.post('/api/player/transaction', authenticateToken, (req, res) => res.json({ promotions: [], transactions: [], system: [], count: 0, promotionsCount: 0, transactionsCount: 0, systemCount: 0 }));
app.get('/api/player/kyc', authenticateToken, (req, res) => res.json({ status: 'unverified' }));
app.post('/api/player/kyc', authenticateToken, (req, res) => res.json({ status: 'pending' }));
app.get('/api/currency/list', (req, res) => res.json([{ code: 'GHS', name: 'Ghana Cedis', symbol: 'GH₵' }]));
app.post('/api/nowpay/deposit', authenticateToken, (req, res) => res.json({ status: 'pending', address: '' }));
app.post('/api/withdraw', authenticateToken, (req, res) => res.json({ status: 'pending' }));
app.get('/api/player/username', authenticateToken, (req, res) => res.json({}));
app.patch('/api/player/username', authenticateToken, (req, res) => res.json({}));
app.patch('/api/player/password', authenticateToken, (req, res) => res.json({}));

app.patch('/api/player/avatar', authenticateToken, uploadAvatar.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const avatarPath = `uploads/avatars/${req.file.filename}`;
    await User.findOneAndUpdate(
      { username: req.user.username },
      { avatar: avatarPath },
      { new: true }
    );
    res.json({ avatar: avatarPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/player/currency', authenticateToken, (req, res) => res.json({}));
app.get('/api/player/referral', authenticateToken, (req, res) => res.json({ code: '', count: 0 }));
app.post('/api/nowpay/get-withdraw-currency', authenticateToken, (req, res) => res.json({}));
app.get('/api/nowpay/currency', (req, res) => res.json([]));
app.get('/api/casino/game-detail/:code', (req, res) => res.json({}));
app.get('/api/casino/ag-game-detail/:code', (req, res) => res.json({}));
app.get('/api/bonus/:id', (req, res) => res.json({}));

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const jwt = require('jsonwebtoken');
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => {
  console.log('Player connected: ' + socket.user.username);
  registerGameHandlers(io, socket);
  socket.on('disconnect', () => console.log('Player disconnected: ' + socket.user.username));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('Foretell Backend running on port ' + PORT);
});

module.exports = { app, io };
