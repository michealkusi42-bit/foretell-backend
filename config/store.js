const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true, sparse: true },
  password: String,
  balance: { type: Number, default: 0 },
  currency: { type: String, default: 'GHS' },
  isAdmin: { type: Boolean, default: false },
  suspended: { type: Boolean, default: false },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: String, default: null },
  referralCount: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },
  qualifiedReferralCount: { type: Number, default: 0 },
  hasPlacedQualifyingBet: { type: Boolean, default: false },
  vipSpinsUsed: { type: Number, default: 0 },
  freeSpinsBalance: { type: Number, default: 0 },
  // ✅ Saved payment details
  momoNumber: { type: String, default: '' },
  momoProvider: { type: String, default: 'mtn' }, // mtn, vodafone, tigo
  cryptoAddress: { type: String, default: '' },
  cryptoNetwork: { type: String, default: '' },
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
  status: {
    type: String,
    default: 'success',
    enum: ['pending', 'under_review', 'success', 'approved', 'rejected']
  },
  processedAt: { type: Date, default: null },
  reference: String,
  method: String,
  address: String,
  provider: String,
  phone: String,
  network: String,
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
  paystackTransferCode: String,
});

const vipSpinWinSchema = new mongoose.Schema({
  id: String,
  username: String,
  prizeType: { type: String, enum: ['credit', 'free_spins', 'merch'] },
  prizeLabel: String,
  prizeValue: Number,
  collected: { type: Boolean, default: false },
  timestamp: Date
});

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const VipSpinWin = mongoose.model('VipSpinWin', vipSpinWinSchema);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

module.exports = { User, Transaction, VipSpinWin };
