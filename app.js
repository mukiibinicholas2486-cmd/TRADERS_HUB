const $ = (id) => document.getElementById(id);

const state = {
  publicWs: null,
  authWs: null,

  symbol: "1HZ100V",

  prices: [],
  digits: [],

  previous: null,

  proposal: null,
  contractId: null,

  account: null,
  accounts: [],

  bot: {
    threshold: 4,
    window: 100,
    minimumSamples: 30
  }
};


function log(message, data) {
  const line =
    `[${new Date().toLocaleTimeString()}] ${message}`;

  const extra = data
    ? "\n" + JSON.stringify(data, null, 2)
    : "";

  const box = $("log");

  if (box) {
    box.textContent =
      `${line}${extra}\n${box.textContent}`;
  }
}


function setStatus(online, text) {

  const dot = $("connectionDot");
  const label = $("connectionText");

  if (dot) {
    dot.className =
      `status-dot ${online ? "online" : "offline"}`;
  }

  if (label) {
    label.textContent = text;
  }
}


function money(value, currency = "") {

  if (
    value === undefined ||
    value === null ||
    Number.isNaN(Number(value))
  ) {
    return "—";
  }

  return `${currency ? currency + " " : ""}${Number(value).toFixed(2)}`;
}


function lastDigitFromPrice(price) {

  if (
    price === undefined ||
    price === null ||
    !Number.isFinite(Number(price))
  ) {
    return null;
  }

  const text = String(price);

  const digits = text.replace(/\D/g, "");

  if (!digits.length) return null;

  return Number(digits[digits.length - 1]);
}


function drawChart() {

  const canvas = $("chart");

  if (!canvas) return;

  const rect =
    canvas.getBoundingClientRect();

  const dpr =
    window.devicePixelRatio || 1;

  const width =
    Math.max(1, rect.width);

  const height = 260;

  canvas.width =
    Math.floor(width * dpr);

  canvas.height =
    Math.floor(height * dpr);

  const ctx =
    canvas.getContext("2d");

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );

  ctx.clearRect(
    0,
    0,
    width,
    height
  );

  ctx.strokeStyle = "#202735";
  ctx.lineWidth = 1;

  for (let i = 1; i < 5; i++) {

    const y =
      (height / 5) * i;

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (state.prices.length < 2) {
    return;
  }

  const min =
    Math.min(...state.prices);

  const max =
    Math.max(...state.prices);

  const range =
    max - min || 1;

  ctx.strokeStyle = "#ff3d69";
  ctx.lineWidth = 2;

  ctx.beginPath();

  state.prices.forEach((price, index) => {

    const x =
      (index / (state.prices.length - 1)) *
      width;

    const y =
      height -
      ((price - min) / range) *
      (height - 24) -
      12;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

  });

  ctx.stroke();
}


function updateLastDigit(price) {

  const digit =
    lastDigitFromPrice(price);

  if (digit === null) return;

  state.digits.push(digit);

  state.digits =
    state.digits.slice(-state.bot.window);

  const element =
    $("lastDigit");

  if (element) {
    element.textContent = digit;
  }
}


function updatePriceUI(quote, epoch) {

  const price =
    $("price");

  const lastTick =
    $("lastTick");

  const change =
    $("priceChange");

  if (price) {
    price.textContent = quote;
  }

  if (lastTick && epoch) {

    lastTick.textContent =
      new Date(
        Number(epoch) * 1000
      ).toLocaleTimeString();

  }

  const previous =
    state.previous;

  if (previous !== null && change) {

    const diff =
      quote - previous;

    change.className =
      `change ${
        diff > 0
          ? "up"
          : diff < 0
          ? "down"
          : "neutral"
      }`;

    change.textContent =
      diff > 0
        ? "UP"
        : diff < 0
        ? "DOWN"
        : "FLAT";
  }

  state.previous = quote;
}


