# 🎰 Casino Backend

Full backend for your casino platform with:

- ✅ User auth (register/login)
- ✅ Wallet & balance system
- ✅ All game endpoints (dice, crash, roulette, lucky spin)
- ✅ Payments (deposit/withdraw)
- ✅ Affiliates & bonuses
- ✅ Real-time WebSocket updates
- ✅ Admin panel to control all game outcomes

---

## 🚀 Setup

```bash
npm install
cp .env.example .env
# Edit .env with your secrets
npm run dev
```

---

## 📡 API Reference

### Auth
| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/auth/register` | `{ username, password }` |
| POST | `/api/auth/login` | `{ username, password }` |

All protected routes require: `Authorization: Bearer <token>`

---

### Wallet
| Method | Endpoint | Body |
|--------|----------|------|
| GET | `/api/wallet/balance` | — |
| POST | `/api/wallet/deposit` | `{ amount }` |
| POST | `/api/wallet/withdraw` | `{ amount }` |
| GET | `/api/wallet/transactions` | — |

---

### Games
| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/games/dice` | `{ bet, target (2-98), over (bool) }` |
| POST | `/api/games/crash/start` | `{ bet, autoCashout }` |
| POST | `/api/games/roulette` | `{ bet, betType: 'red'/'black'/'green'/0-36 }` |
| POST | `/api/games/luckyspin` | `{ bet }` |
| GET | `/api/games/history` | — |

---

### Affiliates & Bonuses
| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/affiliates/create` | — |
| GET | `/api/affiliates/mine` | — |
| POST | `/api/affiliates/use` | `{ code }` |
| POST | `/api/affiliates/bonus/claim` | `{ type: 'welcome'/'daily' }` |

---

### Leaderboard
| Method | Endpoint |
|--------|----------|
| GET | `/api/leaderboard` |

---

### Admin (requires `x-admin-key` header)
| Method | Endpoint | Body |
|--------|----------|------|
| GET | `/api/admin/stats` | — |
| GET | `/api/admin/users` | — |
| POST | `/api/admin/users/:username/adjust-balance` | `{ amount, reason }` |
| POST | `/api/admin/users/:username/ban` | — |
| GET | `/api/admin/overrides` | — |
| POST | `/api/admin/overrides` | `{ game, value }` |
| POST | `/api/admin/maintenance` | `{ enabled: true/false }` |

---

## ⚡ WebSocket Events (Socket.io)

Connect with: `{ auth: { token: '<jwt>' } }`

### Crash Game
| Emit | Listen | Description |
|------|--------|-------------|
| `crash:bet` `{ bet, autoCashout }` | `crash:betPlaced` | Place a bet |
| `crash:cashout` | `crash:cashedout` | Cash out manually |
| — | `crash:tick` `{ multiplier }` | Live multiplier updates |
| — | `crash:crashed` `{ crashAt }` | Round ended |

### Chat
| Emit | Listen |
|------|--------|
| `chat:message` `{ message }` | `chat:message` |

---

## 🗂️ Project Structure

```
foretell-backend/
├── server.js            # Entry point
├── routes/
│   ├── auth.js          # Register/Login
│   ├── wallet.js        # Balance/Deposit/Withdraw
│   ├── games.js         # Dice/Crash/Roulette/LuckySpin
│   ├── leaderboard.js   # Top players
│   ├── affiliates.js    # Referral codes & bonuses
│   └── admin.js         # Admin controls
├── middleware/
│   └── auth.js          # JWT verification
├── games/
│   └── socketHandler.js # Real-time crash game + chat
└── config/
    └── store.js         # In-memory data store
```
