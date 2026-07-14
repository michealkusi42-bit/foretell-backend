const express = require('express');
const { randomUUID } = require('crypto');
const { Resend } = require('resend');
const { User, Transaction } = require('../config/store');

const router = express.Router();

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendWithdrawalEmail(username, amount, network, address, accountName) {
  try {
    await resend.emails.send({
      from: 'Foretell <onboarding@resend.dev>',
      to: 'michealkusi42@gmail.com',
      subject: '🚨 New Withdrawal Request - Foretell',
      html: `
        <h2>New Withdrawal Request</h2>
        <p><b>User:</b> ${username}</p>
        <p><b>Amount:</b> GHS ${amount}</p>
        <p><b>Network:</b> ${network}</p>
        <p><b>Account Name:</b> ${accountName || 'Not provided'}</p>
        <p><b>MoMo Number:</b> ${address}</p>
        <p><b>Time:</b> ${new Date().toLocaleString()}</p>
        <br/>
        <p>Login to your admin panel to approve or reject.</p>
        <a href="https://foretell-bet.vercel.app/admin">Open Admin Panel</a>
      `
    });
  } catch (err) {
    console.error('Email notification failed:', err.message);
  }
}

// ✅ NEW: Email notification for MoMo deposits
async function sendMoMoDepositEmail(username, amount, momoNetwork, momoNumber, momoName, reference) {
  try {
    await resend.emails.send({
      from: 'Foretell <onboarding@resend.dev>',
      to: 'michealkusi42@gmail.com',
      subject: '💰 New MoMo Deposit Request - Foretell',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 20px; border-radius: 10px 10px 0 0;">
            <h2 style="color: #00d4aa; margin: 0;">💰 New MoMo Deposit Request</h2>
          </div>
          <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; font-weight: bold;">User</td>
                <td style="padding: 10px; color: #333;">${username}</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; font-weight: bold;">Amount</td>
                <td style="padding: 10px; color: #00d4aa; font-weight: bold; font-size: 18px;">GHS ${amount}</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; font-weight: bold;">Network</td>
                <td style="padding: 10px; color: #333;">${momoNetwork}</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; font-weight: bold;">Sent To</td>
                <td style="padding: 10px; color: #333;">${momoNumber} (${momoName})</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; font-weight: bold;">Transaction ID</td>
                <td style="padding: 10px; color: #333; font-family: monospace;">${reference}</td>
              </tr>
              <tr>
                <td style="padding: 10px; color: #666; font-weight: bold;">Time</td>
                <td style="padding: 10px; color: #333;">${new Date().toLocaleString()}</td>
              </tr>
            </table>
            <br/>
            <div style="text-align: center;">
              <a href="https://foretell-bet.vercel.app/admin" 
                 style="background: #00d4aa; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
                ✅ Open Admin Panel to Approve
              </a>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
              Verify the transaction ID on your MoMo app before approving.
            </p>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('MoMo deposit email failed:', err.message);
  }
}

// Get balance
router.get('/balance', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get transactions
router.get('/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find({ username: req.user.username }).sort({ timestamp: -1 }).limit(50);
    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Save MoMo number
router.patch('/momo', async (req, res) => {
  try {
    const { momoNetwork, momoNumber, momoName } = req.body;
    if (!momoNetwork || !momoNumber) return res.status(400).json({ error: 'Network and number required' });
    if (!momoName || momoName.trim().length < 3) return res.status(400).json({ error: 'Account name required' });
    if (momoNumber.length < 10) return res.status(400).json({ error: 'Invalid MoMo number' });

    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.momoNetwork = momoNetwork;
    user.momoNumber = momoNumber;
    user.momoName = momoName;
    await user.save();

    res.json({ success: true, message: 'MoMo number saved successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get saved MoMo
router.get('/momo', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ 
      success: true, 
      momoNetwork: user.momoNetwork || '', 
      momoNumber: user.momoNumber || '', 
      momoName: user.momoName || '' 
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Request withdrawal
router.post('/withdraw', async (req, res) => {
  try {
    const { amount, method, address } = req.body;
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.suspended) return res.status(403).json({ error: 'Account suspended' });

    const withdrawAmount = parseFloat(amount);
    if (!withdrawAmount || withdrawAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (withdrawAmount < 10) return res.status(400).json({ error: 'Minimum withdrawal is GHS 10' });
    if (user.balance < withdrawAmount) return res.status(400).json({ error: 'Insufficient balance' });

    const withdrawAddress = address || user.momoNumber;
    const withdrawNetwork = user.momoNetwork || method || 'momo';
    const withdrawName = user.momoName || 'Not provided';

    if (!withdrawAddress) return res.status(400).json({ error: 'Please bind your MoMo number in profile settings first' });

    user.balance = parseFloat((user.balance - withdrawAmount).toFixed(2));
    await user.save();

    const tx = new Transaction({
      id: randomUUID(),
      username: req.user.username,
      type: 'withdraw',
      amount: withdrawAmount,
      method: withdrawNetwork,
      address: withdrawAddress,
      status: 'pending',
      timestamp: new Date()
    });
    await tx.save();

    await sendWithdrawalEmail(req.user.username, withdrawAmount, withdrawNetwork, withdrawAddress, withdrawName);

    res.json({ success: true, message: 'Withdrawal request submitted.', newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ UPDATED: Request deposit — now handles MoMo with email notification
router.post('/deposit', async (req, res) => {
  try {
    const { amount, method, reference, momoNumber, momoNetwork } = req.body;
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const depositAmount = parseFloat(amount);
    if (!depositAmount || depositAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (depositAmount < 1) return res.status(400).json({ error: 'Minimum deposit is GHS 1' });

    // ✅ For MoMo deposits, require a reference/transaction ID
    if (method === 'momo' && !reference) {
      return res.status(400).json({ error: 'Transaction ID is required for MoMo deposits' });
    }

    // Check for duplicate transaction ID (reference is the pasted SMS/trans ID, not the record's own id)
    if (reference) {
      const existing = await Transaction.findOne({ reference });
      if (existing) {
        return res.status(400).json({ error: 'This transaction ID has already been used' });
      }
    }

    const tx = new Transaction({
      id: randomUUID(),          // always a real, unique, URL-safe ID
      reference: reference || '', // the pasted MoMo SMS / transaction ID text, stored separately
      username: req.user.username,
      type: 'deposit',
      amount: depositAmount,
      method: method || 'momo',
      address: momoNumber || '',
      status: 'pending',
      timestamp: new Date()
    });
    await tx.save();

    // ✅ Send email to admin for MoMo deposits
    if (method === 'momo' && momoNumber) {
      // Find which agent name this number belongs to
      const agentMap = {
        '0507558973': 'Kotey Rudolph Glodean',
        '0507210550': 'Atoklo Christian',
        '0508631503': 'Tetteh Vida',
        '0560972009': 'Fatima Iddrisu',
        '0560190029': 'Fatima Iddrisu',
      };
      const agentName = agentMap[momoNumber] || 'Unknown';

      await sendMoMoDepositEmail(
        req.user.username,
        depositAmount,
        momoNetwork || 'MoMo',
        momoNumber,
        agentName,
        reference
      );
    }

    res.json({ success: true, message: 'Deposit request submitted. Admin will confirm shortly.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