function resetMarketData() {

  state.prices = [];
  state.digits = [];
  state.previous = null;

  const price =
    $("price");

  const lastDigit =
    $("lastDigit");

  const change =
    $("priceChange");

  if (price) price.textContent = "—";

  if (lastDigit) lastDigit.textContent = "—";

  if (change) {
    change.className =
      "change neutral";

    change.textContent =
      "WAITING";
  }

  drawChart();
}function setBotText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}


function setSignal(id, type, text) {
  const el = $(id);

  if (!el) return;

  el.className = `signal ${type}`;
  el.textContent = text;
}


function percentage(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}


/*
  DIGIT PREDICTION ENGINE

  This uses recent tick history and a simple
  rolling out-of-sample test.

  It does NOT guarantee 80% accuracy.

  A signal is only labelled HIGH CONFIDENCE
  when the measured historical accuracy is
  >= 80% and there are enough samples.
*/


function calculateDigitStats() {

  const digits = state.digits.slice();

  const result = {
    match: null,
    even: null,
    over: null
  };

  if (digits.length < state.bot.minimumSamples) {
    return result;
  }


  /*
    MATCHES

    Predict the most frequently occurring digit
    in the recent training window.

    Then test that prediction against the
    following digit.
  */

  const matchWindow =
    Math.min(60, digits.length - 1);

  const matchTraining =
    digits.slice(-matchWindow - 1, -1);

  const counts =
    Array(10).fill(0);

  matchTraining.forEach(d => {
    counts[d]++;
  });

  let matchDigit = 0;

  for (let i = 1; i < 10; i++) {
    if (counts[i] > counts[matchDigit]) {
      matchDigit = i;
    }
  }

  let matchWins = 0;
  let matchSamples = 0;

  const matchStart =
    Math.max(
      1,
      digits.length - matchWindow
    );

  for (
    let i = matchStart;
    i < digits.length;
    i++
  ) {

    const train =
      digits.slice(
        Math.max(0, i - matchWindow),
        i
      );

    if (!train.length) continue;

    const localCounts =
      Array(10).fill(0);

    train.forEach(d => {
      localCounts[d]++;
    });

    let prediction = 0;

    for (let d = 1; d < 10; d++) {
      if (localCounts[d] > localCounts[prediction]) {
        prediction = d;
      }
    }

    if (digits[i] === prediction) {
      matchWins++;
    }

    matchSamples++;
  }

  result.match = {
    digit: matchDigit,
    wins: matchWins,
    samples: matchSamples,
    accuracy:
      matchSamples
        ? (matchWins / matchSamples) * 100
        : 0
  };


  /*
    EVEN

    Predict EVEN or ODD from the historical
    majority of the previous digits.
  */

  let evenWins = 0;
  let evenSamples = 0;

  const parityWindow = 60;

  const parityStart =
    Math.max(
      1,
      digits.length - parityWindow
    );

  for (
    let i = parityStart;
    i < digits.length;
    i++
  ) {

    const train =
      digits.slice(
        Math.max(0, i - parityWindow),
        i
      );

    if (!train.length) continue;

    let evens = 0;
    let odds = 0;

    train.forEach(d => {
      if (d % 2 === 0) {
        evens++;
      } else {
        odds++;
      }
    });

    const prediction =
      evens >= odds
        ? "EVEN"
        : "ODD";

    const actual =
      digits[i] % 2 === 0
        ? "EVEN"
        : "ODD";

    if (prediction === actual) {
      evenWins++;
    }

    evenSamples++;
  }

  const currentTraining =
    digits.slice(-parityWindow);

  let currentEvens = 0;
  let currentOdds = 0;

  currentTraining.forEach(d => {

    if (d % 2 === 0) {
      currentEvens++;
    } else {
      currentOdds++;
    }

  });

  result.even = {
    prediction:
      currentEvens >= currentOdds
        ? "EVEN"
        : "ODD",

    wins: evenWins,

    samples: evenSamples,

    accuracy:
      evenSamples
        ? (evenWins / evenSamples) * 100
        : 0
  };


  /*
    OVER / UNDER

    Uses the threshold selected by the user.
  */

  const threshold =
    Number(
      $("botThreshold")?.value ?? 4
    );

  let ouWins = 0;
  let ouSamples = 0;

  const ouWindow = 60;

  const ouStart =
    Math.max(
      1,
      digits.length - ouWindow
    );

  for (
    let i = ouStart;
    i < digits.length;
    i++
  ) {

    const train =
      digits.slice(
        Math.max(0, i - ouWindow),
        i
      );

    if (!train.length) continue;

    let over = 0;
    let under = 0;

    train.forEach(d => {

      if (d > threshold) {
        over++;
      } else {
        under++;
      }

    });

    const prediction =
      over >= under
        ? "OVER"
        : "UNDER";

    const actual =
      digits[i] > threshold
        ? "OVER"
        : "UNDER";

    if (prediction === actual) {
      ouWins++;
    }

    ouSamples++;
  }

  let currentOver = 0;
  let currentUnder = 0;

  digits
    .slice(-ouWindow)
    .forEach(d => {

      if (d > threshold) {
        currentOver++;
      } else {
        currentUnder++;
      }

    });

  result.over = {

    threshold,

    prediction:
      currentOver >= currentUnder
        ? "OVER"
        : "UNDER",

    wins: ouWins,

    samples: ouSamples,

    accuracy:
      ouSamples
        ? (ouWins / ouSamples) * 100
        : 0
  };


  return result;
}


