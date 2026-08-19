"use strict";

/*
=========================================================
 TRADERS HUB
 Deriv Options Terminal + Digit Analysis Engine

 CORRECTED VERSION

 PUBLIC MARKET
   - Historical ticks
   - Continuous live tick subscription
   - Current price
   - Last digit
   - Digit history
   - Rolling predictor

 AUTHENTICATED TRADING
   - Account balance
   - Proposal
   - Buy
   - Open contract
   - Sell
   - Contract status

 IMPORTANT:
 This predictor is statistical analysis only.
 It does NOT guarantee future results or profit.
=========================================================
*/


/* =======================================================
   HELPERS
======================================================= */

const $ = (id) => document.getElementById(id);


function log(message, data = null) {

  const box = $("log");

  const line =
    `[${new Date().toLocaleTimeString()}] ${message}`;

  const extra =
    data !== null
      ? "\n" + JSON.stringify(data, null, 2)
      : "";

  if (box) {
    box.textContent =
      `${line}${extra}\n${box.textContent}`;
  }

  console.log(line, data ?? "");
}


function setText(id, value) {

  const element = $(id);

  if (element) {
    element.textContent = value;
  }

}


function percentage(value) {

  const n = Number(value);

  return Number.isFinite(n)
    ? `${n.toFixed(1)}%`
    : "—";

}


