// UPDOWN
router.post('/updown/play', async (req, res) => {
  try {
    const { betAmount, prediction } = req.body;
    if (!betAmount || betAmount <= 0 || !['up', 'down'].includes(prediction))
      return res.status(400).json({ error: 'Invalid bet or prediction' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['updown'];
    let outcome;
    if (override === 'win') outcome = prediction;
    else if (override === 'lose') outcome = prediction === 'up' ? 'down' : 'up';
    else if (override === 'up' || override === 'down') outcome = override;
    else outcome = Math.random() < 0.5 ? 'up' : 'down';
    const win = outcome === prediction;
    const payout = win ? parseFloat((betAmount * 1.9).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'updown', parseFloat(betAmount), payout, user.balance, { outcome, prediction });
    res.json({ success: true, data: { outcome, win, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// CRASH
router.post('/crash/play', async (req, res) => {
  try {
    const { betAmount, autoCashout } = req.body;
    if (!betAmount || betAmount <= 0) return res.status(400).json({ error: 'Invalid bet' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['crash'];
    const crashAt = override !== null && override !== undefined
      ? parseFloat(override)
      : parseFloat(Math.max(1, (0.99 / Math.random())).toFixed(2));
    const cashedOutAt = autoCashout && autoCashout <= crashAt ? parseFloat(autoCashout) : null;
    const win = cashedOutAt !== null;
    const payout = win ? parseFloat((betAmount * cashedOutAt).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'crash', parseFloat(betAmount), payout, user.balance, { crashAt, cashedOutAt });
    res.json({ success: true, data: { crashAt, cashedOutAt, win, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// LOTTERY
router.post('/lottery/play', async (req, res) => {
  try {
    const { betAmount, numbers } = req.body;
    if (!betAmount || betAmount <= 0 || !Array.isArray(numbers) || numbers.length !== 5)
      return res.status(400).json({ error: 'Pick exactly 5 numbers' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['lottery'];
    let winningNumbers;
    if (Array.isArray(override)) {
      winningNumbers = override;
    } else {
      winningNumbers = [];
      while (winningNumbers.length < 5) {
        const n = Math.floor(Math.random() * 50) + 1;
        if (!winningNumbers.includes(n)) winningNumbers.push(n);
      }
    }
    const matches = numbers.filter(n => winningNumbers.includes(n)).length;
    const multipliers = { 0: 0, 1: 0, 2: 0, 3: 2, 4: 10, 5: 100 };
    const payout = parseFloat((betAmount * multipliers[matches]).toFixed(8));
    if (payout > 0) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'lottery', parseFloat(betAmount), payout, user.balance, { winningNumbers, matches });
    res.json({ success: true, data: { winningNumbers, matches, win: payout > 0, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// RACING
router.post('/racing/play', async (req, res) => {
  try {
    const { betAmount, horse } = req.body;
    if (!betAmount || betAmount <= 0 || !horse || horse < 1 || horse > 8)
      return res.status(400).json({ error: 'Pick a horse 1-8' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['racing'];
    let winner;
    if (override === 'win') winner = parseInt(horse);
    else if (override === 'lose') winner = parseInt(horse) === 1 ? 2 : 1;
    else if (override !== null && override !== undefined) winner = parseInt(override);
    else winner = Math.floor(Math.random() * 8) + 1;
    const win = parseInt(horse) === winner;
    const payout = win ? parseFloat((betAmount * 7.5).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'racing', parseFloat(betAmount), payout, user.balance, { winner, horse });
    res.json({ success: true, data: { winner, win, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// BINGO
router.post('/bingo/play', async (req, res) => {
  try {
    const { betAmount, card } = req.body;
    if (!betAmount || betAmount <= 0 || !Array.isArray(card))
      return res.status(400).json({ error: 'Invalid bet or card' });
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await deductBet(user, parseFloat(betAmount));
    const override = gameOverrides['bingo'];
    let drawnNumbers;
    if (Array.isArray(override)) {
      drawnNumbers = override;
    } else {
      drawnNumbers = [];
      while (drawnNumbers.length < 15) {
        const n = Math.floor(Math.random() * 75) + 1;
        if (!drawnNumbers.includes(n)) drawnNumbers.push(n);
      }
    }
    const matches = card.filter(n => drawnNumbers.includes(n)).length;
    const win = matches >= 5;
    const payout = win ? parseFloat((betAmount * 3).toFixed(8)) : 0;
    if (win) applyWin(user, payout);
    await user.save();
    await recordTx(req.user.username, 'bingo', parseFloat(betAmount), payout, user.balance, { drawnNumbers, matches });
    res.json({ success: true, data: { drawnNumbers, matches, win, payout, newBalance: user.balance } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});