function updatePredictionBot() {

  const stats =
    calculateDigitStats();

  if (!stats.match ||
      !stats.even ||
      !stats.over) {

    setBotText(
      "dataQuality",
      `Collecting ticks… ${state.digits.length}/${state.bot.minimumSamples}`
    );

    setBotText(
      "filterStatus",
      "WAITING FOR DATA"
    );

    setSignal(
      "matchSignal",
      "neutral",
      "WAITING"
    );

    setSignal(
      "evenSignal",
      "neutral",
      "WAITING"
    );

    setSignal(
      "ouSignal",
      "neutral",
      "WAITING"
    );

    setBotText(
      "matchConf",
      "Need more ticks"
    );

    setBotText(
      "evenConf",
      "Need more ticks"
    );

    setBotText(
      "ouConf",
      "Need more ticks"
    );

    return;
  }


  /*
    MATCH DISPLAY
  */

  setBotText(
    "matchAcc",
    percentage(stats.match.accuracy)
  );

  setBotText(
    "matchWins",
    stats.match.wins
  );

  setBotText(
    "matchSamples",
    stats.match.samples
  );


  const matchHigh =
    stats.match.accuracy >= 80 &&
    stats.match.samples >= state.bot.minimumSamples;

  setSignal(
    "matchSignal",
    matchHigh ? "good" : "neutral",
    matchHigh
      ? `MATCH ${stats.match.digit}`
      : `MATCH ${stats.match.digit} — LOW CONFIDENCE`
  );

  setBotText(
    "matchConf",
    matchHigh
      ? "HIGH CONFIDENCE"
      : "Below 80% historical accuracy"
  );


  /*
    EVEN DISPLAY
  */

  setBotText(
    "evenAcc",
    percentage(stats.even.accuracy)
  );

  setBotText(
    "evenWins",
    stats.even.wins
  );

  setBotText(
    "evenSamples",
    stats.even.samples
  );


  const evenHigh =
    stats.even.accuracy >= 80 &&
    stats.even.samples >= state.bot.minimumSamples;

  setSignal(
    "evenSignal",
    evenHigh ? "good" : "neutral",
    evenHigh
      ? stats.even.prediction
      : `${stats.even.prediction} — LOW CONFIDENCE`
  );

  setBotText(
    "evenConf",
    evenHigh
      ? "HIGH CONFIDENCE"
      : "Below 80% historical accuracy"
  );


  /*
    OVER / UNDER DISPLAY
  */

  setBotText(
    "ouAcc",
    percentage(stats.over.accuracy)
  );

  setBotText(
    "ouWins",
    stats.over.wins
  );

  setBotText(
    "ouSamples",
    stats.over.samples
  );


  const ouHigh =
    stats.over.accuracy >= 80 &&
    stats.over.samples >= state.bot.minimumSamples;

  setSignal(
    "ouSignal",
    ouHigh ? "good" : "neutral",
    ouHigh
      ? `${stats.over.prediction} ${stats.over.threshold}`
      : `${stats.over.prediction} ${stats.over.threshold} — LOW CONFIDENCE`
  );

  setBotText(
    "ouConf",
    ouHigh
      ? "HIGH CONFIDENCE"
      : "Below 80% historical accuracy"
  );


  /*
    OVERALL FILTER
  */

  const highCount =
    [matchHigh, evenHigh, ouHigh]
      .filter(Boolean)
      .length;

  setBotText(
    "filterStatus",
    highCount > 0
      ? `${highCount} HIGH-CONFIDENCE SIGNAL${highCount > 1 ? "S" : ""}`
      : "NO 80%+ SIGNAL"
  );

  setBotText(
    "dataQuality",
    `${state.digits.length} ticks analysed`
  );
}/* =========================================================
   BOT UPDATE + LIVE SIGNAL REFRESH
   ========================================================= */

