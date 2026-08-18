"use strict";

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

/* =========================================================
   CONFIG
   ========================================================= */

const PORT = Number(process.env.PORT || 3000);

const DERIV_CLIENT_ID =
  String(process.env.DERIV_CLIENT_ID || "").trim();

const DERIV_REDIRECT_URI =
  String(process.env.DERIV_REDIRECT_URI || "").trim();

const SESSION_SECRET =
  String(
    process.env.SESSION_SECRET ||
      "change-me-in-production"
  ).trim();

const DERIV_AUTH_URL =
  "https://auth.deriv.com/oauth2/auth";

const DERIV_TOKEN_URL =
  "https://auth.deriv.com/oauth2/token";

const DERIV_API_BASE =
  "https://api.derivws.com";

const DERIV_PUBLIC_WS =
  "wss://api.derivws.com/trading/v1/options/ws/public";


/* =========================================================
   STARTUP VALIDATION
   ========================================================= */

if (!DERIV_CLIENT_ID) {
  console.warn(
    "WARNING: DERIV_CLIENT_ID is not configured."
  );
}

if (!DERIV_REDIRECT_URI) {
  console.warn(
    "WARNING: DERIV_REDIRECT_URI is not configured."
  );
}

if (
  process.env.NODE_ENV === "production" &&
  SESSION_SECRET === "change-me-in-production"
) {
  console.warn(
    "WARNING: SESSION_SECRET is using the development default."
  );
}


/* =========================================================
   EXPRESS
   ========================================================= */

app.set("trust proxy", 1);

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "100kb"
  })
);

app.use(
  express.urlencoded({
    extended: false
  })
);


/* =========================================================
   SESSION
   ========================================================= */

app.use(
  session({
    name: "traders_hub_sid",

    secret: SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    rolling: true,

    cookie: {
      httpOnly: true,

      sameSite: "lax",

      secure:
        process.env.NODE_ENV === "production",

      maxAge:
        60 * 60 * 1000
    }
  })
);


/* =========================================================
   STATIC FILES
   ========================================================= */

const PUBLIC_DIR =
  path.join(
    __dirname,
    "public"
  );


/* =========================================================
   RESPONSE HELPERS
   ========================================================= */

function noCache(res) {

  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );

  res.set(
    "Pragma",
    "no-cache"
  );

  res.set(
    "Expires",
    "0"
  );

}


function jsonError(
  res,
  status,
  message,
  details = null
) {

  noCache(res);

  const payload = {
    error: message
  };

  if (details !== null) {
    payload.details = details;
  }

  return res
    .status(status)
    .json(payload);

}


/* =========================================================
   MAIN HTML
   ========================================================= */

