/* =========================================================
   TRADERS HUB — APP.JS v2
   Deriv Options Terminal + Digit Analyzer

   Main fixes:
   - Correct new Deriv Options public WebSocket requests
   - Historical ticks now load correctly (no subscribe: 0)
   - Dynamic symbol/pip metadata
   - Accurate last-digit extraction using pip_size
   - Reliable market reconnect + stale-socket protection
   - Real rolling backtests with minimum sample gating
   - Authenticated account WebSocket for balance/proposal/buy/sell
   - Proposal validation and request timeouts
   - Account switching rebuilds the trading connection
   - Prediction controls drive the order panel
   ========================================================= */

"use strict";

/* =========================================================
   CONFIG
   ========================================================= */

const CONFIG = {
  publicWS: "wss://api.derivws.com/trading/v1/options/ws/public",

  api: {
    authStatus: "/api/auth/status",
    accounts: "/api/accounts",
    login: "/auth/login",
    logout: "/auth/logout",

    // The browser should NEVER receive the OAuth/PAT token.
    // Your backend should proxy the OTP request.
    otpRoutes: (accountId) => [
      `/api/accounts/${encodeURIComponent(accountId)}/otp`,
      `/api/deriv/options/accounts/${encodeURIComponent(accountId)}/otp`
    ]
  },

  market: {
    historyCount: 200,
    chartCount: 120,
    predictionWindow: 60,
    minimumSamples: 60,
    maxDigits: 300,
    reconnectMs: 2500
  },

  trading: {
    proposalTimeoutMs: 10000,
    buyTimeoutMs: 15000,
    stakeMin: 0.35,
    stakeStep: 1
  }
};

/* =========================================================
   HELPERS
   ========================================================= */

const $ = (id) => document.getElementById(id);

const first = (...ids) => {
  for (const id of ids) {
    const el = $(id);
    if (el) return el;
  }
  return null;
};

