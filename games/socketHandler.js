const { User } = require('../config/store');

let crashGame = {
  status: 'waiting',
  multiplier: 1.00,
  crashAt: null,
  players: new Map(),
  intervalId: null,
};

function startCrashGame(io) {
  const r = Math.random();
  crashGame.crashAt = r < 0.01 ? 1.00 : parseFloat(Math.max(1, (0.99 / r)).toFixed(2));
  crashGame.multiplier = 1.00;
  crashGame.status = 'running';
  crashGame.players = new Map();

  io.emit('crash:start', { status: 'running' });

  crashGame.intervalId = setInterval(async () => {
    crashGame.multiplier = parseFloat((crashGame.multiplier * 1.02).toFixed(2));

    for (const [sid, player] of crashGame.players.entries()) {
      if (!player.cashedOut && player.autoCashout && crashGame.multiplier >= player.autoCashout) {
        const payout = parseFloat((player.bet * player.autoCashout).toFixed(8));
        try {
          const user = await User.findOne({ username: player.username });
          if (user) {
            user.balance = parseFloat((user.balance + payout).toFixed(8));
            await user.save();
            io.to(sid).emit('crash:cashedout', { multiplier: player.autoCashout, payout, balance: user.balance });
          }
        } catch (e) {}
        player.cashedOut = true;
        player.cashoutAt = player.autoCashout;
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
  socket.on('crash:bet', async ({ bet, autoCashout }) => {
    if (crashGame.status !== 'waiting') return socket.emit('error', { message: 'Round already in progress' });
    try {
      const user = await User.findOne({ username: socket.user.username });
      if (!user || user.balance < bet) return socket.emit('error', { message: 'Insufficient balance' });
      user.balance = parseFloat((user.balance - bet).toFixed(8));
      await user.save();
      crashGame.players.set(socket.id, { username: socket.user.username, bet: parseFloat(bet), autoCashout: autoCashout || null, cashedOut: false, cashoutAt: null });
      socket.emit('crash:betPlaced', { bet, balance: user.balance });
    } catch (e) { socket.emit('error', { message: 'Server error' }); }
  });

  socket.on('crash:cashout', async () => {
    const player = crashGame.players.get(socket.id);
    if (!player || player.cashedOut || crashGame.status !== 'running') return;
    const payout = parseFloat((player.bet * crashGame.multiplier).toFixed(8));
    try {
      const user = await User.findOne({ username: socket.user.username });
      if (user) {
        user.balance = parseFloat((user.balance + payout).toFixed(8));
        await user.save();
        socket.emit('crash:cashedout', { multiplier: crashGame.multiplier, payout, balance: user.balance });
        io.emit('crash:playerCashedOut', { username: socket.user.username, multiplier: crashGame.multiplier });
      }
    } catch (e) {}
    player.cashedOut = true;
    player.cashoutAt = crashGame.multiplier;
  });

  socket.on('chat:message', ({ message }) => {
    if (!message || message.length > 200) return;
    io.emit('chat:message', { username: socket.user.username, message: message.trim(), timestamp: new Date() });
  });

  socket.on('wallet:getBalance', async () => {
    try {
      const user = await User.findOne({ username: socket.user.username });
      socket.emit('wallet:balance', { balance: user?.balance ?? 0 });
    } catch (e) { socket.emit('wallet:balance', { balance: 0 }); }
  });
}

function initGames(io) {
  setTimeout(() => startCrashGame(io), 3000);
}

module.exports = { registerGameHandlers, initGames };