function clamp(value, min, max) {

  return Math.max(
    min,
    Math.min(max, value)
  );

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


/* =======================================================
   STATE
======================================================= */

const state = {

  symbol: "1HZ100V",

  prices: [],

  digits: [],

  epochs: [],

  previous: null,

  pipSize: null,

  /* PUBLIC MARKET */

  marketWS: null,

  marketGeneration: 0,

  marketReconnectTimer: null,

  marketReconnectAttempts: 0,

  marketTickSubscriptionId: null,

  marketHistoryLoaded: false,

  /* AUTHENTICATED TRADING */

  account: null,

  accounts: [],

  tradingWS: null,

  tradingGeneration: 0,

  tradingReady: false,

  tradingConnecting: false,

  tradingReconnectTimer: null,

  tradingReconnectAttempts: 0,

  proposal: null,

  contractId: null,

  requestId: 100,

  /* PREDICTOR */

  bot: {

    historyLimit: 500,

    analysisWindow: 240,

    minimumSamples: 60,

    validationSamples: 120,

    highConfidenceAccuracy: 80,

    minimumProbability: 20,

    minimumMargin: 5,

    threshold: 4,

    lastStats: null

  }

};


/* =======================================================
   REQUEST ID
======================================================= */

function nextRequestId() {

  state.requestId += 1;

  return state.requestId;

}


/* =======================================================
   DIGIT EXTRACTION
======================================================= */

function digitFromPrice(price, pipSize = null) {

  if (
    price === undefined ||
    price === null
  ) {
    return null;
  }

  const number = Number(price);

  if (!Number.isFinite(number)) {
    return null;
  }

  const p = Number(pipSize);

  let text;

  if (
    Number.isInteger(p) &&
    p >= 0 &&
    p <= 10
  ) {

    text = number.toFixed(p);

  } else {

    text = String(price);

  }

  const cleaned =
    text.replace(/[^0-9]/g, "");

  if (!cleaned.length) {
    return null;
  }

  return Number(
    cleaned[cleaned.length - 1]
  );

}


/* =======================================================
   MARKET UI
======================================================= */

function updatePriceUI(quote, epoch) {

  const precision =
    Number.isInteger(Number(state.pipSize))
      ? Number(state.pipSize)
      : 2;

  setText(
    "price",
    Number(quote).toFixed(precision)
  );

  if (epoch) {

    setText(
      "lastTick",
      new Date(
        Number(epoch) * 1000
      ).toLocaleTimeString()
    );

  }

  setText(
    "symbolCode",
    state.symbol
  );

  const change = $("priceChange");

  if (
    change &&
    state.previous !== null
  ) {

    const difference =
      Number(quote) -
      Number(state.previous);

    if (difference > 0) {

      change.className = "change up";
      change.textContent = "UP";

    } else if (difference < 0) {

      change.className = "change down";
      change.textContent = "DOWN";

    } else {

      change.className = "change neutral";
      change.textContent = "FLAT";

    }

  }

  state.previous = Number(quote);

}


/* =======================================================
   CHART
======================================================= */

function drawChart() {

  const canvas = $("chart");

  if (!canvas) {
    return;
  }

  const rect =
    canvas.getBoundingClientRect();

  const width =
    Math.max(1, rect.width);

  const height = 260;

  const dpr =
    window.devicePixelRatio || 1;

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

  const visible =
    state.prices.slice(-100);

  const min =
    Math.min(...visible);

  const max =
    Math.max(...visible);

  const range =
    max - min || 1;

  ctx.strokeStyle = "#ff3d69";
  ctx.lineWidth = 2;

  ctx.beginPath();

  visible.forEach((price, index) => {

    const x =
      (
        index /
        Math.max(
          1,
          visible.length - 1
        )
      ) * width;

    const y =
      height -
      (
        (price - min) /
        range
      ) *
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


/* =======================================================
   RESET MARKET
======================================================= */

function resetMarketData() {

  state.prices = [];
  state.digits = [];
  state.epochs = [];
  state.previous = null;
  state.pipSize = null;
  state.marketHistoryLoaded = false;
  state.marketTickSubscriptionId = null;

  setText("price", "—");
  setText("lastDigit", "—");
  setText("botDigit", "—");
  setText("priceChange", "WAITING");
  setText("dataQuality", "Collecting ticks…");
  setText("filterStatus", "WAITING FOR DATA");

  const change = $("priceChange");

  if (change) {
    change.className = "change neutral";
  }

  resetPredictionUI();

  drawChart();

}


/* =======================================================
   PROCESS MARKET TICK
======================================================= */

function processMarketTick(
  quote,
  epoch,
  pipSize = null
) {

  const price = Number(quote);

  if (!Number.isFinite(price)) {
    return;
  }

  if (
    Number.isFinite(Number(pipSize))
  ) {

    state.pipSize =
      Number(pipSize);

  }

  updatePriceUI(
    price,
    epoch
  );

  state.prices.push(price);

  state.epochs.push(
    Number(epoch) ||
    Date.now() / 1000
  );

  if (
    state.prices.length >
    state.bot.historyLimit
  ) {

    state.prices.shift();
    state.epochs.shift();

  }

  const digit =
    digitFromPrice(
      price,
      state.pipSize
    );

  if (Number.isInteger(digit)) {

    state.digits.push(digit);

    if (
      state.digits.length >
      state.bot.historyLimit
    ) {
      state.digits.shift();
    }

    setText(
      "lastDigit",
      digit
    );

  }

  drawChart();

  updatePredictionBot();

}


/* =======================================================
   HISTORICAL TICKS
======================================================= */

/*
 IMPORTANT FIX:

 Do NOT send:

 subscribe: 0

 to the public Options endpoint.

 The current Deriv API allows one-shot historical
 requests without the subscribe field.

 Live ticks are handled separately with:

 ticks + subscribe: 1
*/

function loadHistoricalTicks(
  ws,
  symbol
) {

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  const request = {

    ticks_history:
      symbol,

    count:
      state.bot.historyLimit,

    end:
      "latest",

    style:
      "ticks",

    req_id:
      nextRequestId()

  };

  try {

    ws.send(
      JSON.stringify(request)
    );

    log(
      `Requested ${state.bot.historyLimit} historical ticks for ${symbol}.`
    );

  } catch (error) {

    log(
      "Historical tick request failed: " +
      error.message
    );

  }

}


/* =======================================================
   LIVE TICK SUBSCRIPTION
======================================================= */

/*
 IMPORTANT FIX:

 The old version requested one tick every second.

 That is unnecessary and can cause:

 - duplicate requests
 - gaps
 - subscription conflicts
 - unnecessary traffic
 - confusing API errors

 The correct approach is one continuous subscription:

 {
   ticks: symbol,
   subscribe: 1
 }
*/

function subscribePublicTicks(
  ws,
  symbol
) {

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  const request = {

    ticks:
      symbol,

    subscribe:
      1,

    req_id:
      nextRequestId()

  };

  try {

    ws.send(
      JSON.stringify(request)
    );

    log(
      `Subscribed to live ticks: ${symbol}`
    );

  } catch (error) {

    log(
      "Live tick subscription failed: " +
      error.message
    );

  }

}


/* =======================================================
   PUBLIC MARKET WEBSOCKET
======================================================= */

function connectPublicMarket() {

  const generation =
    ++state.marketGeneration;

  if (
    state.marketReconnectTimer
  ) {

    clearTimeout(
      state.marketReconnectTimer
    );

    state.marketReconnectTimer = null;

  }

  if (state.marketWS) {

    try {

      /*
       * Ask Deriv to stop subscriptions before
       * closing when possible.
       */

      if (
        state.marketWS.readyState ===
        WebSocket.OPEN
      ) {

        try {

          state.marketWS.send(
            JSON.stringify({
              forget_all: "ticks",
              req_id: nextRequestId()
            })
          );

        } catch (_) {}

      }

      state.marketWS.close();

    } catch (_) {}

    state.marketWS = null;

  }

  resetMarketData();

  setStatus(
    false,
    "Connecting..."
  );

  const symbol =
    state.symbol;

  log(
    `Connecting public market ${symbol}...`
  );

  let ws;

  try {

    ws =
      new WebSocket(
        "wss://api.derivws.com/trading/v1/options/ws/public"
      );

  } catch (error) {

    log(
      "Could not create market WebSocket: " +
      error.message
    );

    scheduleMarketReconnect(
      generation
    );

    return;

  }

  state.marketWS = ws;


  /* =====================================================
     OPEN
  ===================================================== */

  ws.onopen = () => {

    if (
      generation !==
      state.marketGeneration
    ) {
      return;
    }

    state.marketReconnectAttempts = 0;

    setStatus(
      true,
      "Market online"
    );

    log(
      "Public market WebSocket connected."
    );

    /*
     * FIRST:
     * Load historical data.
     */
    loadHistoricalTicks(
      ws,
      symbol
    );

    /*
     * SECOND:
     * Start continuous live stream.
     */
    subscribePublicTicks(
      ws,
      symbol
    );

  };


  /* =====================================================
     MESSAGE
  ===================================================== */

  ws.onmessage = (event) => {

    if (
      generation !==
      state.marketGeneration
    ) {
      return;
    }

    let data;

    try {

      data =
        JSON.parse(event.data);

    } catch (error) {

      log(
        "Market JSON parse error: " +
        error.message
      );

      return;

    }


    /* ================================================
       API ERROR
    ================================================ */

    if (data.error) {

      log(
        "Market API error",
        data.error
      );

      /*
       * If the subscription itself failed,
       * reconnect instead of silently leaving
       * the UI dead.
       */

      if (
        data.echo_req?.ticks === symbol
      ) {

        try {
          ws.close();
        } catch (_) {}

      }

      return;

    }


    /* ================================================
       HISTORY
    ================================================ */

    if (
      data.msg_type === "history" &&
      data.history
    ) {

      const prices =
        Array.isArray(
          data.history.prices
        )
          ? data.history.prices
          : [];

      const times =
        Array.isArray(
          data.history.times
        )
          ? data.history.times
          : [];

      if (
        Number.isFinite(
          Number(data.pip_size)
        )
      ) {

        state.pipSize =
          Number(data.pip_size);

      }

      state.prices =
        prices
          .map(Number)
          .filter(Number.isFinite)
          .slice(
            -state.bot.historyLimit
          );

      state.epochs =
        times
          .map(Number)
          .filter(Number.isFinite)
          .slice(
            -state.bot.historyLimit
          );

      state.digits =
        state.prices
          .map(price =>
            digitFromPrice(
              price,
              state.pipSize
            )
          )
          .filter(Number.isInteger)
          .slice(
            -state.bot.historyLimit
          );

      state.marketHistoryLoaded =
        true;

      if (state.prices.length) {

        const latest =
          state.prices[
            state.prices.length - 1
          ];

        const latestTime =
          state.epochs[
            state.epochs.length - 1
          ];

        /*
         * Do not call updatePriceUI here if
         * a newer live tick has already arrived.
         */

        if (
          state.previous === null
        ) {

          updatePriceUI(
            latest,
            latestTime
          );

        }

        const latestDigit =
          digitFromPrice(
            latest,
            state.pipSize
          );

        if (
          Number.isInteger(latestDigit)
        ) {

          setText(
            "lastDigit",
            latestDigit
          );

        }

      }

      drawChart();

      updatePredictionBot();

      setText(
        "dataQuality",
        `${state.digits.length} ticks analysed`
      );

      log(
        `Loaded ${state.digits.length} historical ticks.`
      );

      return;

    }


    /* ================================================
       LIVE TICK
    ================================================ */

    if (
      data.msg_type === "tick" &&
      data.tick
    ) {

      const tick =
        data.tick;

      /*
       * Only process the symbol we requested.
       */

      if (
        tick.symbol &&
        tick.symbol !== state.symbol
      ) {
        return;
      }

      if (
        data.subscription?.id
      ) {

        state.marketTickSubscriptionId =
          data.subscription.id;

      }

      processMarketTick(
        tick.quote,
        tick.epoch,
        tick.pip_size ??
          data.pip_size ??
          state.pipSize
      );

      return;

    }


    /* ================================================
       SUBSCRIPTION CONFIRMATION / OTHER
    ================================================ */

    if (
      data.subscription?.id &&
      data.echo_req?.ticks === symbol
    ) {

      state.marketTickSubscriptionId =
        data.subscription.id;

      log(
        "Live tick subscription confirmed."
      );

    }

  };


  /* =====================================================
     ERROR
  ===================================================== */

  ws.onerror = () => {

    if (
      generation !==
      state.marketGeneration
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


  /* =====================================================
     CLOSE
  ===================================================== */

  ws.onclose = () => {

    if (
      generation !==
      state.marketGeneration
    ) {
      return;
    }

    state.marketWS = null;
    state.marketTickSubscriptionId = null;

    setStatus(
      false,
      "Market offline"
    );

    log(
      "Market WebSocket disconnected."
    );

    scheduleMarketReconnect(
      generation
    );

  };

}


/* =======================================================
   MARKET RECONNECT
======================================================= */

function scheduleMarketReconnect(
  generation
) {

  if (
    generation !==
    state.marketGeneration
  ) {
    return;
  }

  if (
    state.marketReconnectTimer
  ) {
    return;
  }

  const delay =
    Math.min(
      15000,
      1000 *
      Math.pow(
        2,
        state.marketReconnectAttempts
      )
    );

  state.marketReconnectAttempts =
    Math.min(
      state.marketReconnectAttempts + 1,
      4
    );

  log(
    `Market reconnect scheduled in ${Math.round(delay / 1000)}s.`
  );

  state.marketReconnectTimer =
    setTimeout(
      () => {

        state.marketReconnectTimer =
          null;

        if (
          generation ===
          state.marketGeneration
        ) {

          connectPublicMarket();

        }

      },
      delay
    );

}


/* =======================================================
   PREDICTION MODEL
======================================================= */

function normalizeDistribution(values) {

  const total =
    values.reduce(
      (sum, value) =>
        sum +
        Math.max(
          0,
          Number(value) || 0
        ),
      0
    );

  if (total <= 0) {

    return Array(10).fill(0.1);

  }

  return values.map(
    value =>
      Math.max(
        0,
        Number(value) || 0
      ) / total
  );

}


/* =======================================================
   RECENCY MODEL
======================================================= */

function recencyDistribution(digits) {

  const scores =
    Array(10).fill(0);

  const decay = 0.985;

  let weight = 1;

  for (
    let i = digits.length - 1;
    i >= 0;
    i--
  ) {

    const digit =
      digits[i];

    if (
      Number.isInteger(digit)
    ) {

      scores[digit] += weight;

    }

    weight *= decay;

  }

  return normalizeDistribution(scores);

}


/* =======================================================
   WINDOW MODEL
======================================================= */

function windowDistribution(
  digits,
  windowSize
) {

  const window =
    digits.slice(-windowSize);

  const counts =
    Array(10).fill(1);

  window.forEach(digit => {

    if (
      Number.isInteger(digit)
    ) {

      counts[digit] += 1;

    }

  });

  return normalizeDistribution(counts);

}


/* =======================================================
   TRANSITION MODEL
======================================================= */

function transitionDistribution(digits) {

  const counts =
    Array.from(
      {
        length: 10
      },
      () =>
        Array(10).fill(1)
    );

  for (
    let i = 1;
    i < digits.length;
    i++
  ) {

    const previous =
      digits[i - 1];

    const current =
      digits[i];

    if (
      Number.isInteger(previous) &&
      Number.isInteger(current)
    ) {

      counts[previous][current] += 1;

    }

  }

  const last =
    digits[
      digits.length - 1
    ];

  if (
    !Number.isInteger(last)
  ) {

    return Array(10).fill(0.1);

  }

  return normalizeDistribution(
    counts[last]
  );

}


/* =======================================================
   TWO DIGIT CONTEXT
======================================================= */

function contextDistribution(digits) {

  if (digits.length < 3) {
    return Array(10).fill(0.1);
  }

  const counts =
    Array(10).fill(1);

  const a =
    digits[
      digits.length - 2
    ];

  const b =
    digits[
      digits.length - 1
    ];

  for (
    let i = 2;
    i < digits.length;
    i++
  ) {

    if (
      digits[i - 2] === a &&
      digits[i - 1] === b
    ) {

      const next =
        digits[i];

      if (
        Number.isInteger(next)
      ) {

        counts[next] += 3;

      }

    }

  }

  return normalizeDistribution(counts);

}


/* =======================================================
   DIGIT ENSEMBLE
======================================================= */

function buildDigitModel(digits) {

  const recent =
    recencyDistribution(digits);

  const short =
    windowDistribution(
      digits,
      40
    );

  const medium =
    windowDistribution(
      digits,
      100
    );

  const transition =
    transitionDistribution(digits);

  const context =
    contextDistribution(digits);

  const scores =
    Array(10).fill(0);

  for (
    let digit = 0;
    digit < 10;
    digit++
  ) {

    scores[digit] =
      recent[digit] * 0.30 +
      short[digit] * 0.20 +
      medium[digit] * 0.15 +
      transition[digit] * 0.20 +
      context[digit] * 0.15;

  }

  const probabilities =
    normalizeDistribution(scores);

  const ranking =
    probabilities
      .map(
        (probability, digit) => ({
          digit,
          probability
        })
      )
      .sort(
        (a, b) =>
          b.probability -
          a.probability
      );

  const first =
    ranking[0];

  const second =
    ranking[1];

  return {

    probabilities,

    ranking,

    prediction:
      first?.digit ?? null,

    probability:
      first?.probability ?? 0,

    secondProbability:
      second?.probability ?? 0,

    margin:
      first
        ? (
            first.probability -
            (
              second?.probability || 0
            )
          ) * 100
        : 0

  };

}


/* =======================================================
   WALK-FORWARD VALIDATION
======================================================= */

function validateDigitModel(
  digits,
  sampleCount
) {

  const total =
    digits.length;

  const start =
    Math.max(
      30,
      total - sampleCount
    );

  let wins = 0;
  let samples = 0;

  const probabilityHits = [];

  for (
    let i = start;
    i < total;
    i++
  ) {

    const training =
      digits.slice(
        0,
        i
      );

    if (
      training.length < 30
    ) {
      continue;
    }

    const model =
      buildDigitModel(training);

    const actual =
      digits[i];

    if (
      model.prediction === actual
    ) {

      wins++;

    }

    probabilityHits.push(
      model.probabilities[actual] || 0
    );

    samples++;

  }

  return {

    wins,

    samples,

    accuracy:
      samples
        ? (
            wins /
            samples
          ) * 100
        : 0,

    averageActualProbability:
      probabilityHits.length
        ? (
            probabilityHits.reduce(
              (sum, value) =>
                sum + value,
              0
            ) /
            probabilityHits.length
          ) * 100
        : 0

  };

}


/* =======================================================
   BINARY MODEL
======================================================= */

function classifyBinary(
  digits,
  classifier
) {

  if (digits.length < 2) {

    return {

      prediction: null,
      probability: 0,
      wins: 0,
      samples: 0,
      accuracy: 0

    };

  }

  const values =
    digits.map(classifier);

  const recent =
    values.slice(-60);

  let positive = 0;
  let negative = 0;

  recent.forEach(value => {

    if (value) {
      positive++;
    } else {
      negative++;
    }

  });

  const prediction =
    positive >= negative;

  const probability =
    Math.max(
      positive,
      negative
    ) /
    Math.max(
      1,
      positive + negative
    );

  const validationStart =
    Math.max(
      1,
      values.length - 120
    );

  let wins = 0;
  let samples = 0;

  for (
    let i = validationStart;
    i < values.length;
    i++
  ) {

    const training =
      values.slice(
        0,
        i
      );

    if (
      training.length < 30
    ) {
      continue;
    }

    const window =
      training.slice(-60);

    let p = 0;
    let n = 0;

    window.forEach(value => {

      if (value) {
        p++;
      } else {
        n++;
      }

    });

    const predicted =
      p >= n;

    if (
      predicted === values[i]
    ) {

      wins++;

    }

    samples++;

  }

  return {

    prediction,

    probability:
      probability * 100,

    wins,

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


/* =======================================================
   FULL PREDICTION
======================================================= */

function calculatePrediction() {

  const digits =
    state.digits.slice(
      -state.bot.analysisWindow
    );

  if (
    digits.length <
    state.bot.minimumSamples
  ) {

    return null;

  }

  const digitModel =
    buildDigitModel(digits);

  const validation =
    validateDigitModel(
      digits,
      state.bot.validationSamples
    );

  const even =
    classifyBinary(
      digits,
      digit =>
        digit % 2 === 0
    );

  const over =
    classifyBinary(
      digits,
      digit =>
        digit >
        state.bot.threshold
    );

  const matchHigh =
    validation.samples >=
      state.bot.minimumSamples &&
    validation.accuracy >=
      state.bot.highConfidenceAccuracy &&
    digitModel.probability * 100 >=
      state.bot.minimumProbability &&
    digitModel.margin >=
      state.bot.minimumMargin;

  const evenHigh =
    even.samples >=
      state.bot.minimumSamples &&
    even.accuracy >=
      state.bot.highConfidenceAccuracy &&
    even.probability >=
      state.bot.minimumProbability;

  const overHigh =
    over.samples >=
      state.bot.minimumSamples &&
    over.accuracy >=
      state.bot.highConfidenceAccuracy &&
    over.probability >=
      state.bot.minimumProbability;

  return {

    digits: digits.length,

    match: {

      prediction:
        digitModel.prediction,

      probability:
        digitModel.probability * 100,

      margin:
        digitModel.margin,

      wins:
        validation.wins,

      samples:
        validation.samples,

      accuracy:
        validation.accuracy,

      highConfidence:
        matchHigh,

      ranking:
        digitModel.ranking.slice(0, 3)

    },

    even: {

      prediction:
        even.prediction
          ? "EVEN"
          : "ODD",

      probability:
        even.probability,

      wins:
        even.wins,

      samples:
        even.samples,

      accuracy:
        even.accuracy,

      highConfidence:
        evenHigh

    },

    over: {

      threshold:
        state.bot.threshold,

      prediction:
        over.prediction
          ? "OVER"
          : "UNDER",

      probability:
        over.probability,

      wins:
        over.wins,

      samples:
        over.samples,

      accuracy:
        over.accuracy,

      highConfidence:
        overHigh

    }

  };

}


/* =======================================================
   SIGNAL UI
======================================================= */

function setSignal(
  id,
  type,
  text
) {

  const element = $(id);

  if (!element) {
    return;
  }

  element.className =
    `signal ${type}`;

  element.textContent =
    text;

  if (type === "good") {

    element.style.fontWeight = "800";

    element.style.border =
      "2px solid #22c55e";

    element.style.boxShadow =
      "0 0 12px rgba(34,197,94,.35)";

  } else {

    element.style.fontWeight = "600";
    element.style.border = "";
    element.style.boxShadow = "";

  }

}


/* =======================================================
   PREDICTION RESET
======================================================= */

function resetPredictionUI() {

  setText("botDigit", "—");

  setText(
    "dataQuality",
    "Collecting ticks…"
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

  setText(
    "matchConf",
    "Need more ticks"
  );

  setText(
    "evenConf",
    "Need more ticks"
  );

  setText(
    "ouConf",
    "Need more ticks"
  );

  setText("matchAcc", "—");
  setText("matchWins", "—");
  setText("matchSamples", "—");

  setText("evenAcc", "—");
  setText("evenWins", "—");
  setText("evenSamples", "—");

  setText("ouAcc", "—");
  setText("ouWins", "—");
  setText("ouSamples", "—");

  renderPredictionPanel(null);

}


/* =======================================================
   ADVANCED PREDICTION PANEL
======================================================= */

function renderPredictionPanel(
  prediction
) {

  const container =
    $("advancedPredictionDisplay");

  if (!container) {
    return;
  }

  if (!prediction) {

    container.innerHTML = `
      <div class="prediction-title">
        LIVE VALIDATED PREDICTION
      </div>

      <div class="prediction-wait">
        Waiting for enough validated ticks…
      </div>
    `;

    return;

  }

  const top =
    prediction.match.ranking || [];

  const topDigits =
    top
      .map(
        item =>
          `
          <span class="prediction-digit">
            ${item.digit}
            <small>
              ${(item.probability * 100).toFixed(1)}%
            </small>
          </span>
          `
      )
      .join("");

  container.innerHTML = `

    <div class="prediction-title">
      LIVE VALIDATED PREDICTION
    </div>

    <div class="prediction-grid">

      <div class="prediction-box">

        <div class="prediction-label">
          MATCHES
        </div>

        <div class="prediction-value">
          ${prediction.match.prediction}
        </div>

        <div class="prediction-small">
          ${prediction.match.probability.toFixed(1)}%
          model probability
        </div>

        <div class="prediction-small">
          ${prediction.match.accuracy.toFixed(1)}%
          walk-forward accuracy
        </div>

      </div>


      <div class="prediction-box">

        <div class="prediction-label">
          EVEN / ODD
        </div>

        <div class="prediction-value small-value">
          ${prediction.even.prediction}
        </div>

        <div class="prediction-small">
          ${prediction.even.probability.toFixed(1)}%
          model probability
        </div>

        <div class="prediction-small">
          ${prediction.even.accuracy.toFixed(1)}%
          validation
        </div>

      </div>


      <div class="prediction-box">

        <div class="prediction-label">
          OVER / UNDER
        </div>

        <div class="prediction-value small-value">
          ${prediction.over.prediction}
          ${prediction.over.threshold}
        </div>

        <div class="prediction-small">
          ${prediction.over.probability.toFixed(1)}%
          model probability
        </div>

        <div class="prediction-small">
          ${prediction.over.accuracy.toFixed(1)}%
          validation
        </div>

      </div>

    </div>

    <div class="prediction-top">
      TOP DIGITS:
      ${topDigits}
    </div>

  `;

}


/* =======================================================
   UPDATE PREDICTOR
======================================================= */

function updatePredictionBot() {

  const digits =
    state.digits.slice(
      -state.bot.analysisWindow
    );

  if (
    digits.length <
    state.bot.minimumSamples
  ) {

    const remaining =
      state.bot.minimumSamples -
      digits.length;

    setText(
      "dataQuality",
      `Collecting ticks… ${digits.length}/${state.bot.minimumSamples}`
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

    setText(
      "matchConf",
      `${remaining} more ticks needed`
    );

    setText(
      "evenConf",
      `${remaining} more ticks needed`
    );

    setText(
      "ouConf",
      `${remaining} more ticks needed`
    );

    renderPredictionPanel(null);

    return;

  }

  const prediction =
    calculatePrediction();

  if (!prediction) {
    return;
  }

  state.bot.lastStats =
    prediction;


  /* MATCH */

  setText(
    "matchAcc",
    percentage(
      prediction.match.accuracy
    )
  );

  setText(
    "matchWins",
    prediction.match.wins
  );

  setText(
    "matchSamples",
    prediction.match.samples
  );

  setSignal(
    "matchSignal",
    prediction.match.highConfidence
      ? "good"
      : "neutral",
    `MATCH ${prediction.match.prediction}`
  );

  setText(
    "matchConf",
    prediction.match.highConfidence
      ? `HIGH CONFIDENCE • ${prediction.match.probability.toFixed(1)}%`
      : `LOW CONFIDENCE • ${prediction.match.probability.toFixed(1)}%`
  );

  setText(
    "botDigit",
    prediction.match.prediction
  );


  /* EVEN / ODD */

  setText(
    "evenAcc",
    percentage(
      prediction.even.accuracy
    )
  );

  setText(
    "evenWins",
    prediction.even.wins
  );

  setText(
    "evenSamples",
    prediction.even.samples
  );

  setSignal(
    "evenSignal",
    prediction.even.highConfidence
      ? "good"
      : "neutral",
    prediction.even.prediction
  );

  setText(
    "evenConf",
    prediction.even.highConfidence
      ? `HIGH CONFIDENCE • ${prediction.even.probability.toFixed(1)}%`
      : `LOW CONFIDENCE • ${prediction.even.probability.toFixed(1)}%`
  );


  /* OVER / UNDER */

  setText(
    "ouAcc",
    percentage(
      prediction.over.accuracy
    )
  );

  setText(
    "ouWins",
    prediction.over.wins
  );

  setText(
    "ouSamples",
    prediction.over.samples
  );

  setSignal(
    "ouSignal",
    prediction.over.highConfidence
      ? "good"
      : "neutral",
    `${prediction.over.prediction} ${prediction.over.threshold}`
  );

  setText(
    "ouConf",
    prediction.over.highConfidence
      ? `HIGH CONFIDENCE • ${prediction.over.probability.toFixed(1)}%`
      : `LOW CONFIDENCE • ${prediction.over.probability.toFixed(1)}%`
  );


  /* GLOBAL FILTER */

  const highCount =
    [
      prediction.match.highConfidence,
      prediction.even.highConfidence,
      prediction.over.highConfidence
    ].filter(Boolean).length;

  setText(
    "filterStatus",
    highCount
      ? `${highCount} HIGH-CONFIDENCE SIGNAL${highCount > 1 ? "S" : ""}`
      : "NO VALIDATED HIGH-CONFIDENCE SIGNAL"
  );

  setText(
    "dataQuality",
    `${digits.length} ticks analysed`
  );

  renderPredictionPanel(
    prediction
  );

}


/* =======================================================
   AUTH STATUS
======================================================= */

async function loadAuthAndAccounts() {

  try {

    const response =
      await fetch(
        "/api/auth/status",
        {
          credentials:
            "same-origin"
        }
      );

    if (!response.ok) {

      throw new Error(
        `Authentication status failed (${response.status})`
      );

    }

    const auth =
      await response.json();

    if (!auth.authenticated) {

      state.account = null;
      state.accounts = [];

      setText(
        "accountBadge",
        "NOT LOGGED IN"
      );

      showLoginState();

      return;

    }

    showLoggedInState();

    await loadAccounts();

    await connectTradingForSelectedAccount();

  } catch (error) {

    log(
      "Authentication/account error: " +
      error.message
    );

    setText(
      "accountBadge",
      "AUTH ERROR"
    );

  }

}


/* =======================================================
   LOGIN STATE
======================================================= */

function showLoginState() {

  const loginBtn =
    $("loginBtn");

  const logoutBtn =
    $("logoutBtn");

  const accountSelect =
    $("accountSelect");

  if (loginBtn) {
    loginBtn.style.display = "";
  }

  if (logoutBtn) {
    logoutBtn.style.display = "none";
  }

  if (accountSelect) {

    accountSelect.disabled = true;

    accountSelect.innerHTML =
      '<option value="">Login to load accounts</option>';

  }

  setText("balance", "—");
  setText("currency", "—");

  setText(
    "accountBadge",
    "NOT LOGGED IN"
  );

  setTradingButtons(false);

}


/* =======================================================
   LOGGED IN STATE
======================================================= */

function showLoggedInState() {

  const loginBtn =
    $("loginBtn");

  const logoutBtn =
    $("logoutBtn");

  if (loginBtn) {
    loginBtn.style.display = "none";
  }

  if (logoutBtn) {
    logoutBtn.style.display = "";
  }

}


/* =======================================================
   LOAD ACCOUNTS
======================================================= */

async function loadAccounts() {

  const accountSelect =
    $("accountSelect");

  if (!accountSelect) {
    return;
  }

  const response =
    await fetch(
      "/api/accounts",
      {
        credentials:
          "same-origin"
      }
    );

  if (!response.ok) {

    const text =
      await response.text();

    throw new Error(
      `Could not load Deriv accounts (${response.status}): ${text}`
    );

  }

  const payload =
    await response.json();

  let accounts = [];

  if (Array.isArray(payload)) {

    accounts = payload;

  } else if (
    Array.isArray(payload.data)
  ) {

    accounts = payload.data;

  } else if (
    Array.isArray(
      payload.data?.accounts
    )
  ) {

    accounts =
      payload.data.accounts;

  } else if (
    Array.isArray(
      payload.accounts
    )
  ) {

    accounts =
      payload.accounts;

  }

  state.accounts =
    accounts;

  accountSelect.innerHTML = "";

  if (!accounts.length) {

    accountSelect.innerHTML =
      '<option value="">No accounts found</option>';

    accountSelect.disabled = true;

    setText("balance", "—");
    setText("currency", "—");

    log(
      "No Deriv accounts returned.",
      payload
    );

    return;

  }

  accounts.forEach(
    (account, index) => {

      const accountId =
        account.account_id ||
        account.accountId ||
        account.loginid ||
        account.login_id ||
        account.id ||
        "";

      const loginid =
        account.loginid ||
        account.login_id ||
        accountId;

      const balance =
        account.balance ??
        account.amount ??
        account.available_balance ??
        "";

      const currency =
        account.currency ||
        account.currency_code ||
        "";

      const option =
        document.createElement("option");

      option.value =
        accountId;

      option.textContent =
        loginid ||
        `Account ${index + 1}`;

      option.dataset.balance =
        balance;

      option.dataset.currency =
        currency;

      accountSelect.appendChild(
        option
      );

    }
  );

  accountSelect.disabled = false;

  accountSelect.selectedIndex = 0;

  updateSelectedAccount(false);

  log(
    `Loaded ${accounts.length} account(s).`
  );

}


/* =======================================================
   SELECTED ACCOUNT
======================================================= */

function updateSelectedAccount(
  reconnect = true
) {

  const accountSelect =
    $("accountSelect");

  if (!accountSelect) {
    return;
  }

  const selected =
    accountSelect.options[
      accountSelect.selectedIndex
    ];

  if (!selected) {

    state.account = null;

    setTradingButtons(false);

    return;

  }

  const accountId =
    selected.value;

  state.account =
    state.accounts.find(
      account => {

        const id =
          account.account_id ||
          account.accountId ||
          account.loginid ||
          account.login_id ||
          account.id;

        return id === accountId;

      }
    ) || null;

  setText(
    "balance",
    selected.dataset.balance || "—"
  );

  setText(
    "currency",
    selected.dataset.currency || "—"
  );

  log(
    `Selected account ${accountId}.`
  );

  if (
    reconnect &&
    state.account
  ) {

    connectTradingForSelectedAccount();

  }

}


/* =======================================================
   AUTH BUTTONS
======================================================= */

function setupAuthButtons() {

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

          logoutBtn.disabled = true;

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

        } finally {

          window.location.reload();

        }

      };

  }

}


/* =======================================================
   TRADING WEBSOCKET
======================================================= */

async function connectTradingForSelectedAccount() {

  if (!state.account) {

    setTradingButtons(false);

    return;

  }

  const accountId =
    state.account.account_id ||
    state.account.accountId ||
    state.account.loginid ||
    state.account.login_id ||
    state.account.id;

  if (!accountId) {

    log(
      "Selected account has no account ID."
    );

    return;

  }

  const generation =
    ++state.tradingGeneration;

  state.tradingReady = false;
  state.tradingConnecting = true;

  state.proposal = null;

  if (state.tradingWS) {

    try {

      state.tradingWS.close();

    } catch (_) {}

    state.tradingWS = null;

  }

  setTradingButtons(false);

  setText(
    "accountBadge",
    "CONNECTING TRADE"
  );

  log(
    `Requesting authenticated WebSocket for ${accountId}...`
  );

  try {

    const response =
      await fetch(
        "/api/ws-url",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          credentials:
            "same-origin",

          body:
            JSON.stringify({
              accountId
            })

        }
      );

    const payload =
      await response.json();

    if (
      generation !==
      state.tradingGeneration
    ) {
      return;
    }

    if (!response.ok) {

      throw new Error(
        payload?.error ||
        payload?.message ||
        `HTTP ${response.status}`
      );

    }

    /*
     * Support several common backend response
     * structures.
     */

    const url =
      payload?.url ||
      payload?.wsUrl ||
      payload?.ws_url ||
      payload?.data?.url ||
      payload?.data?.wsUrl ||
      payload?.data?.ws_url;

    if (!url) {

      throw new Error(
        "Deriv did not return a WebSocket URL."
      );

    }

    const ws =
      new WebSocket(url);

    state.tradingWS = ws;


    /* ===================================================
       OPEN
    =================================================== */

    ws.onopen = () => {

      if (
        generation !==
        state.tradingGeneration
      ) {
        return;
      }

      state.tradingConnecting = false;
      state.tradingReconnectAttempts = 0;
      state.tradingReady = true;

      setText(
        "accountBadge",
        "TRADE READY"
      );

      setTradingButtons(true);

      log(
        "Authenticated trading WebSocket connected."
      );


      /*
       * Balance subscription.
       *
       * subscribe: 1 is valid here.
       */

      sendTrading({

        balance: 1,

        subscribe: 1,

        req_id:
          nextRequestId()

      });


      /*
       * DO NOT subscribe to ticks here.
       *
       * Public market WebSocket already provides
       * the live tick stream.
       *
       * Keeping one market stream avoids duplicate
       * predictor ticks.
       */


      /*
       * Request initial proposal only when the
       * interface is ready.
       */

      updateProposal();

    };


    /* ===================================================
       MESSAGE
    =================================================== */

    ws.onmessage = event => {

      if (
        generation !==
        state.tradingGeneration
      ) {
        return;
      }

      let data;

      try {

        data =
          JSON.parse(event.data);

      } catch (error) {

        log(
          "Trading message parse error: " +
          error.message
        );

        return;

      }

      handleTradingMessage(data);

    };


    /* ===================================================
       ERROR
    =================================================== */

    ws.onerror = () => {

      if (
        generation !==
        state.tradingGeneration
      ) {
        return;
      }

      state.tradingReady = false;

      setTradingButtons(false);

      setText(
        "accountBadge",
        "TRADE ERROR"
      );

      log(
        "Trading WebSocket error."
      );

    };


    /* ===================================================
       CLOSE
    =================================================== */

    ws.onclose = () => {

      if (
        generation !==
        state.tradingGeneration
      ) {
        return;
      }

      state.tradingReady = false;
      state.tradingConnecting = false;
      state.tradingWS = null;

      setTradingButtons(false);

      setText(
        "accountBadge",
        "TRADE OFFLINE"
      );

      log(
        "Trading WebSocket disconnected."
      );

      scheduleTradingReconnect(
        generation
      );

    };

  } catch (error) {

    if (
      generation !==
      state.tradingGeneration
    ) {
      return;
    }

    state.tradingReady = false;
    state.tradingConnecting = false;

    setTradingButtons(false);

    setText(
      "accountBadge",
      "TRADE ERROR"
    );

    log(
      "Trading connection error: " +
      error.message
    );

    scheduleTradingReconnect(
      generation
    );

  }

}


/* =======================================================
   TRADING RECONNECT
======================================================= */

function scheduleTradingReconnect(
  generation
) {

  if (
    generation !==
    state.tradingGeneration
  ) {
    return;
  }

  if (
    !state.account
  ) {
    return;
  }

  if (
    state.tradingReconnectTimer
  ) {
    return;
  }

  const delay =
    Math.min(
      15000,
      2000 *
      Math.pow(
        2,
        state.tradingReconnectAttempts
      )
    );

  state.tradingReconnectAttempts =
    Math.min(
      state.tradingReconnectAttempts + 1,
      4
    );

  log(
    `Trading reconnect scheduled in ${Math.round(delay / 1000)}s.`
  );

  state.tradingReconnectTimer =
    setTimeout(
      () => {

        state.tradingReconnectTimer =
          null;

        if (
          generation ===
          state.tradingGeneration &&
          state.account
        ) {

          connectTradingForSelectedAccount();

        }

      },
      delay
    );

}


/* =======================================================
   TRADING BUTTON STATE
======================================================= */

function setTradingButtons(enabled) {

  const proposalBtn =
    $("quoteBtn");

  const buyBtn =
    $("buyBtn");

  const sellBtn =
    $("sellBtn");

  if (proposalBtn) {

    proposalBtn.disabled =
      !enabled;

  }

  if (buyBtn) {

    buyBtn.disabled =
      !enabled ||
      !state.proposal?.id;

  }

  if (sellBtn) {

    sellBtn.disabled =
      !enabled ||
      !state.contractId;

  }

}


/* =======================================================
   SEND TRADING REQUEST
======================================================= */

function sendTrading(payload) {

  const ws =
    state.tradingWS;

  if (
    !ws ||
    ws.readyState !==
    WebSocket.OPEN
  ) {

    throw new Error(
      "Trading WebSocket is not connected."
    );

  }

  ws.send(
    JSON.stringify(payload)
  );

}


/* =======================================================
   TRADING MESSAGE
======================================================= */

function handleTradingMessage(data) {

  if (data.error) {

    log(
      "Deriv trading error",
      data.error
    );

    return;

  }


  /* =====================================================
     BALANCE
  ===================================================== */

  if (
    data.msg_type === "balance" &&
    data.balance
  ) {

    setText(
      "balance",
      data.balance.balance ?? "—"
    );

    setText(
      "currency",
      data.balance.currency ?? "—"
    );

    return;

  }


  /* =====================================================
     PROPOSAL
  ===================================================== */

  if (
    data.msg_type === "proposal" &&
    data.proposal
  ) {

    state.proposal =
      data.proposal;

    setText(
      "askPrice",
      data.proposal.ask_price ?? "—"
    );

    setText(
      "payout",
      data.proposal.payout ?? "—"
    );

    setText(
      "proposalId",
      data.proposal.id ?? "—"
    );

    setTradingButtons(true);

    log(
      "Live proposal received.",
      data.proposal
    );

    return;

  }


  /* =====================================================
     BUY
  ===================================================== */

  if (
    data.msg_type === "buy" &&
    data.buy
  ) {

    state.contractId =
      data.buy.contract_id;

    setText(
      "contractId",
      data.buy.contract_id ?? "—"
    );

    setText(
      "contractStatus",
      "OPEN"
    );

    setText(
      "contractProfit",
      data.buy.profit ?? "0"
    );

    setText(
      "contractBuyPrice",
      data.buy.buy_price ?? "—"
    );

    setTradingButtons(true);

    log(
      "Contract purchased.",
      data.buy
    );


    /*
     * Subscribe to this contract's live status.
     */

    if (
      data.buy.contract_id
    ) {

      try {

        sendTrading({

          proposal_open_contract: 1,

          contract_id:
            Number(
              data.buy.contract_id
            ),

          subscribe: 1,

          req_id:
            nextRequestId()

        });

      } catch (error) {

        log(
          "Could not subscribe to contract: " +
          error.message
        );

      }

    }

    return;

  }


  /* =====================================================
     OPEN CONTRACT
  ===================================================== */

  if (
    data.msg_type ===
      "proposal_open_contract" &&
    data.proposal_open_contract
  ) {

    const contract =
      data.proposal_open_contract;

    state.contractId =
      contract.contract_id ||
      state.contractId;

    setText(
      "contractId",
      contract.contract_id ?? "—"
    );

    setText(
      "contractStatus",
      contract.status ?? "—"
    );

    setText(
      "contractProfit",
      contract.profit ?? "—"
    );

    setText(
      "contractBuyPrice",
      contract.buy_price ?? "—"
    );

    /*
     * If the contract has finished, keep the
     * information visible but disable sell.
     */

    const finished =
      [
        "sold",
        "won",
        "lost",
        "expired"
      ].includes(
        String(
          contract.status || ""
        ).toLowerCase()
      );

    if (finished) {

      state.contractId = null;

    }

    setTradingButtons(
      true
    );

    return;

  }


  /* =====================================================
     SELL
  ===================================================== */

  if (
    data.msg_type === "sell" &&
    data.sell
  ) {

    log(
      "Contract sold.",
      data.sell
    );

    setText(
      "contractStatus",
      "SOLD"
    );

    setText(
      "contractProfit",
      data.sell.sold_for ??
        "—"
    );

    state.contractId = null;

    setTradingButtons(
      true
    );

    return;

  }

}


/* =======================================================
   PROPOSAL
======================================================= */

function updateProposal() {

  if (
    !state.tradingReady ||
    !state.account
  ) {

    return;

  }

  const currency =
    state.account.currency ||
    state.account.currency_code ||
    $("currency")?.textContent ||
    "USD";

  const amount =
    Number(
      $("stake")?.value || 1
    );

  const duration =
    Number(
      $("duration")?.value || 1
    );

  const durationUnit =
    $("durationUnit")?.value ||
    "t";

  const contractType =
    $("contractType")?.value ||
    "DIGITMATCH";

  const barrierInput =
    $("barrier")?.value;

  const request = {

    proposal: 1,

    amount:
      Number.isFinite(amount)
        ? amount
        : 1,

    basis: "stake",

    contract_type:
      contractType,

    currency:
      currency,

    underlying_symbol:
      state.symbol,

    duration:
      Number.isFinite(duration)
        ? duration
        : 1,

    duration_unit:
      durationUnit,

    req_id:
      nextRequestId()

  };


  /* =====================================================
     DIGIT CONTRACT BARRIER
  ===================================================== */

  if (
    [
      "DIGITMATCH",
      "DIGITOVER",
      "DIGITUNDER"
    ].includes(
      contractType
    )
  ) {

    let barrier =
      barrierInput;


    /*
     * MATCHES:
     * Use predictor digit if available.
     */

    if (
      contractType ===
        "DIGITMATCH" &&
      Number.isInteger(
        state.bot.lastStats?.match?.prediction
      )
    ) {

      barrier =
        String(
          state.bot.lastStats.match.prediction
        );

    }


    /*
     * OVER / UNDER:
     * Use selected threshold.
     */

    if (
      (
        contractType === "DIGITOVER" ||
        contractType === "DIGITUNDER"
      ) &&
      state.bot.lastStats?.over
    ) {

      barrier =
        String(
          state.bot.lastStats.over.threshold
        );

    }


    if (
      barrier !== undefined &&
      barrier !== null &&
      String(barrier).trim() !== ""
    ) {

      request.barrier =
        String(barrier);

    }

  }


  /*
   * Proposal subscription is valid.
   */

  request.subscribe = 1;

  try {

    sendTrading(request);

    log(
      "Requested live proposal.",
      request
    );

  } catch (error) {

    log(
      "Proposal request failed: " +
      error.message
    );

  }

}


/* =======================================================
   BUY
======================================================= */

function buyContract() {

  if (!state.tradingReady) {

    log(
      "Cannot buy: trading connection is not ready."
    );

    return;

  }

  if (!state.proposal?.id) {

    log(
      "Cannot buy: no proposal available."
    );

    return;

  }

  const askPrice =
    Number(
      state.proposal.ask_price
    );

  if (
    !Number.isFinite(askPrice)
  ) {

    log(
      "Cannot buy: invalid proposal price."
    );

    return;

  }

  try {

    sendTrading({

      buy:
        state.proposal.id,

      price:
        askPrice,

      req_id:
        nextRequestId()

    });

    log(
      "Buy request sent."
    );

  } catch (error) {

    log(
      "Buy request failed: " +
      error.message
    );

  }

}


/* =======================================================
   SELL
======================================================= */

function sellOpenContract() {

  if (!state.tradingReady) {

    log(
      "Trading connection is not ready."
    );

    return;

  }

  if (!state.contractId) {

    log(
      "No open contract selected."
    );

    return;

  }

  try {

    sendTrading({

      sell:
        Number(state.contractId),

      price:
        0,

      req_id:
        nextRequestId()

    });

    log(
      `Sell-at-market requested for ${state.contractId}.`
    );

  } catch (error) {

    log(
      "Sell request failed: " +
      error.message
    );

  }

}


/* =======================================================
   BOT CONTROLS
======================================================= */

function setupBotControls() {

  const refresh =
    $("botRefresh");

  if (refresh) {

    refresh.onclick = () => {

      updatePredictionBot();

      log(
        "Prediction engine manually refreshed."
      );

    };

  }

  const threshold =
    $("botThreshold");

  if (threshold) {

    threshold.addEventListener(
      "change",
      () => {

        const value =
          Number(
            threshold.value
          );

        if (
          Number.isFinite(value)
        ) {

          state.bot.threshold =
            clamp(
              value,
              0,
              9
            );

        }

        updatePredictionBot();

      }
    );

  }

}


/* =======================================================
   MARKET CONTROLS
======================================================= */

function setupMarketControls() {

  const marketSelect =
    $("symbolSelect");

  const botSymbol =
    $("botSymbol");


  function changeSymbol(symbol) {

    if (!symbol) {
      return;
    }

    if (
      symbol === state.symbol
    ) {
      return;
    }

    state.symbol =
      symbol;

    setText(
      "symbolName",
      marketSelect?.selectedOptions?.[0]?.text ||
      symbol
    );

    if (botSymbol) {
      botSymbol.value =
        symbol;
    }

    log(
      `Changing market to ${symbol}.`
    );

    /*
     * Reconnect public stream.
     */

    connectPublicMarket();

    /*
     * Trading WebSocket does not need to be
     * recreated just because the market changed.
     *
     * Proposal will use the new symbol.
     */

    if (
      state.tradingReady
    ) {

      state.proposal = null;

      setTradingButtons(true);

      updateProposal();

    }

  }


  if (marketSelect) {

    marketSelect.value =
      state.symbol;

    setText(
      "symbolName",
      marketSelect.selectedOptions?.[0]?.text ||
      state.symbol
    );

    marketSelect.addEventListener(
      "change",
      event => {

        changeSymbol(
          event.target.value
        );

      }
    );

  }


  if (botSymbol) {

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


/* =======================================================
   ACCOUNT CONTROLS
======================================================= */

function setupAccountControls() {

  const accountSelect =
    $("accountSelect");

  if (accountSelect) {

    accountSelect.addEventListener(
      "change",
      () =>
        updateSelectedAccount(true)
    );

  }

}


/* =======================================================
   TRADING CONTROLS
======================================================= */

function setupTradingControls() {

  const proposalBtn =
    $("quoteBtn");

  const buyBtn =
    $("buyBtn");

  const sellBtn =
    $("sellBtn");

  if (proposalBtn) {

    proposalBtn.onclick =
      updateProposal;

  }

  if (buyBtn) {

    buyBtn.onclick =
      buyContract;

  }

  if (sellBtn) {

    sellBtn.onclick =
      sellOpenContract;

  }

}


/* =======================================================
   STAKE +/- CONTROLS
======================================================= */

function setupStakeControls() {

  document
    .querySelectorAll(".step")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const input =
            $("stake");

          if (!input) {
            return;
          }

          const step =
            Number(
              input.step || 0.01
            );

          const direction =
            Number(
              button.dataset.step
            ) || 0;

          let value =
            Number(
              input.value
            ) || 0;

          value +=
            direction * step;

          const min =
            Number(
              input.min || 0
            );

          value =
            Math.max(
              min,
              value
            );

          input.value =
            value.toFixed(2);

        }
      );

    });

}


/* =======================================================
   PROPOSAL FORM AUTO REFRESH
======================================================= */

function setupProposalInputs() {

  const ids = [
    "stake",
    "duration",
    "durationUnit",
    "contractType",
    "barrier"
  ];

  ids.forEach(id => {

    const element = $(id);

    if (!element) {
      return;
    }

    element.addEventListener(
      "change",
      () => {

        if (
          state.tradingReady
        ) {

          updateProposal();

        }

      }
    );

  });

}


/* =======================================================
   LOG CONTROLS
======================================================= */

function setupLogControls() {

  const clear =
    $("clearLog");

  if (clear) {

    clear.onclick = () => {

      const box =
        $("log");

      if (box) {
        box.textContent = "";
      }

    };

  }

}


/* =======================================================
   PAGE VISIBILITY
======================================================= */

document.addEventListener(
  "visibilitychange",
  () => {

    /*
     * We intentionally do not stop the WebSocket.
     *
     * This allows the predictor's rolling history
     * to remain current when the user returns.
     */

    if (
      !document.hidden &&
      (
        !state.marketWS ||
        state.marketWS.readyState !==
          WebSocket.OPEN
      )
    ) {

      connectPublicMarket();

    }

  }
);


/* =======================================================
   RESIZE
======================================================= */

window.addEventListener(
  "resize",
  drawChart
);


/* =======================================================
   INITIALIZATION
======================================================= */

async function initializeApp() {

  log(
    "TRADERS HUB corrected engine initialized."
  );

  setupAuthButtons();

  setupBotControls();

  setupMarketControls();

  setupAccountControls();

  setupTradingControls();

  setupStakeControls();

  setupProposalInputs();

  setupLogControls();

  resetPredictionUI();

  setTradingButtons(false);

  /*
   * Public market starts independently of login.
   */

  setTimeout(
    () => {

      connectPublicMarket();

    },
    200
  );

  /*
   * Account/trading connection is separate.
   */

  await loadAuthAndAccounts();

}


/* =======================================================
   START
======================================================= */

if (
  document.readyState === "loading"
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