function sendIndex(res) {

  const indexPath =
    path.join(
      PUBLIC_DIR,
      "index.html"
    );

  let html;

  try {

    html =
      fs.readFileSync(
        indexPath,
        "utf8"
      );

  } catch (error) {

    console.error(
      "Could not read index.html:",
      error
    );

    return res
      .status(500)
      .send(
        "TRADERS HUB: index.html could not be loaded."
      );

  }


  /*
   * Remove accidental CSS text between </head> and <body>.
   */

  html =
    html.replace(
      /\s*\.hidden\s*\{\s*display:\s*none\s*!important;\s*\}\s*(?=<body>)/i,
      "\n"
    );


  /*
   * Remove any old market compatibility script.
   */

  html =
    html.replace(
      /<script[^>]+src=["']\/market-fix\.js["'][^>]*><\/script>\s*/gi,
      ""
    );


  /*
   * Prevent browser caching of the application shell while
   * development/deployment is changing app.js.
   */

  noCache(res);

  return res
    .type("html")
    .send(html);

}


/* =========================================================
   APP ASSETS
   ========================================================= */

app.get(
  "/app.js",
  (_req, res) => {

    res.set(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    res.sendFile(
      path.join(
        __dirname,
        "app.js"
      )
    );

  }
);


app.get(
  "/style.css",
  (_req, res) => {

    res.set(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    res.sendFile(
      path.join(
        __dirname,
        "style.css"
      )
    );

  }
);


/* =========================================================
   MAIN ROUTE
   ========================================================= */

app.get(
  "/",
  (_req, res) => {

    sendIndex(res);

  }
);


app.use(
  express.static(
    PUBLIC_DIR,
    {
      etag: false,
      maxAge: 0
    }
  )
);


/* =========================================================
   SECURITY / OAUTH HELPERS
   ========================================================= */

function base64url(buffer) {

  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

}


function randomString(bytes = 32) {

  return base64url(
    crypto.randomBytes(bytes)
  );

}


function sha256Base64url(value) {

  return base64url(
    crypto
      .createHash("sha256")
      .update(value)
      .digest()
  );

}


/* =========================================================
   AUTH MIDDLEWARE
   ========================================================= */

function requireAuth(
  req,
  res,
  next
) {

  noCache(res);


  if (
    !req.session.accessToken
  ) {

    return jsonError(
      res,
      401,
      "Not authenticated"
    );

  }


  /*
   * Access tokens are short lived.
   */

  if (
    req.session.expiresAt &&
    Date.now() >=
      Number(req.session.expiresAt)
  ) {

    return jsonError(
      res,
      401,
      "Deriv session has expired. Please log in again."
    );

  }


  next();

}


/* =========================================================
   HEALTH
   ========================================================= */

app.get(
  "/health",
  (_req, res) => {

    res.json({
      ok: true,
      service: "TRADERS HUB",
      timestamp:
        new Date().toISOString()
    });

  }
);


/* =========================================================
   PUBLIC CONFIG
   ========================================================= */

app.get(
  "/api/config",
  (_req, res) => {

    noCache(res);

    res.json({

      configured:
        Boolean(
          DERIV_CLIENT_ID &&
          DERIV_REDIRECT_URI
        ),

      redirectUri:
        DERIV_REDIRECT_URI ||
        null,

      marketWebSocket:
        DERIV_PUBLIC_WS

    });

  }
);


/* =========================================================
   DERIV OAUTH LOGIN
   ========================================================= */

app.get(
  "/auth/login",
  (req, res) => {

    noCache(res);


    if (
      !DERIV_CLIENT_ID ||
      !DERIV_REDIRECT_URI
    ) {

      return res
        .status(500)
        .send(
          "TRADERS HUB OAuth is not configured. Set DERIV_CLIENT_ID and DERIV_REDIRECT_URI."
        );

    }


    /*
     * IMPORTANT:
     *
     * Generate completely fresh values on every login.
     *
     * Deriv authorization codes and PKCE transactions
     * must never be reused.
     */

    const state =
      randomString(32);

    const codeVerifier =
      randomString(48);

    const codeChallenge =
      sha256Base64url(
        codeVerifier
      );


    /*
     * Store a single OAuth transaction.
     *
     * oauthStartedAt lets us reject stale transactions.
     */

    req.session.oauth = {

      state,

      codeVerifier,

      startedAt:
        Date.now()

    };


    const params =
      new URLSearchParams({

        response_type:
          "code",

        client_id:
          DERIV_CLIENT_ID,

        redirect_uri:
          DERIV_REDIRECT_URI,

        /*
         * Trading + account access.
         *
         * trade is required for the trading/account
         * endpoints used by this application.
         */

        scope:
          "trade",

        state,

        code_challenge:
          codeChallenge,

        code_challenge_method:
          "S256"

      });


    req.session.save(
      (saveError) => {

        if (saveError) {

          console.error(
            "OAuth session save failed:",
            saveError
          );

          return res
            .status(500)
            .send(
              "Could not initialize secure login session."
            );

        }


        const authorizationUrl =
          `${DERIV_AUTH_URL}?${params.toString()}`;


        console.log(
          "Starting fresh Deriv OAuth transaction."
        );


        return res.redirect(
          authorizationUrl
        );

      }
    );

  }
);


/* =========================================================
   DERIV OAUTH CALLBACK
   ========================================================= */

async function handleOAuthCallback(
  req,
  res
) {

  noCache(res);


  const {
    code,
    state,
    error,
    error_description
  } = req.query;


  /*
   * If the browser replays a callback after a successful login,
   * don't attempt to exchange another authorization code.
   *
   * The code is single-use.
   */

  if (
    req.session.accessToken &&
    !code
  ) {

    return res.redirect(
      "/"
    );

  }


  if (error) {

    console.error(
      "Deriv OAuth returned an error:",
      {
        error,
        error_description
      }
    );


    /*
     * Clear any stale OAuth transaction so the next login
     * starts completely fresh.
     */

    delete req.session.oauth;


    return res
      .status(400)
      .send(
        `Deriv login was not completed: ${
          error_description ||
          error
        }`
      );

  }


  if (
    !code ||
    !state
  ) {

    return res
      .status(400)
      .send(
        "Missing OAuth authorization code or state. Please start login again."
      );

  }


  const oauth =
    req.session.oauth;


  if (
    !oauth ||
    !oauth.state ||
    !oauth.codeVerifier
  ) {

    return res
      .status(400)
      .send(
        "The OAuth transaction has expired or is missing. Please start login again."
      );

  }


  /*
   * Reject stale PKCE transactions.
   */

  const age =
    Date.now() -
    Number(
      oauth.startedAt || 0
    );


  if (
    !Number.isFinite(age) ||
    age > 10 * 60 * 1000
  ) {

    delete req.session.oauth;

    return res
      .status(400)
      .send(
        "The OAuth login attempt expired. Please start login again."
      );

  }


  /*
   * Validate CSRF state before exchanging the code.
   */

  if (
    state !== oauth.state
  ) {

    delete req.session.oauth;

    return res
      .status(400)
      .send(
        "OAuth state mismatch. Please start login again."
      );

  }


  /*
   * Consume the OAuth transaction BEFORE contacting the token
   * endpoint.
   *
   * This prevents accidental duplicate callback processing
   * from reusing the same verifier.
   */

  const codeVerifier =
    oauth.codeVerifier;

  delete req.session.oauth;


  try {

    const tokenResponse =
      await fetch(
        DERIV_TOKEN_URL,
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/x-www-form-urlencoded",

            "Accept":
              "application/json"

          },

          body:
            new URLSearchParams({

              grant_type:
                "authorization_code",

              client_id:
                DERIV_CLIENT_ID,

              code,

              code_verifier:
                codeVerifier,

              redirect_uri:
                DERIV_REDIRECT_URI

            })

        }
      );


    let tokenData = null;

    try {

      tokenData =
        await tokenResponse.json();

    } catch (_) {

      tokenData = null;

    }


    if (
      !tokenResponse.ok ||
      !tokenData ||
      !tokenData.access_token
    ) {

      console.error(
        "Deriv OAuth token exchange failed:",
        {
          status:
            tokenResponse.status,

          data:
            tokenData
        }
      );


      return res
        .status(502)
        .send(
          "Deriv rejected the OAuth token exchange. Start a fresh login instead of refreshing this callback page."
        );

    }


    /*
     * Store token only on the server.
     */

    req.session.accessToken =
      tokenData.access_token;


    req.session.expiresAt =
      Date.now() +
      (
        Number(
          tokenData.expires_in ||
            3600
        ) * 1000
      );


    if (
      tokenData.refresh_token
    ) {

      req.session.refreshToken =
        tokenData.refresh_token;

    }


    /*
     * Save before redirecting.
     */

    req.session.save(
      (saveError) => {

        if (saveError) {

          console.error(
            "Authenticated session save failed:",
            saveError
          );

          return res
            .status(500)
            .send(
              "Login succeeded but the secure session could not be saved."
            );

        }


        console.log(
          "Deriv OAuth login completed successfully."
        );


        return res.redirect(
          "/"
        );

      }
    );

  } catch (error) {

    console.error(
      "OAuth callback error:",
      error
    );


    return res
      .status(500)
      .send(
        "OAuth callback failed. Please start login again."
      );

  }

}


/*
 * Support BOTH possible callback paths.
 *
 * DERIV_REDIRECT_URI must still exactly match the URI registered
 * in the Deriv developer dashboard.
 */

app.get(
  "/callback",
  handleOAuthCallback
);

app.get(
  "/auth/callback",
  handleOAuthCallback
);


/* =========================================================
   LOGOUT
   ========================================================= */

app.post(
  "/auth/logout",
  (req, res) => {

    noCache(res);


    req.session.destroy(
      (error) => {

        if (error) {

          console.error(
            "Session destroy error:",
            error
          );

          return jsonError(
            res,
            500,
            "Could not log out."
          );

        }


        res.clearCookie(
          "traders_hub_sid",
          {
            httpOnly: true,
            sameSite: "lax",
            secure:
              process.env.NODE_ENV ===
              "production"
          }
        );


        return res.json({
          ok: true
        });

      }
    );

  }
);


/* =========================================================
   AUTH STATUS
   ========================================================= */

app.get(
  "/api/auth/status",
  (req, res) => {

    noCache(res);


    const authenticated =
      Boolean(
        req.session.accessToken
      );


    const expired =
      authenticated &&
      req.session.expiresAt &&
      Date.now() >=
        Number(
          req.session.expiresAt
        );


    if (expired) {

      /*
       * Don't expose an expired token as authenticated.
       */

      return res.json({

        authenticated:
          false,

        expired:
          true,

        expiresAt:
          req.session.expiresAt ||
          null

      });

    }


    res.json({

      authenticated,

      expired: false,

      expiresAt:
        req.session.expiresAt ||
        null

    });

  }
);


/* =========================================================
   DERIV API HELPER
   ========================================================= */

async function derivRequest(
  req,
  endpoint,
  options = {}
) {

  if (
    !req.session.accessToken
  ) {

    const error =
      new Error(
        "Not authenticated"
      );

    error.status =
      401;

    throw error;

  }


  const headers = {

    "Authorization":
      `Bearer ${req.session.accessToken}`,

    "Deriv-App-ID":
      DERIV_CLIENT_ID,

    "Accept":
      "application/json",

    ...(options.headers || {})

  };


  const response =
    await fetch(
      `${DERIV_API_BASE}${endpoint}`,
      {
        ...options,
        headers
      }
    );


  let data = null;

  try {

    data =
      await response.json();

  } catch (_) {

    data = null;

  }


  return {
    response,
    data
  };

}


/* =========================================================
   DERIV OPTIONS ACCOUNTS
   ========================================================= */

app.get(
  "/api/accounts",
  requireAuth,
  async (req, res) => {

    try {

      const {
        response,
        data
      } =
        await derivRequest(
          req,
          "/trading/v1/options/accounts",
          {
            method:
              "GET"
          }
        );


      if (
        response.status ===
          401 ||
        response.status ===
          403
      ) {

        return jsonError(
          res,
          response.status,
          "Deriv rejected the authenticated account request.",
          data
        );

      }


      if (
        !response.ok
      ) {

        return jsonError(
          res,
          response.status,
          "Could not load Deriv Options accounts.",
          data
        );

      }


      noCache(res);

      return res.json(
        data
      );

    } catch (error) {

      console.error(
        "Accounts request failed:",
        error
      );


      return jsonError(
        res,
        error.status || 502,
        error.message ||
          "Could not reach Deriv."
      );

    }

  }
);


/* =========================================================
   AUTHENTICATED WEBSOCKET OTP
   ========================================================= */

async function createTradingWebSocketUrl(
  req,
  res
) {

  const accountId =
    String(
      req.body?.accountId ||
        req.query?.accountId ||
        ""
    ).trim();


  if (
    !accountId
  ) {

    return jsonError(
      res,
      400,
      "accountId is required."
    );

  }


  /*
   * Basic account ID validation.
   *
   * Options accounts currently use IDs such as DOT90004580.
   */

  if (
    !/^[A-Za-z0-9_-]{3,128}$/.test(
      accountId
    )
  ) {

    return jsonError(
      res,
      400,
      "Invalid accountId format."
    );

  }


  try {

    const {
      response,
      data
    } =
      await derivRequest(
        req,
        `/trading/v1/options/accounts/${encodeURIComponent(
          accountId
        )}/otp`,
        {
          method:
            "POST"
        }
      );


    if (
      response.status ===
        401 ||
      response.status ===
        403
    ) {

      return jsonError(
        res,
        response.status,
        "Deriv rejected the trading session request. Your login may have expired or the token may not have the trade scope.",
        data
      );

    }


    if (
      !response.ok
    ) {

      return jsonError(
        res,
        response.status,
        "Deriv could not create the authenticated trading WebSocket session.",
        data
      );

    }


    const url =
      data?.data?.url ||
      data?.url ||
      null;


    if (
      !url
    ) {

      console.error(
        "Deriv OTP response did not contain a WebSocket URL:",
        data
      );


      return jsonError(
        res,
        502,
        "Deriv returned no authenticated WebSocket URL.",
        data
      );

    }


    /*
     * IMPORTANT:
     *
     * This URL contains a one-time OTP.
     * Do not log it.
     * Do not store it in the session.
     */

    noCache(res);


    return res.json({

      ok: true,

      url

    });

  } catch (error) {

    console.error(
      "Trading WebSocket OTP request failed:",
      error
    );


    return jsonError(
      res,
      error.status || 502,
      error.message ||
        "Could not create trading WebSocket session."
    );

  }

}


/*
 * Primary endpoint.
 */

app.post(
  "/api/ws-url",
  requireAuth,
  createTradingWebSocketUrl
);


/*
 * Compatibility endpoint.
 *
 * This prevents an older app.js from producing a 404 if it
 * happens to call /api/trading/ws-url.
 */

app.post(
  "/api/trading/ws-url",
  requireAuth,
  createTradingWebSocketUrl
);


/* =========================================================
   OPTIONAL GET COMPATIBILITY
   ========================================================= */

app.get(
  "/api/ws-url",
  requireAuth,
  createTradingWebSocketUrl
);


app.get(
  "/api/trading/ws-url",
  requireAuth,
  createTradingWebSocketUrl
);


/* =========================================================
   RESET DEMO ACCOUNT
   ========================================================= */

app.post(
  "/api/accounts/:accountId/reset-demo",
  requireAuth,
  async (req, res) => {

    const accountId =
      String(
        req.params.accountId ||
          ""
      ).trim();


    if (
      !accountId ||
      !/^[A-Za-z0-9_-]{3,128}$/.test(
        accountId
      )
    ) {

      return jsonError(
        res,
        400,
        "Invalid account ID."
      );

    }


    try {

      const {
        response,
        data
      } =
        await derivRequest(
          req,
          `/trading/v1/options/accounts/${encodeURIComponent(
            accountId
          )}/reset-demo-balance`,
          {
            method:
              "POST"
          }
        );


      if (
        !response.ok
      ) {

        return jsonError(
          res,
          response.status,
          "Could not reset demo balance.",
          data
        );

      }


      return res.json({
        ok: true,
        data:
          data || null
      });

    } catch (error) {

      console.error(
        "Demo balance reset failed:",
        error
      );


      return jsonError(
        res,
        error.status || 502,
        error.message ||
          "Could not reset demo balance."
      );

    }

  }
);


/* =========================================================
   DEBUG INFORMATION
   ========================================================= */

app.get(
  "/api/system/status",
  (req, res) => {

    noCache(res);


    res.json({

      ok: true,

      authenticated:
        Boolean(
          req.session.accessToken
        ),

      oauthConfigured:
        Boolean(
          DERIV_CLIENT_ID &&
          DERIV_REDIRECT_URI
        ),

      redirectUri:
        DERIV_REDIRECT_URI ||
        null,

      publicMarketWebSocket:
        DERIV_PUBLIC_WS,

      apiBase:
        DERIV_API_BASE

    });

  }
);


/* =========================================================
   SPA FALLBACK
   ========================================================= */

app.get(
  "*",
  (req, res, next) => {

    if (
      req.path.startsWith(
        "/api/"
      ) ||
      req.path.startsWith(
        "/auth/"
      ) ||
      req.path ===
        "/callback" ||
      req.path ===
        "/health" ||
      req.path ===
        "/app.js" ||
      req.path ===
        "/style.css"
    ) {

      return next();

    }


    if (
      req.accepts("html")
    ) {

      return sendIndex(
        res
      );

    }


    next();

  }
);


/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use(
  (
    error,
    req,
    res,
    _next
  ) => {

    console.error(
      "Unhandled server error:",
      error
    );


    if (
      res.headersSent
    ) {
      return;
    }


    if (
      req.path.startsWith(
        "/api/"
      )
    ) {

      return jsonError(
        res,
        500,
        "Internal server error."
      );

    }


    return res
      .status(500)
      .send(
        "TRADERS HUB internal server error."
      );

  }
);


/* =========================================================
   START
   ========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `TRADERS HUB running on port ${PORT}`
    );

    console.log(
      `OAuth redirect URI: ${
        DERIV_REDIRECT_URI ||
        "(NOT CONFIGURED)"
      }`
    );

    console.log(
      `Public market WebSocket: ${DERIV_PUBLIC_WS}`
    );

  }
);
