const { users } = require('../config/store');

// Live crash game state (shared across all players)
let crashGame = {
  status: 'waiting', // waiting | running | crashed
  multiplier: 1.00,
  crashAt: null,
  players: new Map(), // socketId -> { username, bet, cashedOut, cashoutAt }
  intervalId: null,
};

function startCrashGame(io) {
  const r = Math.random();
  crashGame.crashAt = r < 0.01 ? 1.00 : parseFloat(Math.max(1, (0.99 / r)).toFixed(2));
  crashGame.multiplier = 1.00;
  crashGame.status = 'running';
  crashGame.players = new Map();

  io.emit('crash:start', { status: 'running' });

  crashGame.intervalId = setInterval(() => {
    crashGame.multiplier = parseFloat((crashGame.multiplier * 1.02).toFixed(2));

    // Auto cashout players who set autoCashout
    for (const [sid, player] of crashGame.players.entries()) {
      if (!player.cashedOut && player.autoCashout && crashGame.multiplier >= player.autoCashout) {
        const payout = parseFloat((player.bet * player.autoCashout).toFixed(8));
        const user = users.get(player.username);
        if (user) user.balance = parseFloat((user.balance + payout).toFixed(8));
        player.cashedOut = true;
        player.cashoutAt = player.autoCashout;
        io.to(sid).emit('crash:cashedout', { multiplier: player.autoCashout, payout, balance: user?.balance });
      }
    }

    io.emit('crash:tick', { multiplier: crashGame.multiplier });

    if (crashGame.multiplier >= crashGame.crashAt) {
      clearInterval(crashGame.intervalId);
      crashGame.status = 'crashed';
      io.emit('crash:crashed', { crashAt: crashGame.crashAt });

      setTimeout(() => {
        crashGame.status = 'waiting';
        io.emit('crash:waiting', { nextIn: 5000 });
        setTimeout(() => startCrashGame(io), 5000);
      }, 3000);
    }
  }, 100);
}

function registerGameHandlers(io, socket) {
  // ── Crash game ─────────────────────────────────────────────
  socket.on('crash:bet', ({ bet, autoCashout }) => {
    if (crashGame.status !== 'waiting') {
      return socket.emit('error', { message: 'Round already in progress' });
    }
    const user = users.get(socket.user.username);
    if (!user || user.balance < bet) {
      return socket.emit('error', { message: 'Insufficient balance' });
    }
    user.balance = parseFloat((user.balance - bet).toFixed(8));
    crashGame.players.set(socket.id, {
      username: socket.user.username,
      bet: parseFloat(bet),
      autoCashout: autoCashout || null,
      cashedOut: false,
      cashoutAt: null,
    });
    socket.emit('crash:betPlaced', { bet, balance: user.balance });
  });

  socket.on('crash:cashout', () => {
    const player = crashGame.players.get(socket.id);
    if (!player || player.cashedOut || crashGame.status !== 'running') return;

    const payout = parseFloat((player.bet * crashGame.multiplier).toFixed(8));
    const user = users.get(socket.user.username);
    if (user) user.balance = parseFloat((user.balance + payout).toFixed(8));
    player.cashedOut = true;
    player.cashoutAt = crashGame.multiplier;

    socket.emit('crash:cashedout', { multiplier: crashGame.multiplier, payout, balance: user?.balance });
    io.emit('crash:playerCashedOut', { username: socket.user.username, multiplier: crashGame.multiplier });
  });

  // ── Live chat ──────────────────────────────────────────────
  socket.on('chat:message', ({ message }) => {
    if (!message || message.length > 200) return;
    io.emit('chat:message', {
      username: socket.user.username,
      message: message.trim(),
      timestamp: new Date(),
    });
  });

  // ── Balance update ─────────────────────────────────────────
  socket.on('wallet:getBalance', () => {
    const user = users.get(socket.user.username);
    socket.emit('wallet:balance', { balance: user?.balance ?? 0 });
  });
}

// Start the live crash game loop when this module loads
function initGames(io) {
  setTimeout(() => startCrashGame(io), 3000);
}

module.exports = { registerGameHandlers, initGames };