function refreshBot() {
  if (!state.bot || !state.digits || state.digits.length < 20) {
    return;
  }

  try {
    updateBotPredictions();
  } catch (err) {
    console.error("Bot update error:", err);
    log("Bot update error: " + err.message);
  }
}

/* Run the prediction engine whenever a new tick arrives */
function addBotTick(price) {
  if (price === undefined || price === null) return;

  const text = String(price);
  const lastDigit = Number(text.slice(-1));

  if (!Number.isInteger(lastDigit)) return;

  state.digits.push(lastDigit);

  /* Keep the most recent 500 ticks */
  if (state.digits.length > 500) {
    state.digits.shift();
  }

  refreshBot();
}

/* =========================================================
   BOT CONTROLS
   ========================================================= */

const botRefreshBtn = $("botRefresh");

if (botRefreshBtn) {
  botRefreshBtn.onclick = () => {
    refreshBot();
    log("Prediction bot refreshed.");
  };
}

const botSymbol = $("botSymbol");

if (botSymbol) {
  botSymbol.onchange = (e) => {
    state.symbol = e.target.value;

    const marketSelect = $("symbolSelect");

    if (marketSelect) {
      marketSelect.value = state.symbol;
    }

    state.prices = [];
    state.digits = [];

    connectPublicMarket();

    log("Bot market changed to " + state.symbol);
  };
}

/* =========================================================
   CONNECT BOT TO LIVE MARKET TICKS
   ========================================================= */

function processBotMarketTick(quote) {
  if (quote === undefined || quote === null) return;

  addBotTick(quote);

  const botPrice = $("botPrice");

  if (botPrice) {
    botPrice.textContent = quote;
  }

  const lastDigit = Number(String(quote).slice(-1));

  const botDigit = $("botDigit");

  if (botDigit && Number.isInteger(lastDigit)) {
    botDigit.textContent = lastDigit;
  }
}

/* =========================================================
   INITIAL BOT STATE
   ========================================================= */

if (!Array.isArray(state.digits)) {
  state.digits = [];
}

if (!state.bot) {
  state.bot = {
    minimumSamples: 50,
    threshold: 0.80,
    enabled: true
  };
}

log("Prediction bot initialized.");/* =========================================================
   LOGIN / LOGOUT
   ========================================================= */

