# TRADERS HUB

A small, deployable Deriv OAuth 2.0 web application starter.

It includes:

- Dark TRADERS HUB dashboard
- Live public tick stream
- Simple live chart
- Deriv OAuth 2.0 + PKCE
- Server-side OAuth code exchange
- Account list
- Authenticated Deriv Options WebSocket
- Balance subscription
- Live contract proposals
- Demo/real account selection
- Buy and sell controls
- Open-contract monitoring

## Important

This project is a real trading client. A real account can place real-money trades. Start with a demo account.

Do not put your Deriv OAuth access token, session secret, or other credentials in frontend JavaScript.

## 1. Install

Requires Node.js 18+.

```bash
npm install
```

## 2. Local environment

Copy `.env.example` to `.env`.

```text
DERIV_CLIENT_ID=YOUR_DERIV_OAUTH_APP_ID
DERIV_REDIRECT_URI=http://localhost:3000/callback
SESSION_SECRET=some-long-random-secret
PORT=3000
```

For local OAuth testing, the redirect URI must be registered in the Deriv developer dashboard and match exactly.

## 3. Start

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Public market data should work without a Deriv login. Login/trading requires the registered OAuth app.

## 4. Production deployment

The production OAuth redirect must be HTTPS.

After deploying this app, suppose the host gives you:

```text
https://traders-hub-example.onrender.com
```

Then set:

```text
DERIV_REDIRECT_URI=https://traders-hub-example.onrender.com/callback
```

Register that exact URL in your Deriv OAuth application.

Also set:

```text
DERIV_CLIENT_ID=YOUR_APP_ID
SESSION_SECRET=YOUR_LONG_RANDOM_SECRET
NODE_ENV=production
```

The URL must match the Deriv registered redirect exactly.

## 5. Render

This repository contains `render.yaml`.

Create a Git repository containing this project, connect it to Render, and deploy it as a Node web service.

After Render gives you the HTTPS URL:

1. Set `DERIV_CLIENT_ID`.
2. Set `DERIV_REDIRECT_URI` to `https://YOUR-RENDER-URL/callback`.
3. Deploy/redeploy.
4. Register the exact callback URL in the Deriv Developer Dashboard.
5. Open the app and press LOGIN WITH DERIV.

## 6. Deriv scopes

The application requests only:

```text
trade
```

It does not request account management or payment permissions.

## API flow

OAuth:

```text
Browser -> /auth/login
        -> Deriv OAuth
        -> /callback?code=...&state=...
        -> server exchanges code for token
        -> session
```

Trading:

```text
Server -> POST /trading/v1/options/accounts/{accountId}/otp
        -> returns short-lived WebSocket URL

Browser -> authenticated WebSocket
        -> balance
        -> proposal
        -> buy
        -> proposal_open_contract
        -> sell
```

Public market data uses:

```text
wss://api.derivws.com/trading/v1/options/ws/public
```

## Safety

The Buy button intentionally asks for confirmation on a real account. Use a demo account first.
