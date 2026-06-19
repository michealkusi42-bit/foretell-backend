const { User } = require('../config/store');

const MIN_QUALIFYING_BET = 50; // GHS

// Call this every time a real bet is recorded.
// If the bettor was referred by someone, and this is their first bet
// of at least GHS 50, mark them as a "qualified" referral for their referrer.
async function checkAndQualifyReferral(username, betAmount) {
  try {
    if (!betAmount || betAmount < MIN_QUALIFYING_BET) return;

    const bettor = await User.findOne({ username });
    if (!bettor || !bettor.referredBy) return;
    if (bettor.hasPlacedQualifyingBet) return; // already counted once, don't double count

    bettor.hasPlacedQualifyingBet = true;
    await bettor.save();

    const referrer = await User.findOne({ username: bettor.referredBy });
    if (referrer) {
      referrer.qualifiedReferralCount = (referrer.qualifiedReferralCount || 0) + 1;
      await referrer.save();
    }
  } catch (err) {
    console.error('Referral qualification check failed:', err);
  }
}

module.exports = { checkAndQualifyReferral, MIN_QUALIFYING_BET };