const loginBtn = $("loginBtn");
const logoutBtn = $("logoutBtn");

if (loginBtn) {
  loginBtn.onclick = () => {
    window.location.href = "/auth/login";
  };
}

if (logoutBtn) {
  logoutBtn.onclick = async () => {
    await fetch("/auth/logout", {
      method: "POST"
    });
    window.location.reload();
  };
}
/* ============================================================
   AUTH + ACCOUNT UI
   ============================================================ */

async function loadAuthenticatedAccount() {
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const accountBadge = document.getElementById("accountBadge");
  const accountSelect = document.getElementById("accountSelect");
  const balanceEl = document.getElementById("balance");
  const currencyEl = document.getElementById("currency");

  try {
    // Check whether the server session is authenticated.
    const statusResponse = await fetch("/api/auth/status", {
      credentials: "same-origin"
    });

    if (!statusResponse.ok) {
      throw new Error("Could not check authentication status.");
    }

    const status = await statusResponse.json();

    if (!status.authenticated) {
      if (accountBadge) {
        accountBadge.textContent = "NOT LOGGED IN";
      }

      if (loginBtn) {
        loginBtn.style.display = "";
      }

      if (logoutBtn) {
        logoutBtn.style.display = "none";
      }

      if (accountSelect) {
        accountSelect.innerHTML =
          '<option value="">Login to load accounts</option>';
      }

      if (balanceEl) balanceEl.textContent = "—";
      if (currencyEl) currencyEl.textContent = "—";

      return;
    }

    // The backend says we are authenticated.
    if (accountBadge) {
      accountBadge.textContent = "LOGGED IN";
    }

    if (loginBtn) {
      loginBtn.style.display = "none";
    }

    if (logoutBtn) {
      logoutBtn.style.display = "";
    }

    // Load Deriv accounts.
    const accountsResponse = await fetch("/api/accounts", {
      credentials: "same-origin"
    });

    if (!accountsResponse.ok) {
      throw new Error("Could not load Deriv accounts.");
    }

    const payload = await accountsResponse.json();

    // Be tolerant of the different response shapes Deriv may return.
    const accounts =
      payload?.data?.accounts ||
      payload?.accounts ||
      (Array.isArray(payload?.data) ? payload.data : []);

    if (!accountSelect) {
      console.warn("accountSelect was not found.");
      return;
    }

    accountSelect.innerHTML = "";

    if (!Array.isArray(accounts) || accounts.length === 0) {
      accountSelect.innerHTML =
        '<option value="">No accounts returned</option>';

      if (balanceEl) balanceEl.textContent = "—";
      if (currencyEl) currencyEl.textContent = "—";

      console.warn("No Deriv accounts returned:", payload);
      return;
    }

    accounts.forEach((account, index) => {
      const accountId =
        account.account_id ||
        account.accountId ||
        account.loginid ||
        account.login_id ||
        account.id ||
        "";

      const balance =
        account.balance ??
        account.amount ??
        account.available_balance ??
        "";

      const currency =
        account.currency ||
        account.currency_code ||
        "";

      const option = document.createElement("option");

      option.value = accountId;
      option.textContent =
        account.loginid ||
        account.account_id ||
        account.accountId ||
        `Account ${index + 1}`;

      option.dataset.balance = balance;
      option.dataset.currency = currency;

      accountSelect.appendChild(option);
    });

    // Display information for the first account.
    updateSelectedAccountUI();

    // Update balance/currency whenever the user changes accounts.
    accountSelect.addEventListener("change", updateSelectedAccountUI);

    function updateSelectedAccountUI() {
      const selected =
        accountSelect.options[accountSelect.selectedIndex];

      if (!selected) {
        if (balanceEl) balanceEl.textContent = "—";
        if (currencyEl) currencyEl.textContent = "—";
        return;
      }

      if (balanceEl) {
        balanceEl.textContent =
          selected.dataset.balance || "—";
      }

      if (currencyEl) {
        currencyEl.textContent =
          selected.dataset.currency || "—";
      }
    }

    console.log("TRADERS HUB authentication loaded.");
    console.log("Authenticated:", true);
    console.log("Deriv accounts:", accounts);

  } catch (error) {
    console.error("Authentication/account loading error:", error);

    if (accountBadge) {
      accountBadge.textContent = "ACCOUNT ERROR";
    }
  }
}

