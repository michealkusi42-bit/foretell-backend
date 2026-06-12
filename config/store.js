const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true, sparse: true },
  password: String,
  balance: { type: Number, default: 0 },
  currency: { type: String, default: 'CRYPT' }
});

const transactionSchema = new mongoose.Schema({
  id: String,
  username: String,
  type: String,
  amount: Number,
  balanceAfter: Number,
  timestamp: Date
});

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

module.exports = { User, Transaction };
