/* =========================================================
   TRADERS HUB - CLEAN APP.JS
   ========================================================= */

"use strict";

/* =========================================================
   HELPERS
   ========================================================= */

const $ = (id) => document.getElementById(id);

function log(message, data = null) {
  const box = $("log");

  const time = new Date().toLocaleTimeString();

  let text = `[${time}] ${message}`;

  if (data !== null) {
    try {
      text += "\n" + JSON.stringify(data, null, 2);
    } catch (_) {}
  }

  if (box) {
    box.textContent = text + "\n" + box.textContent;
  }

  console.log(message, data ?? "");
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

function percentage(value) {
  if (!Number.isFinite(Number(value))) {
    return "—";
  }

  return `${Number(value).toFixed(1)}%`;
}


/* =========================================================
   GLOBAL STATE
   ========================================================= */

const state = {
  symbol: "1HZ100V",

  marketWS: null,
  reconnectTimer: null,

  prices: [],
  digits: [],

  previous: null,

  account: null,
  accounts: [],

  proposal: null,
  contractId: null,

  bot: {
    threshold: 4,
    window: 100,
    minimumSamples: 30
  }
};


/* =========================================================
   DIGIT HELPERS
   ========================================================= */

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

  if (!digits.length) {
    return null;
  }

  return Number(digits[digits.length - 1]);
}


/* =========================================================
   MARKET UI
   ========================================================= */

function updatePriceUI(quote, epoch) {
  const priceEl = $("price");
  const lastTickEl = $("lastTick");
  const changeEl = $("priceChange");

  if (priceEl) {
    priceEl.textContent = quote;
  }

  if (lastTickEl && epoch) {
    lastTickEl.textContent =
      new Date(Number(epoch) * 1000).toLocaleTimeString();
  }

  if (state.previous !== null && changeEl) {
    const diff =
      Number(quote) - Number(state.previous);

    if (diff > 0) {
      changeEl.className = "change up";
      changeEl.textContent = "UP";
    } else if (diff < 0) {
      changeEl.className = "change down";
      changeEl.textContent = "DOWN";
    } else {
      changeEl.className = "change neutral";
      changeEl.textContent = "FLAT";
    }
  }

  state.previous = Number(quote);
}


function updateLastDigit(price) {
  const digit = lastDigitFromPrice(price);

  if (digit === null) {
    return;
  }

  state.digits.push(digit);

  if (state.digits.length > state.bot.window) {
    state.digits =
      state.digits.slice(-state.bot.window);
  }

  const lastDigitEl = $("lastDigit");

  if (lastDigitEl) {
    lastDigitEl.textContent = digit;
  }

  const botDigitEl = $("botDigit");

  if (botDigitEl) {
    botDigitEl.textContent = digit;
  }
}


function resetMarketData() {
  state.prices = [];
  state.digits = [];
  state.previous = null;

  const priceEl = $("price");
  const lastDigitEl = $("lastDigit");
  const changeEl = $("priceChange");

  if (priceEl) {
    priceEl.textContent = "—";
  }

  if (lastDigitEl) {
    lastDigitEl.textContent = "—";
  }

  if (changeEl) {
    changeEl.className = "change neutral";
    changeEl.textContent = "WAITING";
  }

  drawChart();
}


/* =========================================================
   CHART
   ========================================================= */