// Run after the page has loaded.
if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    loadAuthenticatedAccount
  );
} else {
  loadAuthenticatedAccount();
}
/* =========================================================
   PUBLIC MARKET WEBSOCKET
   ========================================================= */

let marketWS = null;
let marketReconnectTimer = null;

function connectPublicMarket() {

  // Close existing connection
  if (marketWS) {
    try {
      marketWS.onopen = null;
      marketWS.onmessage = null;
      marketWS.onerror = null;
      marketWS.onclose = null;
      marketWS.close();
    } catch (e) {
      console.warn("Could not close previous market WebSocket:", e);
    }

    marketWS = null;
  }

  // Cancel previous reconnect timer
  if (marketReconnectTimer) {
    clearTimeout(marketReconnectTimer);
    marketReconnectTimer = null;
  }

  setStatus(false, "Connecting...");

  const symbol = state.symbol || "1HZ100V";

const ws = new WebSocket(
  "wss://api.derivws.com/trading/v1/options/ws/public"
);  

  marketWS = ws;

  ws.onopen = () => {

    setStatus(true, "Market online");

    log("Market WebSocket connected.");

    // Subscribe to live ticks
    ws.send(
      JSON.stringify({
        ticks: symbol,
        subscribe: 1
      })
    );
/* =========================================================
   AUTH + ACCOUNT UI
   ========================================================= */

async function loadAuthAndAccounts() {
    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const accountBadge = document.getElementById("accountBadge");
    const accountSelect = document.getElementById("accountSelect");

    try {
        // Check whether the current browser session is authenticated
        const authResponse = await fetch("/api/auth/status", {
            credentials: "same-origin"
        });

        const auth = await authResponse.json();

        console.log("AUTH STATUS:", auth);

        if (!auth.authenticated) {
            if (accountBadge) {
                accountBadge.textContent = "NOT LOGGED IN";
            }

            if (loginBtn) {
                loginBtn.style.display = "";
            }

            if (logoutBtn) {
                logoutBtn.style.display = "none";
            }

            if (accountSelect) {
                accountSelect.innerHTML =
                    '<option value="">Login to load accounts</option>';
            }

            return;
        }

        // User IS authenticated
        if (accountBadge) {
            accountBadge.textContent = "LOGGED IN";
        }

        if (loginBtn) {
            loginBtn.style.display = "none";
        }

        if (logoutBtn) {
            logoutBtn.style.display = "";
        }

        // Load accounts from backend
        const accountsResponse = await fetch("/api/accounts", {
            credentials: "same-origin"
        });

        const accountsResult = await accountsResponse.json();

        console.log("ACCOUNTS:", accountsResult);

        const accounts = Array.isArray(accountsResult)
            ? accountsResult
            : (accountsResult.data || []);

        if (!accountSelect) {
            console.error("accountSelect element was not found");
            return;
        }

        accountSelect.innerHTML = "";

        if (!accounts.length) {
            accountSelect.innerHTML =
                '<option value="">No accounts found</option>';
            return;
        }

        accounts.forEach(account => {
            const option = document.createElement("option");

            option.value = account.account_id;

            option.textContent =
                `${account.account_id} — ${account.currency || ""} — ${account.account_type || ""}`;

            option.dataset.balance = account.balance || "";
            option.dataset.currency = account.currency || "";

            accountSelect.appendChild(option);
        });

        // Show the first account immediately
        accountSelect.selectedIndex = 0;
        updateAccountDisplay(accountSelect);

    } catch (error) {
        console.error("AUTH/ACCOUNT UI ERROR:", error);

        if (accountBadge) {
            accountBadge.textContent = "AUTH ERROR";
        }
    }
}


function updateAccountDisplay(accountSelect) {
    const selected =
        accountSelect.options[accountSelect.selectedIndex];

    if (!selected) return;

    const balanceEl = document.getElementById("balance");
    const currencyEl = document.getElementById("currency");

    if (balanceEl) {
        balanceEl.textContent =
            selected.dataset.balance || "—";
    }

    if (currencyEl) {
        currencyEl.textContent =
            selected.dataset.currency || "—";
    }
}


// Update balance/currency when another account is selected
const accountSelectElement =
    document.getElementById("accountSelect");

if (accountSelectElement) {
    accountSelectElement.addEventListener("change", () => {
        updateAccountDisplay(accountSelectElement);
    });
}


// Run authentication check when the page is ready
if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        loadAuthAndAccounts
    );
} else {
    loadAuthAndAccounts();
}
    log("Subscribed to " + symbol);
  };

  ws.onmessage = (event) => {

    try {

      const data = JSON.parse(event.data);

      // Ignore messages that are not ticks
      if (!data.tick) {
        return;
      }

      const price = Number(data.tick.quote);
      const epoch = data.tick.epoch;

      if (!Number.isFinite(price)) {
        return;
      }

      /* CURRENT PRICE */

      const priceEl = $("price");

      if (priceEl) {
        priceEl.textContent = price;
      }


      /* LAST TICK */

      const lastTickEl = $("lastTick");

      if (lastTickEl) {

        lastTickEl.textContent =
          new Date(Number(epoch) * 1000)
            .toLocaleTimeString();
      }


      /* SYMBOL */

      const symbolEl = $("symbolCode");

      if (symbolEl) {
        symbolEl.textContent = state.symbol;
      }


      /* LAST DIGIT */

      updateLastDigit(price);


      /* PRICE HISTORY */

      state.prices.push(price);

      if (state.prices.length > 100) {
        state.prices.shift();
      }


      /* UPDATE PRICE CHANGE */

      updatePriceUI(price, epoch);


      /* DRAW CHART */

      drawChart();


      /* PREDICTION BOT */

      processBotMarketTick(price);

    } catch (err) {

      console.error(
        "Market message error:",
        err
      );

    }
  };


  ws.onerror = (error) => {

    console.error(
      "Market WebSocket error:",
      error
    );

    setStatus(false, "Market error");

    log("Market WebSocket error.");
  };


  ws.onclose = () => {

    // Only reconnect if this is still the active socket
    if (marketWS !== ws) {
      return;
    }

    marketWS = null;

    setStatus(false, "Market offline");

    log("Market disconnected. Reconnecting...");

    marketReconnectTimer = setTimeout(() => {
      connectPublicMarket();
    }, 5000);
  };
}


/* =========================================================
   BOT MARKET SYMBOL CHANGE
   ========================================================= */

const botSymbol = $("botSymbol");

if (botSymbol) {

  botSymbol.onchange = (e) => {

    state.symbol = e.target.value;

    const marketSelect = $("symbolSelect");

    if (marketSelect) {
      marketSelect.value = state.symbol;
    }

    // Clear old market history
    state.prices = [];
    state.digits = [];

    // Reconnect to the newly selected symbol
    connectPublicMarket();

    log(
      "Bot market changed to " +
      state.symbol
    );
  };
}


/* =========================================================
   CONNECT BOT TO LIVE MARKET TICKS
   ========================================================= */

function processBotMarketTick(quote) {

  if (
    quote === undefined ||
    quote === null
  ) {
    return;
  }

  addBotTick(quote);
}


/* =========================================================
   START MARKET
   ========================================================= */

setTimeout(() => {
  connectPublicMarket();
}, 1000);
