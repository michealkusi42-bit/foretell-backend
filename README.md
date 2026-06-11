# 🎰 Casino Backend

Full backend for your casino platform with:
- ✅ User auth (register/login)
- ✅ Wallet & balance system
- ✅ All game endpoints (dice, crash, roulette, lucky spin)
- ✅ Payments (deposit/withdraw)
- ✅ Affiliates & bonuses
- ✅ Real-time WebSocket updates
- ✅ **Admin panel to control all game outcomes**

---

## 🚀 Deploy to Render.com (Free)

### Step 1 — Push to GitHub
1. Go to github.com and create a **new repository** called `casino-backend`
2. Upload all these files to it

### Step 2 — Deploy on Render
1. Go to **render.com** and sign up (free)
2. Click **New → Web Service**
3. Connect your GitHub and select `casino-backend`
4. Set these:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Add Environment Variables:
   - `JWT_SECRET` → any long random string
   - `ADMIN_SETUP_SECRET` → your secret password for admin setup
6. Click **Deploy** — you'll get a URL like `https://casino-backend-xxxx.onrender.com`

### Step 3 — Update Vercel
Go to your Vercel project → Settings → Environment Variables and update:
- `VITE_API_BASE_URL` → `https://your-render-url.onrender.com`
- `VITE_HOST_API` → `https://your-render-url.onrender.com`
- `VITE_SOCKET_URL` → `https://your-render-url.onrender.com`

### Step 4 — Create Your Admin Account
After deploying, open your browser and go to:
```
POST https://your-render-url.onrender.com/api/admin/setup
```
With body:
```json
{
  "secret": "your-ADMIN_SETUP_SECRET",
  "username": "admin",
  "email": "your@email.com",
  "password": "your-admin-password"
}
```
You can use a free tool like **Hoppscotch.io** to send this request.

---

## 🎮 Admin Controls (Control Game Outcomes)

### Force ALL games to WIN:
```
PUT /api/admin/controls
{ "game": "global", "control": "globalForce", "value": "win" }
```

### Force ALL games to LOSE:
```
PUT /api/admin/controls
{ "game": "global", "control": "globalForce", "value": "lose" }
```

### Set Crash game to crash at specific multiplier:
```
PUT /api/admin/controls
{ "game": "crash", "control": "forceMultiplier", "value": 1.5 }
```

### Set Dice to always win/lose:
```
PUT /api/admin/controls
{ "game": "dice", "control": "forceResult", "value": "win" }
```

### Reset to random (normal mode):
```
PUT /api/admin/controls
{ "game": "global", "control": "globalForce", "value": null }
```

---

## 📋 All API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login |
| GET | /api/player/profile | Get profile |
| GET | /api/player/balance | Get balance |
| POST | /api/payment/deposit | Deposit |
| POST | /api/payment/withdraw | Withdraw |
| POST | /api/casino/bet | Place bet |
| GET | /api/casino/history | Bet history |
| POST | /api/luckyspin/spin | Lucky spin |
| GET | /api/bonus/available | List bonuses |
| POST | /api/bonus/claim/:id | Claim bonus |
| GET | /api/affiliate/stats | Affiliate stats |
| GET | /api/admin/stats | Admin dashboard stats |
| GET | /api/admin/users | All users |
| PUT | /api/admin/controls | **Control outcomes** |
| PUT | /api/admin/users/:id/balance | Edit user balance |
| POST | /api/admin/notify | Send notification |
