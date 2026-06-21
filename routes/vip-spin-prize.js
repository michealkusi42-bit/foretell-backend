const express = require('express');
const router = express.Router();

// The wheel's prize pool. Exported so vip-spin.js uses the exact same list.
const PRIZES = [
  { type: 'credit', label: 'GHS 5 Bonus', value: 5, weight: 30 },
  { type: 'credit', label: 'GHS 10 Bonus', value: 10, weight: 20 },
  { type: 'credit', label: 'GHS 20 Bonus', value: 20, weight: 10 },
  { type: 'free_spins', label: '5 Free Spins', value: 5, weight: 20 },
  { type: 'free_spins', label: '10 Free Spins', value: 10, weight: 10 },
  { type: 'merch', label: 'Foretell T-Shirt', value: 1, weight: 8 },
  { type: 'credit', label: 'GHS 50 Jackpot', value: 50, weight: 2 },
];

// GET /api/vip-spin-prize/get-prize
router.get('/get-prize', (req, res) => {
  res.json({ prizes: PRIZES });
});

module.exports = { router, PRIZES };