function log(message, data = null) {
  const box = $("log");
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  const extra = data !== null
    ? "\n" + safeJson(data)
    : "";

  if (box) {
    box.textContent = `${line}${extra}\n${box.textContent}`;
  }

  console.log(line, data ?? "");
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setTextAny(value, ...ids) {
  for (const id of ids) {
    const el = $(id);
    if (el) el.textContent = value;
  }
}

function percentage(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function reqId() {
  state.requestId += 1;
  return state.requestId;
}

function isOpen(ws) {
  return ws && ws.readyState === WebSocket.OPEN;
}

function normalizeAccountId(account) {
  return String(
    account?.account_id ??
    account?.accountId ??
    account?.loginid ??
    account?.login_id ??
    account?.id ??
    ""
  );
}

function normalizeAccountType(account) {
  const raw = String(
    account?.account_type ??
    account?.accountType ??
    account?.type ??
    ""
  ).toLowerCase();

  if (raw.includes("real")) return "real";
  if (raw.includes("demo")) return "demo";

  const id = normalizeAccountId(account);
  return id.startsWith("VRTC") || id.startsWith("DOT") ? "demo" : "real";
}

function normalizeCurrency(account) {
  return String(
    account?.currency ??
    account?.currency_code ??
    ""
  ).toUpperCase();
}

function normalizeBalance(account) {
  return (
    account?.balance ??
    account?.available_balance ??
    account?.amount ??
    ""
  );
}

function getSelectedOption(id) {
  const select = $(id);
  return select?.options?.[select.selectedIndex] ?? null;
}

/* =========================================================
   STATE
   ========================================================= */

const state = {
  symbol: "1HZ100V",

  symbols: new Map(),

  prices: [],
  epochs: [],
  digits: [],

  previousPrice: null,
  previousEpoch: null,

  publicWS: null,
  publicGeneration: 0,
  publicReconnectTimer: null,

  tradeWS: null,
  tradeGeneration: 0,
  tradeConnectPromise: null,
  tradeAccountId: null,

  requestId: 0,
  pendingRequests: new Map(),

  accounts: [],
  account: null,

  proposal: null,
  contractId: null,
  openContract: null,

  bot: {
    threshold: 4,
    window: CONFIG.market.predictionWindow,
    minimumSamples: CONFIG.market.minimumSamples
  },

  ui: {
    marketChanging: false,
    tradingBusy: false
  }
};

/* =========================================================
   DOM / STATUS
   ========================================================= */

function setStatus(online, text) {
  const dot = first("connectionDot", "marketDot");
  const label = first("connectionText", "marketStatus");

  if (dot) {
    dot.className = `status-dot ${online ? "online" : "offline"}`;
  }

  if (label) label.textContent = text;
}

function setTradeStatus(text, online = null) {
  const badge = first("accountBadge", "tradeStatus");
  if (badge) badge.textContent = text;

  if (online !== null) {
    const dot = $("tradeDot");
    if (dot) {
      dot.className = `status-dot ${online ? "online" : "offline"}`;
    }
  }
}

function setButtonBusy(button, busy, busyText = "WORKING...") {
  if (!button) return;

  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

    button.disabled = true;
    button.textContent = busyText;

  } else {

    button.disabled = false;

    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

/* =========================================================
   MARKET PRECISION / LAST DIGIT
   ========================================================= */

function decimalPlacesFromPip(pipSize) {
  const pip = Number(pipSize);

  if (!Number.isFinite(pip) || pip <= 0) {
    return null;
  }

  const text =
    pip.toFixed(12).replace(/0+$/, "");

  const dot =
    text.indexOf(".");

  if (dot === -1) {
    return 0;
  }

  return text.length - dot - 1;
}

function inferDecimalPlaces(value) {
  const text = String(value);

  if (!text.includes(".")) {
    return 0;
  }

  return text.split(".")[1].length;
}

function quoteToFixedString(
  quote,
  pipSize = null
) {
  const n = Number(quote);

  if (!Number.isFinite(n)) {
    return null;
  }

  let decimals =
    decimalPlacesFromPip(pipSize);

  if (decimals === null) {
    decimals =
      inferDecimalPlaces(quote);
  }

  return n.toFixed(decimals);
}

function lastDigitFromQuote(
  quote,
  pipSize = null
) {
  const fixed =
    quoteToFixedString(
      quote,
      pipSize
    );

  if (!fixed) {
    return null;
  }

  const digits =
    fixed.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  return Number(
    digits[digits.length - 1]
  );
}

function getSymbolMeta(
  symbol = state.symbol
) {
  return (
    state.symbols.get(symbol) ||
    {}
  );
}

/* =========================================================
   MARKET UI
   ========================================================= */

function updatePriceUI(
  quote,
  epoch,
  pipSize = null
) {
  const price =
    Number(quote);

  if (!Number.isFinite(price)) {
    return;
  }

  setText(
    "price",
    price
  );

  if (
    epoch !== undefined &&
    epoch !== null
  ) {

    const epochNum =
      Number(epoch);

    if (
      Number.isFinite(epochNum)
    ) {

      setText(
        "lastTick",
        new Date(
          epochNum * 1000
        ).toLocaleTimeString()
      );

      state.previousEpoch =
        epochNum;
    }
  }

  setTextAny(
    state.symbol,
    "symbolCode",
    "currentSymbol"
  );

  const change =
    first(
      "priceChange",
      "change"
    );

  if (
    change &&
    state.previousPrice !== null
  ) {

    const difference =
      price -
      state.previousPrice;

    if (difference > 0) {

      change.className =
        "change up";

      change.textContent =
        "UP";

    } else if (
      difference < 0
    ) {

      change.className =
        "change down";

      change.textContent =
        "DOWN";

    } else {

      change.className =
        "change neutral";

      change.textContent =
        "FLAT";
    }
  }

  state.previousPrice =
    price;

  const digit =
    lastDigitFromQuote(
      price,
      pipSize
    );

  if (
    digit !== null
  ) {

    setTextAny(
      digit,
      "lastDigit"
    );
  }
}

function resetMarketData() {

  state.prices = [];
  state.epochs = [];
  state.digits = [];

  state.previousPrice =
    null;

  state.previousEpoch =
    null;

  setText(
    "price",
    "—"
  );

  setText(
    "lastDigit",
    "—"
  );

  setText(
    "botDigit",
    "—"
  );

  setText(
    "dataQuality",
    "Collecting ticks…"
  );

  setText(
    "filterStatus",
    "WAITING FOR DATA"
  );

  const change =
    first(
      "priceChange",
      "change"
    );

  if (change) {

    change.className =
      "change neutral";

    change.textContent =
      "WAITING";
  }

  resetPredictionCards();

  drawChart();
}

/* =========================================================
   CHART
   ========================================================= */

function drawChart() {

  const canvas =
    $("chart");

  if (!canvas) {
    return;
  }

  const rect =
    canvas.getBoundingClientRect();

  const width =
    Math.max(
      1,
      rect.width ||
      canvas.clientWidth ||
      300
    );

  const height =
    260;

  const dpr =
    window.devicePixelRatio ||
    1;

  canvas.width =
    Math.floor(
      width * dpr
    );

  canvas.height =
    Math.floor(
      height * dpr
    );

  canvas.style.height =
    `${height}px`;

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

  ctx.strokeStyle =
    "#202735";

  ctx.lineWidth =
    1;

  for (
    let i = 1;
    i < 5;
    i++
  ) {

    const y =
      (height / 5) * i;

    ctx.beginPath();

    ctx.moveTo(
      0,
      y
    );

    ctx.lineTo(
      width,
      y
    );

    ctx.stroke();
  }

  const values =
    state.prices.slice(
      -CONFIG.market.chartCount
    );

  if (
    values.length < 2
  ) {
    return;
  }

  const min =
    Math.min(...values);

  const max =
    Math.max(...values);

  const range =
    max - min || 1;

  ctx.strokeStyle =
    "#ff3d69";

  ctx.lineWidth =
    2;

  ctx.beginPath();

  values.forEach(
    (price, index) => {

      const x =
        (
          index /
          (values.length - 1)
        ) * width;

      const y =
        height -
        (
          (price - min) /
          range
        ) *
        (height - 24) -
        12;

      if (
        index === 0
      ) {

        ctx.moveTo(
          x,
          y
        );

      } else {

        ctx.lineTo(
          x,
          y
        );
      }
    }
  );

  ctx.stroke();
}

/* =========================================================
   MARKET DATA PROCESSING
   ========================================================= */

function pushBounded(
  array,
  value,
  max
) {

  array.push(value);

  if (
    array.length > max
  ) {

    array.splice(
      0,
      array.length - max
    );
  }
}

function processMarketTick(
  tick
) {

  if (!tick) {
    return;
  }

  const quote =
    Number(tick.quote);

  const epoch =
    Number(tick.epoch);

  if (
    !Number.isFinite(quote)
  ) {
    return;
  }

  /*
    Ignore ticks from an old/stale symbol.
  */

  if (
    tick.symbol &&
    tick.symbol !==
      state.symbol
  ) {

    return;
  }

  const meta =
    getSymbolMeta(
      state.symbol
    );

  const pipSize =
    tick.pip_size ??
    meta.pip_size ??
    meta.pipSize ??
    null;

  updatePriceUI(
    quote,
    epoch,
    pipSize
  );

  pushBounded(
    state.prices,
    quote,
    CONFIG.market.chartCount
  );

  pushBounded(
    state.epochs,
    epoch,
    CONFIG.market.chartCount
  );

  const digit =
    lastDigitFromQuote(
      quote,
      pipSize
    );

  if (
    digit !== null
  ) {

    pushBounded(
      state.digits,
      digit,
      CONFIG.market.maxDigits
    );

    setText(
      "lastDigit",
      digit
    );

    setText(
      "botDigit",
      digit
    );
  }

  drawChart();

  updatePredictionBot();
}

function loadHistoricalData(
  data
) {

  const prices =
    Array.isArray(
      data?.history?.prices
    )
      ? data.history.prices
      : [];

  const times =
    Array.isArray(
      data?.history?.times
    )
      ? data.history.times
      : [];

  const meta =
    getSymbolMeta(
      state.symbol
    );

  const pipSize =
    meta.pip_size ??
    meta.pipSize ??
    null;

  const cleanPrices =
    prices
      .map(Number)
      .filter(
        Number.isFinite
      );

  state.prices =
    cleanPrices.slice(
      -CONFIG.market.chartCount
    );

  state.epochs =
    times
      .map(Number)
      .filter(
        Number.isFinite
      )
      .slice(
        -CONFIG.market.chartCount
      );

  state.digits =
    state.prices
      .map(
        price =>
          lastDigitFromQuote(
            price,
            pipSize
          )
      )
      .filter(
        digit =>
          digit !== null
      )
      .slice(
        -CONFIG.market.maxDigits
      );

  if (
    state.prices.length
  ) {

    const lastPrice =
      state.prices[
        state.prices.length - 1
      ];

    const lastEpoch =
      state.epochs[
        state.epochs.length - 1
      ];

    updatePriceUI(
      lastPrice,
      lastEpoch,
      pipSize
    );

    const lastDigit =
      lastDigitFromQuote(
        lastPrice,
        pipSize
      );

    if (
      lastDigit !== null
    ) {

      setText(
        "lastDigit",
        lastDigit
      );

      setText(
        "botDigit",
        lastDigit
      );
    }
  }

  setText(
    "dataQuality",
    `${state.digits.length} historical ticks loaded`
  );

  drawChart();

  updatePredictionBot();

  log(
    `Loaded ${state.digits.length} historical ticks for ${state.symbol}.`
  );
}

/* =========================================================
   PUBLIC MARKET WS
   ========================================================= */

function sendPublic(
  payload
) {

  if (
    !isOpen(
      state.publicWS
    )
  ) {

    return false;
  }

  state.publicWS.send(
    JSON.stringify({
      ...payload,

      req_id:
        payload.req_id ??
        reqId()
    })
  );

  return true;
}

function connectPublicMarket() {

  const generation =
    ++state.publicGeneration;

  if (
    state.publicReconnectTimer
  ) {

    clearTimeout(
      state.publicReconnectTimer
    );

    state.publicReconnectTimer =
      null;
  }

  if (
    state.publicWS
  ) {

    try {
      state.publicWS.close();
    } catch {}

    state.publicWS =
      null;
  }

  resetMarketData();

  setStatus(
    false,
    "Connecting…"
  );

  const symbol =
    state.symbol;

  log(
    `Connecting market feed for ${symbol}…`
  );

  let ws;

  try {

    ws =
      new WebSocket(
        CONFIG.publicWS
      );

  } catch (error) {

    log(
      "Unable to create market WebSocket.",
      error.message
    );

    schedulePublicReconnect(
      generation
    );

    return;
  }

  state.publicWS =
    ws;

  ws.onopen =
    () => {

      if (
        generation !==
        state.publicGeneration
      ) {

        return;
      }

      setStatus(
        true,
        "Market online"
      );

      log(
        `Market WebSocket connected for ${symbol}.`
      );

      /*
        IMPORTANT:
        Do NOT send subscribe: 0.

        Historical request.
      */

      sendPublic({
        ticks_history:
          symbol,

        count:
          CONFIG.market.historyCount,

        end:
          "latest",

        style:
          "ticks"
      });

      /*
        Live stream.
      */

      sendPublic({
        ticks:
          symbol,

        subscribe:
          1
      });

      /*
        Refresh symbol metadata / pip_size.
      */

      sendPublic({
        active_symbols:
          "brief"
      });

      log(
        `Subscribed to ${symbol}.`
      );
    };

  ws.onmessage =
    event => {

      if (
        generation !==
        state.publicGeneration
      ) {

        return;
      }

      let data;

      try {

        data =
          JSON.parse(
            event.data
          );

      } catch {

        log(
          "Market sent invalid JSON."
        );

        return;
      }

      if (
        data.error
      ) {

        log(
          "Deriv market error",
          data.error
        );

        return;
      }

      if (
        data.msg_type ===
        "active_symbols"
      ) {

        updateSymbolMetadata(
          data.active_symbols
        );

        return;
      }

      if (
        data.msg_type ===
        "history" &&
        data.history
      ) {

        loadHistoricalData(
          data
        );

        return;
      }

      if (
        data.msg_type ===
        "tick" &&
        data.tick
      ) {

        processMarketTick(
          data.tick
        );
      }
    };

  ws.onerror =
    () => {

      if (
        generation !==
        state.publicGeneration
      ) {

        return;
      }

      setStatus(
        false,
        "Market error"
      );

      log(
        "Market WebSocket error."
      );
    };

  ws.onclose =
    () => {

      if (
        generation !==
        state.publicGeneration
      ) {

        return;
      }

      state.publicWS =
        null;

      setStatus(
        false,
        "Market offline"
      );

      log(
        "Market WebSocket disconnected."
      );

      schedulePublicReconnect(
        generation
      );
    };
}

function schedulePublicReconnect(
  generation
) {

  if (
    state.publicReconnectTimer
  ) {

    return;
  }

  state.publicReconnectTimer =
    setTimeout(
      () => {

        state.publicReconnectTimer =
          null;

        if (
          generation ===
          state.publicGeneration
        ) {

          log(
            "Reconnecting market feed…"
          );

          connectPublicMarket();
        }

      },
      CONFIG.market.reconnectMs
    );
}

/* =========================================================
   SYMBOL METADATA
   ========================================================= */

function updateSymbolMetadata(
  list
) {

  if (
    !Array.isArray(list)
  ) {

    return;
  }

  for (
    const item of list
  ) {

    const symbol =
      item?.underlying_symbol ??
      item?.symbol;

    if (!symbol) {
      continue;
    }

    state.symbols.set(
      symbol,
      item
    );
  }

  const meta =
    getSymbolMeta(
      state.symbol
    );

  if (
    meta.underlying_symbol_name
  ) {

    setTextAny(
      meta.underlying_symbol_name,
      "marketName",
      "symbolName"
    );
  }

  /*
    Rebuild historical digits if metadata arrived after
    the history response.
  */

  if (
    state.prices.length
  ) {

    const pipSize =
      meta.pip_size ??
      meta.pipSize ??
      null;

    state.digits =
      state.prices
        .map(
          price =>
            lastDigitFromQuote(
              price,
              pipSize
            )
        )
        .filter(
          digit =>
            digit !== null
        )
        .slice(
          -CONFIG.market.maxDigits
        );

    updatePredictionBot();
  }

  log(
    `Symbol metadata updated (${state.symbols.size} markets).`
  );
}

/* =========================================================
   PREDICTION ENGINE
   ========================================================= */

function setBotText(
  id,
  text
) {

  const el =
    $(id);

  if (
    el
  ) {

    el.textContent =
      text;
  }
}

function setSignal(
  id,
  type,
  text
) {

  const el =
    $(id);

  if (!el) {
    return;
  }

  el.className =
    `signal ${type}`;

  el.textContent =
    text;
}

function resetPredictionCards() {

  setBotText(
    "dataQuality",
    "Collecting ticks…"
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
    "matchAcc",
    "—"
  );

  setBotText(
    "matchWins",
    "—"
  );

  setBotText(
    "matchSamples",
    "—"
  );

  setBotText(
    "evenAcc",
    "—"
  );

  setBotText(
    "evenWins",
    "—"
  );

  setBotText(
    "evenSamples",
    "—"
  );

  setBotText(
    "ouAcc",
    "—"
  );

  setBotText(
    "ouWins",
    "—"
  );

  setBotText(
    "ouSamples",
    "—"
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
}

function mostCommonDigit(
  digits
) {

  const counts =
    Array(10).fill(0);

  for (
    const digit of digits
  ) {

    if (
      Number.isInteger(digit) &&
      digit >= 0 &&
      digit <= 9
    ) {

      counts[digit]++;
    }
  }

  let best =
    0;

  for (
    let digit = 1;
    digit <= 9;
    digit++
  ) {

    if (
      counts[digit] >
      counts[best]
    ) {

      best =
        digit;
    }
  }

  return best;
}

function backtestDigitPrediction(
  digits,
  window
) {

  const winsByDigit =
    Array(10).fill(0);

  const samplesByDigit =
    Array(10).fill(0);

  let wins =
    0;

  let samples =
    0;

  /*
    Walk-forward test:
    each prediction only sees ticks before the
    target tick.
  */

  for (
    let i = window;
    i < digits.length;
    i++
  ) {

    const train =
      digits.slice(
        i - window,
        i
      );

    const prediction =
      mostCommonDigit(
        train
      );

    const actual =
      digits[i];

    samples++;

    if (
      prediction ===
      actual
    ) {

      wins++;

      winsByDigit[
        prediction
      ]++;
    }

    samplesByDigit[
      prediction
    ]++;
  }

  const current =
    mostCommonDigit(
      digits.slice(
        -window
      )
    );

  return {

    prediction:
      current,

    wins:
      wins,

    samples:
      samples,

    accuracy:
      samples
        ? (
            wins /
            samples
          ) * 100
        : 0,

    winsByDigit:
      winsByDigit,

    samplesByDigit:
      samplesByDigit
  };
}

function backtestBinaryPrediction(
  digits,
  window,
  classifier
) {

  let wins =
    0;

  let samples =
    0;

  for (
    let i = window;
    i < digits.length;
    i++
  ) {

    const train =
      digits.slice(
        i - window,
        i
      );

    const prediction =
      classifier(
        train
      );

    const actual =
      classifier(
        [digits[i]],
        true
      );

    samples++;

    if (
      prediction ===
      actual
    ) {

      wins++;
    }
  }

  const current =
    classifier(
      digits.slice(
        -window
      ),
      false
    );

  return {

    prediction:
      current,

    wins:
      wins,

    samples:
      samples,

    accuracy:
      samples
        ? (
            wins /
            samples
          ) * 100
        : 0
  };
}

function majorityEvenOdd(
  digits,
  actualOnly = false
) {

  if (
    actualOnly
  ) {

    const d =
      digits[0];

    return d % 2 === 0
      ? "EVEN"
      : "ODD";
  }

  let even =
    0;

  let odd =
    0;

  for (
    const digit of digits
  ) {

    if (
      digit % 2 === 0
    ) {

      even++;

    } else {

      odd++;
    }
  }

  return even >= odd
    ? "EVEN"
    : "ODD";
}

function makeOverUnderClassifier(
  threshold
) {

  return (
    digits,
    actualOnly = false
  ) => {

    if (
      actualOnly
    ) {

      return digits[0] >
        threshold
        ? "OVER"
        : "UNDER";
    }

    let over =
      0;

    let under =
      0;

    for (
      const digit of digits
    ) {

      if (
        digit >
        threshold
      ) {

        over++;

      } else {

        under++;
      }
    }

    return over >= under
      ? "OVER"
      : "UNDER";
  };
}

function calculateDigitStats() {

  const digits =
    state.digits.slice();

  const minimum =
    state.bot.minimumSamples;

  const window =
    Math.min(
      state.bot.window,
      Math.max(
        1,
        digits.length
      )
    );

  if (
    digits.length <
      minimum ||
    window < 2
  ) {

    return {

      ready:
        false,

      count:
        digits.length,

      match:
        null,

      even:
        null,

      over:
        null
    };
  }

  const thresholdRaw =
    Number(
      first(
        "botThreshold",
        "thresholdSelect"
      )?.value ??
      state.bot.threshold
    );

  state.bot.threshold =
    Number.isFinite(
      thresholdRaw
    )
      ? clamp(
          Math.round(
            thresholdRaw
          ),
          0,
          8
        )
      : 4;

  const match =
    backtestDigitPrediction(
      digits,
      window
    );

  const even =
    backtestBinaryPrediction(
      digits,
      window,
      majorityEvenOdd
    );

  const over =
    backtestBinaryPrediction(
      digits,
      window,
      makeOverUnderClassifier(
        state.bot.threshold
      )
    );

  return {

    ready:
      true,

    count:
      digits.length,

    match:
      match,

    even:
      even,

    over: {

      ...over,

      threshold:
        state.bot.threshold
    }
  };
}

function updatePredictionBot() {

  const stats =
    calculateDigitStats();

  if (
    !stats.ready
  ) {

    setText(
      "dataQuality",
      `Collecting ticks… ${stats.count}/${state.bot.minimumSamples}`
    );

    setText(
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

  const matchHigh =
    stats.match.accuracy >=
    80;

  const evenHigh =
    stats.even.accuracy >=
    80;

  const ouHigh =
    stats.over.accuracy >=
    80;

  setSignal(
    "matchSignal",
    matchHigh
      ? "good"
      : "neutral",
    matchHigh
      ? `MATCH ${stats.match.prediction}`
      : `MATCH ${stats.match.prediction} — LOW CONFIDENCE`
  );

  setSignal(
    "evenSignal",
    evenHigh
      ? "good"
      : "neutral",
    evenHigh
      ? stats.even.prediction
      : `${stats.even.prediction} — LOW CONFIDENCE`
  );

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
    "matchConf",
    matchHigh
      ? "HIGH CONFIDENCE"
      : "Below 80% historical accuracy"
  );

  setBotText(
    "evenConf",
    evenHigh
      ? "HIGH CONFIDENCE"
      : "Below 80% historical accuracy"
  );

  setBotText(
    "ouConf",
    ouHigh
      ? "HIGH CONFIDENCE"
      : "Below 80% historical accuracy"
  );

  const highCount =
    [
      matchHigh,
      evenHigh,
      ouHigh
    ].filter(
      Boolean
    ).length;

  setBotText(
    "filterStatus",
    highCount
      ? `${highCount} HIGH-CONFIDENCE SIGNAL${highCount > 1 ? "S" : ""}`
      : "NO 80%+ SIGNAL"
  );

  setBotText(
    "dataQuality",
    `${stats.count} ticks analysed`
  );

  /*
    Keep the order panel synchronized
    with the strongest current signal.
  */

  updateOrderFromPrediction(
    stats
  );
}

/* =========================================================
   PREDICTION -> ORDER PANEL
   ========================================================= */

function getContractType() {

  const select =
    first(
      "contractType",
      "contract",
      "contractSelect"
    );

  return String(
    select?.value ||
    "DIGITOVER"
  ).toUpperCase();
}

function setSelectValue(
  ids,
  value
) {

  for (
    const id of ids
  ) {

    const select =
      $(id);

    if (!select) {
      continue;
    }

    const option =
      [
        ...select.options
      ].find(
        o =>
          String(
            o.value
          ).toUpperCase() ===
          String(
            value
          ).toUpperCase()
      );

    if (option) {

      select.value =
        option.value;

      return true;
    }
  }

  return false;
}

function updateOrderFromPrediction(
  stats
) {

  if (
    !stats?.ready
  ) {

    return;
  }

  const contract =
    getContractType();

  if (
    contract ===
      "DIGITEVEN" ||
    contract ===
      "DIGITODD"
  ) {

    setSelectValue(
      [
        "contractType",
        "contract",
        "contractSelect"
      ],
      stats.even.prediction ===
        "EVEN"
        ? "DIGITEVEN"
        : "DIGITODD"
    );
  }

  if (
    contract ===
      "DIGITOVER" ||
    contract ===
      "DIGITUNDER"
  ) {

    setSelectValue(
      [
        "contractType",
        "contract",
        "contractSelect"
      ],
      stats.over.prediction ===
        "OVER"
        ? "DIGITOVER"
        : "DIGITUNDER"
    );
  }

  if (
    contract ===
    "DIGITMATCH"
  ) {

    setText(
      "barrier",
      stats.match.prediction
    );

    const input =
      first(
        "barrier",
        "botBarrier"
      );

    if (
      input &&
      "value" in input
    ) {

      input.value =
        stats.match.prediction;
    }
  }

  const currentContract =
    getContractType();

  if (
    currentContract ===
      "DIGITOVER" ||
    currentContract ===
      "DIGITUNDER"
  ) {

    const input =
      first(
        "barrier",
        "botBarrier",
        "barrierInput"
      );

    if (
      input &&
      "value" in input
    ) {

      input.value =
        stats.over.threshold;
    }
  }
}

/* =========================================================
   AUTH / ACCOUNTS
   ========================================================= */

async function apiJson(
  url,
  options = {}
) {

  const response =
    await fetch(
      url,
      {
        credentials:
          "same-origin",

        ...options,

        headers: {
          Accept:
            "application/json",

          ...(options.headers || {})
        }
      }
    );

  let payload =
    null;

  try {

    payload =
      await response.json();

  } catch {}

  if (
    !response.ok
  ) {

    const message =
      payload?.message ||
      payload?.error?.message ||
      payload?.errors?.[0]?.message ||
      `HTTP ${response.status}`;

    const error =
      new Error(
        message
      );

    error.status =
      response.status;

    error.payload =
      payload;

    throw error;
  }

  return payload;
}

function extractAccounts(
  payload
) {

  if (
    Array.isArray(payload)
  ) {

    return payload;
  }

  if (
    Array.isArray(
      payload?.data
    )
  ) {

    return payload.data;
  }

  if (
    Array.isArray(
      payload?.data?.accounts
    )
  ) {

    return payload.data.accounts;
  }

  if (
    Array.isArray(
      payload?.accounts
    )
  ) {

    return payload.accounts;
  }

  return [];
}

async function loadAuthAndAccounts() {

  try {

    const auth =
      await apiJson(
        CONFIG.api.authStatus
      );

    log(
      "Authentication status",
      auth
    );

    if (
      !auth?.authenticated
    ) {

      state.account =
        null;

      state.accounts =
        [];

      setTradeStatus(
        "NOT LOGGED IN",
        false
      );

      const loginBtn =
        $("loginBtn");

      const logoutBtn =
        $("logoutBtn");

      if (loginBtn) {
        loginBtn.style.display =
          "";
      }

      if (logoutBtn) {
        logoutBtn.style.display =
          "none";
      }

      const select =
        $("accountSelect");

      if (select) {

        select.innerHTML =
          '<option value="">Login to load accounts</option>';
      }

      setText(
        "balance",
        "—"
      );

      setText(
        "currency",
        "—"
      );

      return;
    }

    const loginBtn =
      $("loginBtn");

    const logoutBtn =
      $("logoutBtn");

    if (loginBtn) {
      loginBtn.style.display =
        "none";
    }

    if (logoutBtn) {
      logoutBtn.style.display =
        "";
    }

    setTradeStatus(
      "LOGGED IN",
      false
    );

    await loadAccounts();

  } catch (error) {

    setTradeStatus(
      "AUTH ERROR",
      false
    );

    log(
      `Authentication/account error: ${error.message}`
    );
  }
}

async function loadAccounts() {

  const select =
    $("accountSelect");

  if (!select) {

    log(
      "accountSelect not found."
    );

    return;
  }

  const payload =
    await apiJson(
      CONFIG.api.accounts
    );

  const accounts =
    extractAccounts(
      payload
    );

  state.accounts =
    accounts;

  select.innerHTML =
    "";

  if (
    !accounts.length
  ) {

    select.innerHTML =
      '<option value="">No accounts found</option>';

    setText(
      "balance",
      "—"
    );

    setText(
      "currency",
      "—"
    );

    log(
      "No Deriv accounts returned.",
      payload
    );

    return;
  }

  accounts.forEach(
    (
      account,
      index
    ) => {

      const id =
        normalizeAccountId(
          account
        );

      const balance =
        normalizeBalance(
          account
        );

      const currency =
        normalizeCurrency(
          account
        );

      const type =
        normalizeAccountType(
          account
        );

      const option =
        document.createElement(
          "option"
        );

      option.value =
        id;

      option.textContent =
        account.loginid ||
        account.account_id ||
        account.accountId ||
        id ||
        `Account ${index + 1}`;

      option.dataset.balance =
        balance;

      option.dataset.currency =
        currency;

      option.dataset.accountType =
        type;

      select.appendChild(
        option
      );
    }
  );

  select.selectedIndex =
    0;

  await updateSelectedAccount();

  log(
    `Loaded ${accounts.length} account(s).`
  );
}

async function updateSelectedAccount() {

  const select =
    $("accountSelect");

  if (!select) {
    return;
  }

  const selected =
    getSelectedOption(
      "accountSelect"
    );

  if (
    !selected ||
    !selected.value
  ) {

    state.account =
      null;

    setText(
      "balance",
      "—"
    );

    setText(
      "currency",
      "—"
    );

    await disconnectTradeWS();

    return;
  }

  const accountId =
    String(
      selected.value
    );

  state.account =
    state.accounts.find(
      account =>
        normalizeAccountId(
          account
        ) ===
        accountId
    ) || null;

  if (
    !state.account
  ) {

    log(
      `Account ${accountId} was not found in state.`
    );

    return;
  }

  setText(
    "balance",
    selected.dataset.balance ||
      normalizeBalance(
        state.account
      ) ||
      "—"
  );

  setText(
    "currency",
    selected.dataset.currency ||
      normalizeCurrency(
        state.account
      ) ||
      "—"
  );

  log(
    `Selected ${accountId} (${normalizeAccountType(state.account)}).`
  );

  await reconnectTradeWS();
}

/* =========================================================
   AUTH BUTTONS
   ========================================================= */

function setupAuthButtons() {

  const loginBtn =
    $("loginBtn");

  const logoutBtn =
    $("logoutBtn");

  if (
    loginBtn
  ) {

    loginBtn.onclick =
      () => {

        window.location.href =
          CONFIG.api.login;
      };
  }

  if (
    logoutBtn
  ) {

    logoutBtn.onclick =
      async () => {

        try {

          logoutBtn.disabled =
            true;

          await fetch(
            CONFIG.api.logout,
            {
              method:
                "POST",

              credentials:
                "same-origin"
            }
          );

        } catch (
          error
        ) {

          log(
            `Logout error: ${error.message}`
          );

        } finally {

          window.location.reload();
        }
      };
  }
}

/* =========================================================
   AUTHENTICATED TRADING WS
   ========================================================= */

function clearPendingRequests(
  reason =
    "Trading connection closed"
) {

  for (
    const [
      id,
      pending
    ]
    of state.pendingRequests.entries()
  ) {

    clearTimeout(
      pending.timer
    );

    pending.reject(
      new Error(
        reason
      )
    );
  }

  state.pendingRequests.clear();
}

function sendTrade(
  payload,
  options = {}
) {

  const ws =
    state.tradeWS;

  if (
    !isOpen(ws)
  ) {

    return Promise.reject(
      new Error(
        "Trading WebSocket is not connected."
      )
    );
  }

  const id =
    payload.req_id ??
    reqId();

  const timeoutMs =
    options.timeoutMs ??
    10000;

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const timer =
        setTimeout(
          () => {

            state.pendingRequests.delete(
              id
            );

            reject(
              new Error(
                `Request ${id} timed out.`
              )
            );

          },
          timeoutMs
        );

      state.pendingRequests.set(
        id,
        {
          resolve,
          reject,
          timer
        }
      );

      try {

        ws.send(
          JSON.stringify({
            ...payload,

            req_id:
              id
          })
        );

      } catch (
        error
      ) {

        clearTimeout(
          timer
        );

        state.pendingRequests.delete(
          id
        );

        reject(
          error
        );
      }
    }
  );
}

function resolvePending(
  data
) {

  const id =
    data?.req_id ??
    data?.echo_req?.req_id;

  if (
    id === undefined ||
    id === null
  ) {

    return false;
  }

  const pending =
    state.pendingRequests.get(
      Number(id)
    );

  if (!pending) {
    return false;
  }

  clearTimeout(
    pending.timer
  );

  state.pendingRequests.delete(
    Number(id)
  );

  if (
    data.error
  ) {

    const message =
      data.error.message ||
      data.error.code ||
      "Deriv request failed";

    const error =
      new Error(
        message
      );

    error.payload =
      data.error;

    pending.reject(
      error
    );

  } else {

    pending.resolve(
      data
    );
  }

  return true;
}

async function getTradeWSUrl(
  account
) {

  const accountId =
    normalizeAccountId(
      account
    );

  if (
    !accountId
  ) {

    throw new Error(
      "Selected account has no account ID."
    );
  }

  /*
    Preferred:
    backend returns the ready-to-use OTP
    WebSocket URL.
  */

  let lastError =
    null;

  for (
    const route of
      CONFIG.api.otpRoutes(
        accountId
      )
  ) {

    try {

      const payload =
        await apiJson(
          route,
          {
            method:
              "POST"
          }
        );

      const url =
        payload?.data?.url ||
        payload?.url ||
        payload?.data?.ws_url ||
        payload?.ws_url;

      if (
        url &&
        String(url).startsWith(
          "wss://"
        )
      ) {

        return url;
      }

      lastError =
        new Error(
          "OTP endpoint responded without a WebSocket URL."
        );

    } catch (
      error
    ) {

      lastError =
        error;

      /*
        Only try fallback route
        for a missing route.
      */

      if (
        error.status !==
        404
      ) {

        break;
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "Could not obtain trading WebSocket URL."
    )
  );
}

async function connectTradeWS() {

  const account =
    state.account;

  if (
    !account
  ) {

    throw new Error(
      "No account selected."
    );
  }

  const accountId =
    normalizeAccountId(
      account
    );

  const generation =
    ++state.tradeGeneration;

  if (
    state.tradeWS
  ) {

    try {
      state.tradeWS.close();
    } catch {}

    state.tradeWS =
      null;
  }

  clearPendingRequests();

  setTradeStatus(
    "CONNECTING…",
    false
  );

  log(
    `Requesting authenticated WebSocket for ${accountId}…`
  );

  const url =
    await getTradeWSUrl(
      account
    );

  if (
    generation !==
    state.tradeGeneration
  ) {

    throw new Error(
      "Trading connection superseded."
    );
  }

  const ws =
    new WebSocket(
      url
    );

  state.tradeWS =
    ws;

  state.tradeAccountId =
    accountId;

  await new Promise(
    (
      resolve,
      reject
    ) => {

      let settled =
        false;

      const fail =
        error => {

          if (
            settled
          ) {

            return;
          }

          settled =
            true;

          reject(
            error
          );
        };

      ws.onopen =
        () => {

          if (
            generation !==
            state.tradeGeneration
          ) {

            try {
              ws.close();
            } catch {}

            fail(
              new Error(
                "Trading connection superseded."
              )
            );

            return;
          }

          settled =
            true;

          setTradeStatus(
            "TRADE ONLINE",
            true
          );

          log(
            `Authenticated trading WebSocket connected: ${accountId}`
          );

          /*
            Current-account balance;
            subscribe for live updates.
          */

          sendTrade(
            {
              balance:
                1,

              subscribe:
                1
            },
            {
              timeoutMs:
                10000
            }
          )
            .then(
              data =>
                handleTradeMessage(
                  data
                )
            )
            .catch(
              error =>
                log(
                  `Balance request: ${error.message}`
                )
            );

          /*
            Current open position,
            if any.
          */

          sendTrade(
            {
              portfolio:
                1
            },
            {
              timeoutMs:
                10000
            }
          )
            .then(
              data =>
                handleTradeMessage(
                  data
                )
            )
            .catch(
              error =>
                log(
                  `Portfolio request: ${error.message}`
                )
            );

          resolve();
        };

      ws.onerror =
        () => {

          fail(
            new Error(
              "Authenticated trading WebSocket error."
            )
          );
        };

      ws.onclose =
        () => {

          if (
            generation !==
            state.tradeGeneration
          ) {

            return;
          }

          state.tradeWS =
            null;

          state.tradeAccountId =
            null;

          clearPendingRequests(
            "Trading WebSocket closed."
          );

          setTradeStatus(
            "TRADE OFFLINE",
            false
          );

          log(
            "Authenticated trading WebSocket disconnected."
          );
        };

      ws.onmessage =
        event => {

          if (
            generation !==
            state.tradeGeneration
          ) {

            return;
          }

          let data;

          try {

            data =
              JSON.parse(
                event.data
              );

          } catch {

            log(
              "Trading WebSocket sent invalid JSON."
            );

            return;
          }

          handleTradeMessage(
            data
          );
        };
    }
  );
}

function handleTradeMessage(
  data
) {

  if (!data) {
    return;
  }

  if (
    data.error
  ) {

    log(
      "Deriv trading error",
      data.error
    );

    resolvePending(
      data
    );

    return;
  }

  resolvePending(
    data
  );

  switch (
    data.msg_type
  ) {

    case "balance":

      handleBalanceMessage(
        data
      );

      break;

    case "proposal":

      handleProposalMessage(
        data
      );

      break;

    case "buy":

      handleBuyMessage(
        data
      );

      break;

    case "proposal_open_contract":

      handleOpenContractMessage(
        data
      );

      break;

    case "portfolio":

      handlePortfolioMessage(
        data
      );

      break;

    case "sell":

      log(
        "Contract sold.",
        data.sell
      );

      state.contractId =
        null;

      break;

    default:

      break;
  }
}

function handleBalanceMessage(
  data
) {

  const balance =
    data?.balance;

  if (
    !balance
  ) {

    return;
  }

  setText(
    "balance",
    balance.balance ??
      "—"
  );

  setText(
    "currency",
    balance.currency ??
      "—"
  );

  if (
    state.account
  ) {

    state.account.balance =
      balance.balance;

    state.account.currency =
      balance.currency;
  }
}

function handleProposalMessage(
  data
) {

  const proposal =
    data?.proposal;

  if (
    !proposal
  ) {

    return;
  }

  state.proposal =
    proposal;

  setTextAny(
    proposal.ask_price ??
      "—",
    "askPrice",
    "proposalPrice"
  );

  setTextAny(
    proposal.payout ??
      "—",
    "payout",
    "proposalPayout"
  );

  setTextAny(
    proposal.id ??
      "—",
    "proposal",
    "proposalId"
  );

  setButtonEnabled(
    "buyContract",
    Boolean(
      proposal.id
    )
  );
}

function handleBuyMessage(
  data
) {

  const buy =
    data?.buy;

  if (
    !buy
  ) {

    return;
  }

  state.contractId =
    buy.contract_id ??
    null;

  setTextAny(
    buy.contract_id ??
      "—",
    "contractId",
    "openContractId"
  );

  setTextAny(
    buy.buy_price ??
      "—",
    "buyPrice",
    "purchasePrice"
  );

  setTextAny(
    buy.payout ??
      "—",
    "payout",
    "contractPayout"
  );

  log(
    "Contract purchased.",
    buy
  );

  const sellButton =
    first(
      "sellOpenContract",
      "sellContract"
    );

  if (
    sellButton
  ) {

    sellButton.disabled =
      !state.contractId;
  }

  if (
    state.contractId
  ) {

    sendTrade(
      {
        proposal_open_contract:
          1,

        contract_id:
          Number(
            state.contractId
          ),

        subscribe:
          1
      },
      {
        timeoutMs:
          10000
      }
    )
      .then(
        data2 =>
          handleTradeMessage(
            data2
          )
      )
      .catch(
        error =>
          log(
            `Open contract request: ${error.message}`
          )
      );
  }
}

function handleOpenContractMessage(
  data
) {

  const contract =
    data?.proposal_open_contract;

  if (
    !contract
  ) {

    return;
  }

  state.openContract =
    contract;

  setTextAny(
    contract.contract_id ??
      state.contractId ??
      "—",
    "contractId",
    "openContractId"
  );

  setTextAny(
    contract.profit ??
      "—",
    "profit",
    "contractProfit"
  );

  setTextAny(
    contract.bid_price ??
      contract.buy_price ??
      "—",
    "currentValue",
    "contractValue"
  );

  setTextAny(
    contract.status ??
      contract.contract_status ??
      "—",
    "contractStatus",
    "openStatus"
  );

  if (
    contract.is_sold ||
    [
      "sold",
      "won",
      "lost",
      "expired"
    ].includes(
      String(
        contract.status || ""
      ).toLowerCase()
    )
  ) {

    state.contractId =
      null;

    const sellButton =
      first(
        "sellOpenContract",
        "sellContract"
      );

    if (
      sellButton
    ) {

      sellButton.disabled =
        true;
    }
  }
}

function handlePortfolioMessage(
  data
) {

  const contracts =
    data?.portfolio;

  const list =
    Array.isArray(
      contracts
    )
      ? contracts
      : Array.isArray(
          contracts?.contracts
        )
        ? contracts.contracts
        : [];

  const current =
    list[0];

  if (
    current
  ) {

    state.contractId =
      current.contract_id ??
      null;

    state.openContract =
      current;
  }

  const sellButton =
    first(
      "sellOpenContract",
      "sellContract"
    );

  if (
    sellButton
  ) {

    sellButton.disabled =
      !state.contractId;
  }

  setTextAny(
    state.contractId ??
      "—",
    "contractId",
    "openContractId"
  );
}

async function reconnectTradeWS() {

  if (
    !state.account
  ) {

    return;
  }

  if (
    state.tradeConnectPromise
  ) {

    return state.tradeConnectPromise;
  }

  state.tradeConnectPromise =
    connectTradeWS()
      .catch(
        error => {

          setTradeStatus(
            "TRADE ERROR",
            false
          );

          log(
            `Trading connection error: ${error.message}`
          );
        }
      )
      .finally(
        () => {

          state.tradeConnectPromise =
            null;
        }
      );

  return state.tradeConnectPromise;
}

async function disconnectTradeWS() {

  ++state.tradeGeneration;

  clearPendingRequests(
    "Trading connection closed."
  );

  if (
    state.tradeWS
  ) {

    try {
      state.tradeWS.close();
    } catch {}
  }

  state.tradeWS =
    null;

  state.tradeAccountId =
    null;

  state.proposal =
    null;

  state.contractId =
    null;

  state.openContract =
    null;

  setTradeStatus(
    "TRADE OFFLINE",
    false
  );

  clearOrderOutputs();
}

function setButtonEnabled(
  id,
  enabled
) {

  const button =
    $(id);

  if (
    button
  ) {

    button.disabled =
      !enabled;
  }
}

function clearOrderOutputs() {

  setTextAny(
    "—",
    "askPrice",
    "proposalPrice",
    "payout",
    "proposal",
    "proposalId"
  );

  setTextAny(
    "—",
    "contractId",
    "openContractId",
    "buyPrice",
    "purchasePrice"
  );
}

/* =========================================================
   ORDER PANEL
   ========================================================= */

function getStake() {

  const input =
    first(
      "stake",
      "stakeInput",
      "amount"
    );

  const value =
    Number(
      input?.value
    );

  return Number.isFinite(
    value
  )
    ? value
    : 0;
}

function setStake(
  value
) {

  const input =
    first(
      "stake",
      "stakeInput",
      "amount"
    );

  if (!input) {
    return;
  }

  const next =
    Math.max(
      CONFIG.trading.stakeMin,
      Number(value) || 0
    );

  input.value =
    Number(
      next.toFixed(2)
    );
}

function getDuration() {

  const input =
    first(
      "duration",
      "durationInput"
    );

  const value =
    Number(
      input?.value
    );

  return (
    Number.isFinite(value) &&
    value > 0
  )
    ? Math.floor(value)
    : 1;
}

function getDurationUnit() {

  const select =
    first(
      "durationUnit",
      "durationSelect",
      "durationType"
    );

  return String(
    select?.value ||
    "t"
  );
}

function getBarrier() {

  const input =
    first(
      "barrier",
      "botBarrier",
      "barrierInput"
    );

  const value =
    Number(
      input?.value
    );

  return Number.isFinite(
    value
  )
    ? Math.round(value)
    : state.bot.threshold;
}

function getContractCurrency() {

  return (
    normalizeCurrency(
      state.account
    ) ||
    String(
      $("currency")?.textContent ||
      ""
    )
      .trim()
      .toUpperCase()
  );
}

function buildProposalRequest() {

  const contractType =
    getContractType();

  const stake =
    getStake();

  const currency =
    getContractCurrency();

  if (
    !state.account
  ) {

    throw new Error(
      "Select a trading account first."
    );
  }

  if (
    !currency ||
    currency === "—"
  ) {

    throw new Error(
      "Account currency is not available yet."
    );
  }

  if (
    !(stake > 0)
  ) {

    throw new Error(
      "Stake must be greater than zero."
    );
  }

  const request = {

    proposal:
      1,

    amount:
      stake,

    basis:
      "stake",

    contract_type:
      contractType,

    currency:
      currency,

    duration:
      getDuration(),

    duration_unit:
      getDurationUnit(),

    underlying_symbol:
      state.symbol
  };

  if (
    [
      "DIGITOVER",
      "DIGITUNDER",
      "DIGITMATCH",
      "DIGITDIFF"
    ].includes(
      contractType
    )
  ) {

    request.barrier =
      String(
        clamp(
          getBarrier(),
          0,
          9
        )
      );
  }

  return request;
}

async function requestProposal() {

  await reconnectTradeWS();

  if (
    !isOpen(
      state.tradeWS
    )
  ) {

    throw new Error(
      "Trading connection is not online."
    );
  }

  const request =
    buildProposalRequest();

  log(
    "Requesting live proposal.",
    request
  );

  const button =
    first(
      "getLiveProposal",
      "proposalButton"
    );

  setButtonBusy(
    button,
    true,
    "LOADING..."
  );

  try {

    const response =
      await sendTrade(
        request,
        {
          timeoutMs:
            CONFIG.trading.proposalTimeoutMs
        }
      );

    handleProposalMessage(
      response
    );

    if (
      !response?.proposal?.id
    ) {

      throw new Error(
        "Deriv returned no proposal ID."
      );
    }

    log(
      "Live proposal received.",
      response.proposal
    );

    return response.proposal;

  } finally {

    setButtonBusy(
      button,
      false
    );
  }
}

async function buyCurrentProposal() {

  await reconnectTradeWS();

  if (
    !state.proposal?.id
  ) {

    await requestProposal();
  }

  if (
    !state.proposal?.id
  ) {

    throw new Error(
      "No valid proposal is available."
    );
  }

  const askPrice =
    Number(
      state.proposal.ask_price
    );

  if (
    !Number.isFinite(
      askPrice
    ) ||
    askPrice <= 0
  ) {

    throw new Error(
      "Proposal has no valid ask price."
    );
  }

  const button =
    first(
      "buyContract",
      "buyButton"
    );

  setButtonBusy(
    button,
    true,
    "BUYING..."
  );

  try {

    const response =
      await sendTrade(
        {
          buy:
            state.proposal.id,

          price:
            askPrice
        },
        {
          timeoutMs:
            CONFIG.trading.buyTimeoutMs
        }
      );

    handleBuyMessage(
      response
    );

    return response.buy;

  } finally {

    setButtonBusy(
      button,
      false
    );
  }
}

async function sellOpenContract() {

  await reconnectTradeWS();

  if (
    !state.contractId
  ) {

    throw new Error(
      "There is no open contract to sell."
    );
  }

  const button =
    first(
      "sellOpenContract",
      "sellContract"
    );

  setButtonBusy(
    button,
    true,
    "SELLING..."
  );

  try {

    const response =
      await sendTrade(
        {
          sell:
            Number(
              state.contractId
            ),

          price:
            0
        },
        {
          timeoutMs:
            10000
        }
      );

    handleTradeMessage(
      response
    );

    return response.sell;

  } finally {

    setButtonBusy(
      button,
      false
    );
  }
}

/* =========================================================
   ORDER CONTROLS
   ========================================================= */

function setupOrderControls() {

  const minus =
    first(
      "stakeMinus",
      "decreaseStake"
    );

  const plus =
    first(
      "stakePlus",
      "increaseStake"
    );

  const proposal =
    first(
      "getLiveProposal",
      "proposalButton"
    );

  const buy =
    first(
      "buyContract",
      "buyButton"
    );

  const sell =
    first(
      "sellOpenContract",
      "sellContract"
    );

  if (
    minus
  ) {

    minus.onclick =
      () => {

        setStake(
          getStake() -
          CONFIG.trading.stakeStep
        );
      };
  }

  if (
    plus
  ) {

    plus.onclick =
      () => {

        setStake(
          getStake() +
          CONFIG.trading.stakeStep
        );
      };
  }

  if (
    proposal
  ) {

    proposal.onclick =
      async () => {

        try {

          await requestProposal();

        } catch (
          error
        ) {

          log(
            `Proposal error: ${error.message}`
          );
        }
      };
  }

  if (
    buy
  ) {

    buy.onclick =
      async () => {

        try {

          await buyCurrentProposal();

        } catch (
          error
        ) {

          log(
            `Buy error: ${error.message}`
          );
        }
      };
  }

  if (
    sell
  ) {

    sell.onclick =
      async () => {

        try {

          await sellOpenContract();

        } catch (
          error
        ) {

          log(
            `Sell error: ${error.message}`
          );
        }
      };

    sell.disabled =
      true;
  }

  /*
    Changing proposal inputs invalidates
    the old price.
  */

  [
    "stake",
    "stakeInput",
    "amount",
    "duration",
    "durationInput",
    "durationUnit",
    "durationSelect",
    "durationType",
    "barrier",
    "barrierInput",
    "botBarrier",
    "contractType",
    "contract",
    "contractSelect"
  ].forEach(
    id => {

      const el =
        $(id);

      if (!el) {
        return;
      }

      el.addEventListener(
        "change",
        () => {

          state.proposal =
            null;

          clearOrderOutputs();
        }
      );
    }
  );
}

/* =========================================================
   BOT CONTROLS
   ========================================================= */

function setupBotControls() {

  const refresh =
    first(
      "botRefresh",
      "refreshBot"
    );

  if (
    refresh
  ) {

    refresh.onclick =
      () => {

        updatePredictionBot();

        log(
          "Prediction engine refreshed."
        );
      };
  }

  const threshold =
    first(
      "botThreshold",
      "thresholdSelect"
    );

  if (
    threshold
  ) {

    threshold.addEventListener(
      "change",
      () => {

        state.bot.threshold =
          clamp(
            Number(
              threshold.value
            ) || 4,
            0,
            8
          );

        updatePredictionBot();

        log(
          `Prediction threshold changed to ${state.bot.threshold}.`
        );
      }
    );
  }
}

/* =========================================================
   MARKET SELECTOR
   ========================================================= */

function setupMarketControls() {

  const marketSelect =
    first(
      "symbolSelect",
      "marketSelect"
    );

  const botSymbol =
    $("botSymbol");

  const changeSymbol =
    symbol => {

      if (
        !symbol ||
        symbol ===
          state.symbol
      ) {

        return;
      }

      state.symbol =
        String(symbol);

      if (
        marketSelect
      ) {

        marketSelect.value =
          state.symbol;
      }

      if (
        botSymbol
      ) {

        botSymbol.value =
          state.symbol;
      }

      state.proposal =
        null;

      clearOrderOutputs();

      log(
        `Changing market to ${state.symbol}.`
      );

      connectPublicMarket();

      /*
        The trading socket can stay on the
        same account; proposals will use
        the newly selected symbol.
      */
    };

  if (
    marketSelect
  ) {

    marketSelect.value =
      state.symbol;

    marketSelect.addEventListener(
      "change",
      event => {

        changeSymbol(
          event.target.value
        );
      }
    );
  }

  if (
    botSymbol
  ) {

    botSymbol.value =
      state.symbol;

    botSymbol.addEventListener(
      "change",
      event => {

        changeSymbol(
          event.target.value
        );
      }
    );
  }
}

/* =========================================================
   ACCOUNT SELECTOR
   ========================================================= */

function setupAccountControls() {

  const select =
    $("accountSelect");

  if (!select) {
    return;
  }

  select.addEventListener(
    "change",
    async () => {

      try {

        await updateSelectedAccount();

      } catch (
        error
      ) {

        log(
          `Account switch error: ${error.message}`
        );
      }
    }
  );
}

/* =========================================================
   GLOBAL INPUT NORMALIZATION
   ========================================================= */

function setupInputDefaults() {

  const stake =
    first(
      "stake",
      "stakeInput",
      "amount"
    );

  if (
    stake &&
    !stake.value
  ) {

    stake.value =
      "5";
  }

  const duration =
    first(
      "duration",
      "durationInput"
    );

  if (
    duration &&
    !duration.value
  ) {

    duration.value =
      "1";
  }

  const unit =
    first(
      "durationUnit",
      "durationSelect",
      "durationType"
    );

  if (
    unit &&
    !unit.value
  ) {

    unit.value =
      "t";
  }

  const barrier =
    first(
      "barrier",
      "botBarrier",
      "barrierInput"
    );

  if (
    barrier &&
    !barrier.value
  ) {

    barrier.value =
      String(
        state.bot.threshold
      );
  }

  const contract =
    first(
      "contractType",
      "contract",
      "contractSelect"
    );

  if (
    contract &&
    !contract.value
  ) {

    contract.value =
      "DIGITOVER";
  }
}

/* =========================================================
   CLEANUP
   ========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    if (
      state.publicReconnectTimer
    ) {

      clearTimeout(
        state.publicReconnectTimer
      );
    }

    if (
      state.publicWS
    ) {

      try {
        state.publicWS.close();
      } catch {}
    }

    if (
      state.tradeWS
    ) {

      try {
        state.tradeWS.close();
      } catch {}
    }

    clearPendingRequests(
      "Page unloading."
    );
  }
);

window.addEventListener(
  "resize",
  drawChart
);

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initializeApp() {

  log(
    "TRADERS HUB v2 initialized."
  );

  setupInputDefaults();

  setupAuthButtons();

  setupBotControls();

  setupMarketControls();

  setupAccountControls();

  setupOrderControls();

  resetPredictionCards();

  updatePredictionBot();

  /*
    Public market feed works even
    when logged out.
  */

  setTimeout(
    () => {

      connectPublicMarket();

    },
    100
  );

  /*
    Authenticated account/trading feed.
  */

  await loadAuthAndAccounts();
}

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initializeApp,
    {
      once: true
    }
  );

} else {

  initializeApp();
}
