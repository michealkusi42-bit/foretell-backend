const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const gameRoutes = require('./routes/games');
const leaderboardRoutes = require('./routes/leaderboard');
const affiliateRoutes = require('./routes/affiliates');
const { router: adminRouter } = require('./routes/admin');
const { authenticateToken } = require('./middleware/auth');
const { registerGameHandlers } = require('./games/socketHandler');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

app.use('/api/games', (req, res, next) => {
  const { gameOverrides } = require('./routes/admin');
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
app.use('/api/admin', adminRouter);

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

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const jwt = require('jsonwebtoken');
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { next(new Error('Invalid token')); }
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