function drawChart() {
  const canvas = $("chart");

  if (!canvas) {
    return;
  }

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

  if (!ctx) {
    return;
  }

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

  /* Grid */

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


/* =========================================================
   BOT UI HELPERS
   ========================================================= */

function setBotText(id, text) {
  const el = $(id);

  if (el) {
    el.textContent = text;
  }
}


function setSignal(id, type, text) {
  const el = $(id);

  if (!el) {
    return;
  }

  el.className =
    `signal ${type}`;

  el.textContent = text;
}


/* =========================================================
   DIGIT PREDICTION ENGINE
   ========================================================= */

function calculateDigitStats() {
  const digits =
    state.digits.slice();

  const result = {
    match: null,
    even: null,
    over: null
  };

  if (
    digits.length <
    state.bot.minimumSamples
  ) {
    return result;
  }


  /* -------------------------------------------------------
     MATCHES
     ------------------------------------------------------- */

  const matchWindow =
    Math.min(60, digits.length - 1);

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
    const training =
      digits.slice(
        Math.max(0, i - matchWindow),
        i
      );

    if (!training.length) {
      continue;
    }

    const counts =
      Array(10).fill(0);

    training.forEach((digit) => {
      counts[digit]++;
    });

    let prediction = 0;

    for (let d = 1; d < 10; d++) {
      if (
        counts[d] >
        counts[prediction]
      ) {
        prediction = d;
      }
    }

    if (
      digits[i] === prediction
    ) {
      matchWins++;
    }

    matchSamples++;
  }


  const currentMatchTraining =
    digits.slice(-matchWindow);

  const currentCounts =
    Array(10).fill(0);

  currentMatchTraining.forEach((digit) => {
    currentCounts[digit]++;
  });

  let currentMatchDigit = 0;

  for (let d = 1; d < 10; d++) {
    if (
      currentCounts[d] >
      currentCounts[currentMatchDigit]
    ) {
      currentMatchDigit = d;
    }
  }

  result.match = {
    digit: currentMatchDigit,
    wins: matchWins,
    samples: matchSamples,
    accuracy:
      matchSamples
        ? (matchWins / matchSamples) * 100
        : 0
  };


  /* -------------------------------------------------------
     EVEN / ODD
     ------------------------------------------------------- */

  const parityWindow = 60;

  let evenWins = 0;
  let evenSamples = 0;

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
    const training =
      digits.slice(
        Math.max(0, i - parityWindow),
        i
      );

    let evens = 0;
    let odds = 0;

    training.forEach((digit) => {
      if (digit % 2 === 0) {
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


  const currentParity =
    digits.slice(-parityWindow);

  let currentEvens = 0;
  let currentOdds = 0;

  currentParity.forEach((digit) => {
    if (digit % 2 === 0) {
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


  /* -------------------------------------------------------
     OVER / UNDER
     ------------------------------------------------------- */

  const thresholdEl =
    $("botThreshold");

  const threshold =
    Number(
      thresholdEl?.value ??
      state.bot.threshold
    );

  state.bot.threshold =
    Number.isFinite(threshold)
      ? threshold
      : 4;

  const ouWindow = 60;

  let ouWins = 0;
  let ouSamples = 0;

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
    const training =
      digits.slice(
        Math.max(0, i - ouWindow),
        i
      );

    let over = 0;
    let under = 0;

    training.forEach((digit) => {
      if (
        digit > state.bot.threshold
      ) {
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
      digits[i] > state.bot.threshold
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
    .forEach((digit) => {
      if (
        digit > state.bot.threshold
      ) {
        currentOver++;
      } else {
        currentUnder++;
      }
    });


  result.over = {
    threshold: state.bot.threshold,

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


/* =========================================================
   UPDATE PREDICTION BOT
   ========================================================= */

function updatePredictionBot() {
  const stats =
    calculateDigitStats();


  if (
    !stats.match ||
    !stats.even ||
    !stats.over
  ) {
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


  /* -------------------------------------------------------
     MATCH
     ------------------------------------------------------- */

  setBotText(
    "matchAcc",
    percentage(
      stats.match.accuracy
    )
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
    stats.match.samples >=
      state.bot.minimumSamples;

  setSignal(
    "matchSignal",
    matchHigh
      ? "good"
      : "neutral",
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


  /* -------------------------------------------------------
     EVEN
     ------------------------------------------------------- */

  setBotText(
    "evenAcc",
    percentage(
      stats.even.accuracy
    )
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
    stats.even.samples >=
      state.bot.minimumSamples;

  setSignal(
    "evenSignal",
    evenHigh
      ? "good"
      : "neutral",
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


  /* -------------------------------------------------------
     OVER / UNDER
     ------------------------------------------------------- */

  setBotText(
    "ouAcc",
    percentage(
      stats.over.accuracy
    )
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
    stats.over.samples >=
      state.bot.minimumSamples;

  setSignal(
    "ouSignal",
    ouHigh
      ? "good"
      : "neutral",
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


  /* -------------------------------------------------------
     OVERALL FILTER
     ------------------------------------------------------- */

  const highCount =
    [
      matchHigh,
      evenHigh,
      ouHigh
    ].filter(Boolean).length;

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
}


/* =========================================================
   BOT REFRESH
   ========================================================= */

function refreshBot() {
  try {
    updatePredictionBot();
  } catch (error) {
    console.error(
      "Bot update error:",
      error
    );

    log(
      "Bot update error",
      error.message
    );
  }
}


/* =========================================================
   PROCESS ONE MARKET TICK
   ========================================================= */

function processMarketTick(quote, epoch, symbol) {
  const price =
    Number(quote);

  if (!Number.isFinite(price)) {
    return;
  }


  /* Current price */

  const priceEl = $("price");

  if (priceEl) {
    priceEl.textContent = price;
  }


  /* Symbol */

  const symbolEl = $("symbolCode");

  if (symbolEl) {
    symbolEl.textContent =
      symbol || state.symbol;
  }


  /* Last tick */

  const lastTickEl =
    $("lastTick");

  if (lastTickEl && epoch) {
    lastTickEl.textContent =
      new Date(
        Number(epoch) * 1000
      ).toLocaleTimeString();
  }


  /* Price history */

  state.prices.push(price);

  if (state.prices.length > 100) {
    state.prices.shift();
  }


  /* Price movement */

  updatePriceUI(
    price,
    epoch
  );


  /* Last digit */

  updateLastDigit(price);


  /* Bot price */

  const botPriceEl =
    $("botPrice");

  if (botPriceEl) {
    botPriceEl.textContent =
      price;
  }


  /* Chart */

  drawChart();


  /* Prediction */

  refreshBot();
}


/* =========================================================
   HISTORICAL TICKS
   ========================================================= */

function loadTickHistory(ws) {
  return new Promise((resolve) => {
    const requestId =
      Date.now();

    const originalHandler =
      ws.onmessage;

    const timeout =
      setTimeout(() => {
        ws.onmessage =
          originalHandler;

        log(
          "Historical tick request timed out."
        );

        resolve();
      }, 8000);


    ws.onmessage = (event) => {
      let data;

      try {
        data =
          JSON.parse(event.data);
      } catch (_) {
        return;
      }


      if (
        data.req_id !== requestId
      ) {
        return;
      }


      clearTimeout(timeout);

      ws.onmessage =
        originalHandler;


      if (
        data.error
      ) {
        log(
          "Historical tick error",
          data.error
        );

        resolve();

        return;
      }


      const history =
        data.history;

      if (
        history &&
        Array.isArray(history.prices)
      ) {
        history.prices.forEach(
          (price) => {
            const numericPrice =
              Number(price);

            if (
              Number.isFinite(
                numericPrice
              )
            ) {
              state.prices.push(
                numericPrice
              );

              updateLastDigit(
                numericPrice
              );
            }
          }
        );


        state.prices =
          state.prices.slice(-100);

        drawChart();

        refreshBot();

        log(
          `Loaded ${history.prices.length} historical ticks.`
        );
      }

      resolve();
    };


    ws.send(
      JSON.stringify({
        ticks_history:
          state.symbol,

        count: 100,

        end: "latest",

        style: "ticks",

        req_id: requestId
      })
    );
  });
}


/* =========================================================
   PUBLIC MARKET WEBSOCKET
   ========================================================= */

function connectPublicMarket() {

  /* Close old connection */

  if (state.marketWS) {
    try {
      state.marketWS.onopen = null;
      state.marketWS.onmessage = null;
      state.marketWS.onerror = null;
      state.marketWS.onclose = null;

      state.marketWS.close();
    } catch (_) {}

    state.marketWS = null;
  }


  /* Cancel reconnect timer */

  if (state.reconnectTimer) {
    clearTimeout(
      state.reconnectTimer
    );

    state.reconnectTimer = null;
  }


  resetMarketData();

  setStatus(
    false,
    "Connecting..."
  );

  const ws =
    new WebSocket(
      "wss://api.derivws.com/trading/v1/options/ws/public"
    );

  state.marketWS = ws;


  /* -------------------------------------------------------
     OPEN
     ------------------------------------------------------- */

  ws.onopen = async () => {

    if (state.marketWS !== ws) {
      return;
    }

    setStatus(
      true,
      "Market online"
    );

    log(
      "Market WebSocket connected."
    );


    try {
      /* Load recent history first */

      await loadTickHistory(ws);

    } catch (error) {
      console.error(
        "History error:",
        error
      );
    }


    /* Subscribe to live ticks */

    if (
      ws.readyState ===
      WebSocket.OPEN
    ) {
      ws.send(
        JSON.stringify({
          ticks: state.symbol,
          subscribe: 1
        })
      );

      log(
        "Subscribed to " +
        state.symbol
      );
    }
  };


  /* -------------------------------------------------------
     MESSAGE
     ------------------------------------------------------- */

  ws.onmessage = (event) => {

    let data;

    try {
      data =
        JSON.parse(event.data);
    } catch (error) {
      console.error(
        "Invalid WebSocket message:",
        error
      );

      return;
    }


    /* API error */

    if (data.error) {
      console.error(
        "Deriv WebSocket error:",
        data.error
      );

      log(
        "Deriv market error",
        data.error
      );

      return;
    }


    /* Tick */

    if (
      data.msg_type === "tick" &&
      data.tick
    ) {
      processMarketTick(
        data.tick.quote,
        data.tick.epoch,
        data.tick.symbol
      );
    }
  };


  /* -------------------------------------------------------
     ERROR
     ------------------------------------------------------- */

  ws.onerror = (error) => {

    console.error(
      "Market WebSocket error:",
      error
    );

    setStatus(
      false,
      "Market error"
    );

    log(
      "Market WebSocket error."
    );
  };


  /* -------------------------------------------------------
     CLOSE
     ------------------------------------------------------- */

  ws.onclose = () => {

    if (
      state.marketWS !== ws
    ) {
      return;
    }

    state.marketWS = null;

    setStatus(
      false,
      "Market offline"
    );

    log(
      "Market disconnected."
    );


    state.reconnectTimer =
      setTimeout(() => {

        if (
          !state.marketWS
        ) {
          connectPublicMarket();
        }

      }, 5000);
  };
}


/* =========================================================
   SYMBOL CONTROLS
   ========================================================= */

function changeSymbol(symbol) {

  if (!symbol) {
    return;
  }

  state.symbol =
    symbol;

  const marketSelect =
    $("symbolSelect");

  const botSymbol =
    $("botSymbol");

  if (
    marketSelect &&
    marketSelect.value !== symbol
  ) {
    marketSelect.value =
      symbol;
  }

  if (
    botSymbol &&
    botSymbol.value !== symbol
  ) {
    botSymbol.value =
      symbol;
  }

  log(
    "Changing market to " +
    symbol
  );

  connectPublicMarket();
}


/* Main market selector */

const symbolSelect =
  $("symbolSelect");

if (symbolSelect) {
  symbolSelect.addEventListener(
    "change",
    () => {
      changeSymbol(
        symbolSelect.value
      );
    }
  );
}


/* Bot market selector */

const botSymbol =
  $("botSymbol");

if (botSymbol) {
  botSymbol.addEventListener(
    "change",
    () => {
      changeSymbol(
        botSymbol.value
      );
    }
  );
}


/* =========================================================
   BOT CONTROLS
   ========================================================= */

const botThreshold =
  $("botThreshold");

if (botThreshold) {
  botThreshold.addEventListener(
    "change",
    () => {
      state.bot.threshold =
        Number(
          botThreshold.value
        ) || 4;

      refreshBot();
    }
  );
}


const botRefresh =
  $("botRefresh");

if (botRefresh) {
  botRefresh.addEventListener(
    "click",
    () => {
      refreshBot();

      log(
        "Prediction bot refreshed."
      );
    }
  );
}


/* =========================================================
   LOGIN / LOGOUT
   ========================================================= */

function setupAuthenticationButtons() {

  const loginBtn =
    $("loginBtn");

  const logoutBtn =
    $("logoutBtn");


  if (loginBtn) {
    loginBtn.onclick = () => {
      window.location.href =
        "/auth/login";
    };
  }


  if (logoutBtn) {
    logoutBtn.onclick =
      async () => {

        try {
          await fetch(
            "/auth/logout",
            {
              method: "POST",
              credentials:
                "same-origin"
            }
          );
        } catch (error) {
          console.error(
            "Logout error:",
            error
          );
        }

        window.location.reload();
      };
  }
}


/* =========================================================
   ACCOUNT DISPLAY
   ========================================================= */

function updateSelectedAccountUI() {

  const accountSelect =
    $("accountSelect");

  const balanceEl =
    $("balance");

  const currencyEl =
    $("currency");


  if (!accountSelect) {
    return;
  }


  const selected =
    accountSelect.options[
      accountSelect.selectedIndex
    ];


  if (!selected) {

    if (balanceEl) {
      balanceEl.textContent =
        "—";
    }

    if (currencyEl) {
      currencyEl.textContent =
        "—";
    }

    return;
  }


  if (balanceEl) {
    balanceEl.textContent =
      selected.dataset.balance ||
      "—";
  }


  if (currencyEl) {
    currencyEl.textContent =
      selected.dataset.currency ||
      "—";
  }


  state.account =
    state.accounts.find(
      (account) => {

        const id =
          account.account_id ||
          account.accountId ||
          account.loginid ||
          account.id;

        return String(id) ===
          String(selected.value);
      }
    ) || null;
}


/* =========================================================
   LOAD AUTHENTICATED ACCOUNT
   ========================================================= */

async function loadAuthenticatedAccount() {

  const loginBtn =
    $("loginBtn");

  const logoutBtn =
    $("logoutBtn");

  const accountBadge =
    $("accountBadge");

  const accountSelect =
    $("accountSelect");

  const balanceEl =
    $("balance");

  const currencyEl =
    $("currency");


  try {

    /* -----------------------------------------------------
       AUTH STATUS
       ----------------------------------------------------- */

    const statusResponse =
      await fetch(
        "/api/auth/status",
        {
          credentials:
            "same-origin"
        }
      );


    if (!statusResponse.ok) {
      throw new Error(
        "Could not check authentication status."
      );
    }


    const status =
      await statusResponse.json();


    log(
      "Authentication status",
      status
    );


    /* -----------------------------------------------------
       NOT AUTHENTICATED
       ----------------------------------------------------- */

    if (!status.authenticated) {

      if (accountBadge) {
        accountBadge.textContent =
          "NOT LOGGED IN";
      }

      if (loginBtn) {
        loginBtn.style.display =
          "";
      }

      if (logoutBtn) {
        logoutBtn.style.display =
          "none";
      }

      if (accountSelect) {
        accountSelect.innerHTML =
          '<option value="">Login to load accounts</option>';
      }

      if (balanceEl) {
        balanceEl.textContent =
          "—";
      }

      if (currencyEl) {
        currencyEl.textContent =
          "—";
      }

      return;
    }


    /* -----------------------------------------------------
       AUTHENTICATED
       ----------------------------------------------------- */

    if (accountBadge) {
      accountBadge.textContent =
        "LOGGED IN";
    }

    if (loginBtn) {
      loginBtn.style.display =
        "none";
    }

    if (logoutBtn) {
      logoutBtn.style.display =
        "";
    }


    /* -----------------------------------------------------
       LOAD ACCOUNTS
       ----------------------------------------------------- */

    const accountsResponse =
      await fetch(
        "/api/accounts",
        {
          credentials:
            "same-origin"
        }
      );


    if (!accountsResponse.ok) {
      throw new Error(
        "Could not load Deriv accounts."
      );
    }


    const payload =
      await accountsResponse.json();


    log(
      "Accounts response",
      payload
    );


    let accounts = [];


    if (
      Array.isArray(
        payload
      )
    ) {
      accounts =
        payload;
    } else if (
      Array.isArray(
        payload?.data
      )
    ) {
      accounts =
        payload.data;
    } else if (
      Array.isArray(
        payload?.data?.accounts
      )
    ) {
      accounts =
        payload.data.accounts;
    } else if (
      Array.isArray(
        payload?.accounts
      )
    ) {
      accounts =
        payload.accounts;
    }


    state.accounts =
      accounts;


    if (!accountSelect) {
      console.warn(
        "accountSelect was not found."
      );

      return;
    }


    accountSelect.innerHTML =
      "";


    if (!accounts.length) {

      accountSelect.innerHTML =
        '<option value="">No accounts found</option>';

      if (balanceEl) {
        balanceEl.textContent =
          "—";
      }

      if (currencyEl) {
        currencyEl.textContent =
          "—";
      }

      return;
    }


    /* -----------------------------------------------------
       CREATE ACCOUNT OPTIONS
       ----------------------------------------------------- */

    accounts.forEach(
      (account, index) => {

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


        const accountType =
          account.account_type ||
          account.type ||
          "";


        const option =
          document.createElement(
            "option"
          );


        option.value =
          accountId;


        option.textContent =
          account.loginid ||
          account.account_id ||
          account.accountId ||
          `Account ${index + 1}`;


        option.dataset.balance =
          balance;


        option.dataset.currency =
          currency;


        option.dataset.accountType =
          accountType;


        accountSelect.appendChild(
          option
        );
      }
    );


    accountSelect.selectedIndex =
      0;


    updateSelectedAccountUI();


    /* -----------------------------------------------------
       ACCOUNT CHANGE
       ----------------------------------------------------- */

    accountSelect.onchange =
      updateSelectedAccountUI;


    log(
      "Deriv accounts loaded",
      accounts
    );


  } catch (error) {

    console.error(
      "Authentication/account error:",
      error
    );

    log(
      "Authentication/account error",
      error.message
    );


    if (accountBadge) {
      accountBadge.textContent =
        "ACCOUNT ERROR";
    }
  }
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

function initializeApp() {

  log(
    "TRADERS HUB starting..."
  );


  setupAuthenticationButtons();


  loadAuthenticatedAccount();


  /* Start public market */

  setTimeout(
    () => {
      connectPublicMarket();
    },
    300
  );


  /* Resize chart */

  window.addEventListener(
    "resize",
    () => {
      drawChart();
    }
  );


  log(
    "TRADERS HUB initialized."
  );
}


/* =========================================================
   START
   ========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initializeApp
  );

} else {

  initializeApp();
    }
