const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true, sparse: true },
  password: String,
  balance: { type: Number, default: 0 },
  currency: { type: String, default: 'GHS' },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: String, default: null },
  referralCount: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 }
});

const transactionSchema = new mongoose.Schema({
  id: String,
  username: String,
  type: String,
  amount: Number,
  bet: Number,
  payout: Number,
  profit: Number,
  balanceAfter: Number,
  timestamp: Date,
  updatedAt: Date,
  // ✅ Status fields
  status: { type: String, default: 'success', enum: ['pending', 'under_review', 'success', 'rejected'] },
  reference: String,
  method: String,
  address: String,
  // game fields
  outcome: String,
  choice: String,
  multiplier: Number,
  roll: Number,
  rollOver: Number,
  result: String,
  color: String,
  crashAt: Number,
  cashedOutAt: Number,
  winningNumbers: [Number],
  matches: Number,
  winner: Number,
  horse: Number,
  drawnNumbers: [Number],
  handName: String,
});

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

module.exports = { User, Transaction };
