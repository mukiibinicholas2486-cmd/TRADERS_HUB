require("dotenv").config();

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DERIV_CLIENT_ID = process.env.DERIV_CLIENT_ID || "";
const DERIV_REDIRECT_URI = process.env.DERIV_REDIRECT_URI || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";

app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: "traders_hub_sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomString(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

function sha256Base64url(value) {
  return base64url(crypto.createHash("sha256").update(value).digest());
}

function requireAuth(req, res, next) {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "TRADERS HUB" });
});

app.get("/api/config", (_req, res) => {
  res.json({
    configured: Boolean(DERIV_CLIENT_ID && DERIV_REDIRECT_URI),
    redirectUri: DERIV_REDIRECT_URI || null
  });
});

app.get("/auth/login", (req, res) => {
  if (!DERIV_CLIENT_ID || !DERIV_REDIRECT_URI) {
    return res.status(500).send(
      "TRADERS HUB is not configured yet. Set DERIV_CLIENT_ID and DERIV_REDIRECT_URI."
    );
  }

  const state = randomString(32);
  const codeVerifier = randomString(48);
  const codeChallenge = sha256Base64url(codeVerifier);

  req.session.oauthState = state;
  req.session.codeVerifier = codeVerifier;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: DERIV_CLIENT_ID,
    redirect_uri: DERIV_REDIRECT_URI,
    scope: "trade",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  res.redirect(`https://auth.deriv.com/oauth2/auth?${params.toString()}`);
});

app.get("/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(
      `Deriv login was not completed: ${error_description || error}`
    );
  }

  if (!code || !state) {
    return res.status(400).send("Missing OAuth code or state.");
  }

  if (!req.session.oauthState || state !== req.session.oauthState) {
    return res.status(400).send("OAuth state mismatch. Please start login again.");
  }

  const codeVerifier = req.session.codeVerifier;

  try {
    const tokenResponse = await fetch("https://auth.deriv.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: DERIV_CLIENT_ID,
        code,
        code_verifier: codeVerifier,
        redirect_uri: DERIV_REDIRECT_URI
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("OAuth token exchange failed:", tokenData);
      return res.status(502).send("Deriv did not return an access token. Check your App ID and Redirect URL.");
    }

    req.session.accessToken = tokenData.access_token;
    req.session.expiresAt = Date.now() + Number(tokenData.expires_in || 3600) * 1000;
    delete req.session.oauthState;
    delete req.session.codeVerifier;

    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth callback failed.");
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/auth/status", (req, res) => {
  res.json({
    authenticated: Boolean(req.session.accessToken),
    expiresAt: req.session.expiresAt || null
  });
});

app.get("/api/accounts", requireAuth, async (req, res) => {
  try {
    const response = await fetch(
      "https://api.derivws.com/trading/v1/options/accounts",
      {
        headers: {
          Authorization: `Bearer ${req.session.accessToken}`,
          "Deriv-App-ID": DERIV_CLIENT_ID
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Could not reach Deriv." });
  }
});

app.post("/api/ws-url", requireAuth, async (req, res) => {
  const accountId = String(req.body.accountId || "").trim();

  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  try {
    const response = await fetch(
      `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${req.session.accessToken}`,
          "Deriv-App-ID": DERIV_CLIENT_ID
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json({ url: data?.data?.url || null });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Could not create a WebSocket OTP." });
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/") || req.path === "/callback" || req.path === "/health") {
    return next();
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`TRADERS HUB running on http://localhost:${PORT}`);
});
