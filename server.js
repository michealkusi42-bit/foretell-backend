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
const { registerGameHandlers, initGames } = require('./games/socketHandler');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use('/api/games', (req, res, next) => {
  const { gameOverrides } = require('./routes/admin');
  if (gameOverrides.maintenanceMode) return res.status(503).json({ error: 'Games under maintenance.' });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.use('/api/auth', authRoutes);
app.use('/api/wallet', authenticateToken, walletRoutes);
app.use('/api/games', authenticateToken, gameRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/affiliates', affiliateRoutes);
app.use('/api/admin', adminRouter);

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
  console.log(`Player connected: ${socket.user.username}`);
  registerGameHandlers(io, socket);
  console.log(`Player disconnected: ${socket.user.username});
        });
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Foretell Backends running on port ${PORT}`);
  // initGames(io);
});

module.exports = { app, io };
