"use strict";

/*
=========================================================
 TRADERS HUB
 Deriv Options Terminal + Digit Analysis Engine

 IMPORTANT
 ---------------------------------------------------------
 PUBLIC CONNECTION
   - historical ticks
   - live market ticks
   - digit extraction
   - predictor

 AUTHENTICATED CONNECTION
   - balance
   - proposal
   - buy
   - open contract
   - sell

 The predictor is statistical only.
 It does NOT guarantee future outcomes.
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

  const dot =
    $("connectionDot");

  const label =
    $("connectionText");

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

  marketWS: null,

  marketGeneration: 0,

  reconnectTimer: null,

  liveTickTimer: null,

  reconnectAttempts: 0,

  account: null,

  accounts: [],

  tradingWS: null,

  tradingGeneration: 0,

  tradingReady: false,

  tradingConnecting: false,

  proposal: null,

  contractId: null,

  requestId: 100,

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

  const number =
    Number(price);

  if (!Number.isFinite(number)) {
    return null;
  }

  let text;

  const p =
    Number(pipSize);

  if (
    Number.isInteger(p) &&
    p >= 0 &&
    p <= 10
  ) {

    text =
      number.toFixed(p);

  } else {

    text =
      String(price);

  }

  const cleaned =
    text.replace(
      /[^0-9]/g,
      ""
    );

  if (!cleaned.length) {
    return null;
  }

  return Number(
    cleaned[
      cleaned.length - 1
    ]
  );

}


/* =======================================================
   MARKET UI
======================================================= */

function updatePriceUI(
  quote,
  epoch
) {

  const precision =
    Number.isInteger(
      Number(state.pipSize)
    )
      ? Number(state.pipSize)
      : 2;

  setText(
    "price",
    Number(quote).toFixed(
      precision
    )
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

  const change =
    $("priceChange");

  if (
    change &&
    state.previous !== null
  ) {

    const difference =
      Number(quote) -
      Number(state.previous);

    if (difference > 0) {

      change.className =
        "change up";

      change.textContent =
        "UP";

    } else if (difference < 0) {

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

  state.previous =
    Number(quote);

}


/* =======================================================
   CHART
======================================================= */

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
      rect.width
    );

  const height =
    260;

  const dpr =
    window.devicePixelRatio || 1;

  canvas.width =
    Math.floor(
      width * dpr
    );

  canvas.height =
    Math.floor(
      height * dpr
    );

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

  if (
    state.prices.length < 2
  ) {
    return;
  }

  const visible =
    state.prices.slice(
      -100
    );

  const min =
    Math.min(...visible);

  const max =
    Math.max(...visible);

  const range =
    max - min || 1;

  ctx.strokeStyle =
    "#ff3d69";

  ctx.lineWidth =
    2;

  ctx.beginPath();

  visible.forEach(
    (price, index) => {

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


/* =======================================================
   RESET MARKET
======================================================= */

function resetMarketData() {

  state.prices = [];

  state.digits = [];

  state.epochs = [];

  state.previous = null;

  state.pipSize = null;

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
    "priceChange",
    "WAITING"
  );

  const change =
    $("priceChange");

  if (change) {

    change.className =
      "change neutral";

  }

  setText(
    "dataQuality",
    "Collecting ticks…"
  );

  setText(
    "filterStatus",
    "WAITING FOR DATA"
  );

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

  const price =
    Number(quote);

  if (!Number.isFinite(price)) {
    return;
  }

  if (
    Number.isFinite(
      Number(pipSize)
    )
  ) {

    state.pipSize =
      Number(pipSize);

  }

  updatePriceUI(
    price,
    epoch
  );

  state.prices.push(
    price
  );

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

  if (
    Number.isInteger(digit)
  ) {

    state.digits.push(
      digit
    );

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
   REQUEST HISTORICAL DATA
======================================================= */

function loadHistoricalTicks(
  ws,
  symbol
) {

  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN
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

    subscribe:
      0,

    req_id:
      nextRequestId()

  };

  try {

    ws.send(
      JSON.stringify(
        request
      )
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
   REQUEST ONE LIVE TICK
======================================================= */

function requestPublicLiveTick(
  ws,
  symbol
) {

  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN
  ) {
    return;
  }

  const request = {

    ticks:
      symbol,

    subscribe:
      0,

    req_id:
      nextRequestId()

  };

  try {

    ws.send(
      JSON.stringify(
        request
      )
    );

  } catch (error) {

    log(
      "Live tick request failed: " +
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
    state.reconnectTimer
  ) {

    clearTimeout(
      state.reconnectTimer
    );

    state.reconnectTimer =
      null;

  }

  if (
    state.liveTickTimer
  ) {

    clearInterval(
      state.liveTickTimer
    );

    state.liveTickTimer =
      null;

  }

  if (state.marketWS) {

    try {

      state.marketWS.close();

    } catch (_) {}

    state.marketWS =
      null;

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

  const ws =
    new WebSocket(
      "wss://api.derivws.com/trading/v1/options/ws/public"
    );

  state.marketWS =
    ws;

  ws.onopen = () => {

    if (
      generation !==
      state.marketGeneration
    ) {
      return;
    }

    state.reconnectAttempts =
      0;

    setStatus(
      true,
      "Market online"
    );

    log(
      "Public market WebSocket connected."
    );

    loadHistoricalTicks(
      ws,
      symbol
    );

    /*
     * The current Options public endpoint in this
     * application rejected the subscription request
     * used by the previous version.
     *
     * Therefore request one tick at a time.
     */

    requestPublicLiveTick(
      ws,
      symbol
    );

    if (
      state.liveTickTimer
    ) {

      clearInterval(
        state.liveTickTimer
      );

    }

    state.liveTickTimer =
      setInterval(
        () => {

          if (
            generation !==
            state.marketGeneration
          ) {
            return;
          }

          if (
            state.marketWS &&
            state.marketWS.readyState ===
              WebSocket.OPEN
          ) {

            requestPublicLiveTick(
              state.marketWS,
              state.symbol
            );

          }

        },
        1000
      );

    log(
      `Live tick polling started: ${symbol}`
    );

  };


  ws.onmessage = (
    event
  ) => {

    if (
      generation !==
      state.marketGeneration
    ) {
      return;
    }

    try {

      const data =
        JSON.parse(
          event.data
        );

      if (data.error) {

        log(
          "Market API error",
          data.error
        );

        return;

      }


      /* =================================================
         HISTORY
      ================================================= */

      if (
        data.msg_type ===
          "history" &&
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
            Number(
              data.pip_size
            );

        }

        state.prices =
          prices
            .map(Number)
            .filter(
              Number.isFinite
            )
            .slice(
              -state.bot.historyLimit
            );

        state.epochs =
          times
            .map(Number)
            .filter(
              Number.isFinite
            )
            .slice(
              -state.bot.historyLimit
            );

        state.digits =
          state.prices
            .map(
              price =>
                digitFromPrice(
                  price,
                  state.pipSize
                )
            )
            .filter(
              Number.isInteger
            )
            .slice(
              -state.bot.historyLimit
            );

        if (
          state.prices.length
        ) {

          const latest =
            state.prices[
              state.prices.length - 1
            ];

          const latestTime =
            state.epochs[
              state.epochs.length - 1
            ];

          updatePriceUI(
            latest,
            latestTime
          );

          const latestDigit =
            digitFromPrice(
              latest,
              state.pipSize
            );

          if (
            Number.isInteger(
              latestDigit
            )
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


      /* =================================================
         DIRECT TICK
      ================================================= */

      if (
        data.msg_type ===
          "tick" &&
        data.tick
      ) {

        processMarketTick(
          data.tick.quote,
          data.tick.epoch,
          data.tick.pip_size ??
            data.pip_size ??
            state.pipSize
        );

        return;

      }


      /*
       * Some responses may contain tick directly
       * without the expected msg_type.
       */

      if (
        data.tick &&
        data.tick.quote !== undefined
      ) {

        processMarketTick(
          data.tick.quote,
          data.tick.epoch,
          data.tick.pip_size ??
            data.pip_size ??
            state.pipSize
        );

      }

    } catch (error) {

      log(
        "Market message error: " +
        error.message
      );

    }

  };


  ws.onerror = () => {

    setStatus(
      false,
      "Market error"
    );

    log(
      "Market WebSocket error."
    );

  };


  ws.onclose = () => {

    if (
      state.liveTickTimer
    ) {

      clearInterval(
        state.liveTickTimer
      );

      state.liveTickTimer =
        null;

    }

    if (
      generation !==
      state.marketGeneration
    ) {
      return;
    }

    state.marketWS =
      null;

    setStatus(
      false,
      "Market offline"
    );

    log(
      "Market disconnected."
    );

    const delay =
      Math.min(
        15000,
        2000 *
        Math.pow(
          2,
          state.reconnectAttempts
        )
      );

    state.reconnectAttempts =
      Math.min(
        state.reconnectAttempts + 1,
        4
      );

    state.reconnectTimer =
      setTimeout(
        () => {

          if (
            generation ===
            state.marketGeneration
          ) {

            connectPublicMarket();

          }

        },
        delay
      );

  };

}


/* =======================================================
   PREDICTION MODEL HELPERS
======================================================= */

function normalizeDistribution(
  values
) {

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

  if (
    total <= 0
  ) {

    return Array(
      10
    ).fill(
      0.1
    );

  }

  return values.map(
    value =>
      Math.max(
        0,
        Number(value) || 0
      ) /
      total
  );

}


/* =======================================================
   RECENCY MODEL
======================================================= */

function recencyDistribution(
  digits
) {

  const scores =
    Array(10).fill(0);

  const decay =
    0.985;

  let weight =
    1;

  for (
    let i =
      digits.length - 1;
    i >= 0;
    i--
  ) {

    const digit =
      digits[i];

    if (
      Number.isInteger(digit)
    ) {

      scores[digit] +=
        weight;

    }

    weight *=
      decay;

  }

  return normalizeDistribution(
    scores
  );

}


/* =======================================================
   WINDOW MODEL
======================================================= */

function windowDistribution(
  digits,
  windowSize
) {

  const window =
    digits.slice(
      -windowSize
    );

  const counts =
    Array(10).fill(1);

  window.forEach(
    digit => {

      if (
        Number.isInteger(digit)
      ) {

        counts[digit] +=
          1;

      }

    }
  );

  return normalizeDistribution(
    counts
  );

}


/* =======================================================
   TRANSITION MODEL
======================================================= */

function transitionDistribution(
  digits
) {

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

      counts[
        previous
      ][
        current
      ] += 1;

    }

  }

  const last =
    digits[
      digits.length - 1
    ];

  if (
    !Number.isInteger(last)
  ) {

    return Array(
      10
    ).fill(
      0.1
    );

  }

  return normalizeDistribution(
    counts[last]
  );

}


/* =======================================================
   TWO DIGIT CONTEXT
======================================================= */

function contextDistribution(
  digits
) {

  if (
    digits.length < 3
  ) {

    return Array(
      10
    ).fill(
      0.1
    );

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

        counts[next] +=
          3;

      }

    }

  }

  return normalizeDistribution(
    counts
  );

}


/* =======================================================
   DIGIT ENSEMBLE
======================================================= */

function buildDigitModel(
  digits
) {

  const recent =
    recencyDistribution(
      digits
    );

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
    transitionDistribution(
      digits
    );

  const context =
    contextDistribution(
      digits
    );

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
    normalizeDistribution(
      scores
    );

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
      first?.digit ??
      null,

    probability:
      first?.probability ??
      0,

    secondProbability:
      second?.probability ??
      0,

    margin:
      first
        ? (
            first.probability -
            (
              second?.probability ||
              0
            )
          ) * 100
        : 0

  };

}


/* =======================================================
   WALK FORWARD VALIDATION
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
      total -
        sampleCount
    );

  let wins =
    0;

  let samples =
    0;

  const probabilityHits =
    [];

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
      buildDigitModel(
        training
      );

    const actual =
      digits[i];

    if (
      model.prediction ===
      actual
    ) {

      wins++;

    }

    probabilityHits.push(
      model.probabilities[
        actual
      ] || 0
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
   BINARY WALK FORWARD MODEL
======================================================= */

function classifyBinary(
  digits,
  classifier
) {

  if (
    digits.length < 2
  ) {

    return {

      prediction:
        null,

      probability:
        0,

      wins:
        0,

      samples:
        0,

      accuracy:
        0

    };

  }

  const values =
    digits.map(
      classifier
    );

  const recent =
    values.slice(
      -60
    );

  let positive =
    0;

  let negative =
    0;

  recent.forEach(
    value => {

      if (value) {

        positive++;

      } else {

        negative++;

      }

    }
  );

  const prediction =
    positive >=
    negative;

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
      values.length -
        120
    );

  let wins =
    0;

  let samples =
    0;

  for (
    let i =
      validationStart;
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
      training.slice(
        -60
      );

    let p =
      0;

    let n =
      0;

    window.forEach(
      value => {

        if (value) {
          p++;
        } else {
          n++;
        }

      }
    );

    const predicted =
      p >= n;

    if (
      predicted ===
      values[i]
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
    buildDigitModel(
      digits
    );

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

    digits:
      digits.length,

    match: {

      prediction:
        digitModel.prediction,

      probability:
        digitModel.probability *
        100,

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
        digitModel.ranking.slice(
          0,
          3
        )

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

  const element =
    $(id);

  if (!element) {
    return;
  }

  element.className =
    `signal ${type}`;

  element.textContent =
    text;

  if (
    type === "good"
  ) {

    element.style.fontWeight =
      "800";

    element.style.border =
      "2px solid #22c55e";

    element.style.boxShadow =
      "0 0 12px rgba(34,197,94,.35)";

  } else {

    element.style.fontWeight =
      "600";

    element.style.border =
      "";

    element.style.boxShadow =
      "";

  }

}


/* =======================================================
   PREDICTION RESET
======================================================= */

function resetPredictionUI() {

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

  setText(
    "matchAcc",
    "—"
  );

  setText(
    "matchWins",
    "—"
  );

  setText(
    "matchSamples",
    "—"
  );

  setText(
    "evenAcc",
    "—"
  );

  setText(
    "evenWins",
    "—"
  );

  setText(
    "evenSamples",
    "—"
  );

  setText(
    "ouAcc",
    "—"
  );

  setText(
    "ouWins",
    "—"
  );

  setText(
    "ouSamples",
    "—"
  );

  renderPredictionPanel(null);

}


/* =======================================================
   PREDICTION PANEL
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
   UPDATE PREDICTION
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

    renderPredictionPanel(
      null
    );

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
    ]
      .filter(Boolean)
      .length;

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
   AUTH / ACCOUNT
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

    if (
      !auth.authenticated
    ) {

      state.account =
        null;

      state.accounts =
        [];

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

    accountSelect.disabled =
      true;

    accountSelect.innerHTML =
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

  setText(
    "accountBadge",
    "NOT LOGGED IN"
  );

  setTradingButtons(
    false
  );

}


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

  let accounts =
    [];

  if (
    Array.isArray(payload)
  ) {

    accounts =
      payload;

  } else if (
    Array.isArray(payload.data)
  ) {

    accounts =
      payload.data;

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

  accountSelect.innerHTML =
    "";

  if (
    !accounts.length
  ) {

    accountSelect.innerHTML =
      '<option value="">No accounts found</option>';

    accountSelect.disabled =
      true;

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
        document.createElement(
          "option"
        );

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

  accountSelect.disabled =
    false;

  accountSelect.selectedIndex =
    0;

  updateSelectedAccount(
    false
  );

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

    state.account =
      null;

    setTradingButtons(
      false
    );

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
    selected.dataset.balance ||
      "—"
  );

  setText(
    "currency",
    selected.dataset.currency ||
      "—"
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

    loginBtn.onclick =
      () => {

        window.location.href =
          "/auth/login";

      };

  }

  if (logoutBtn) {

    logoutBtn.onclick =
      async () => {

        try {

          logoutBtn.disabled =
            true;

          await fetch(
            "/auth/logout",
            {
              method:
                "POST",
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
   TRADING CONNECTION
======================================================= */

async function connectTradingForSelectedAccount() {

  if (
    !state.account
  ) {

    setTradingButtons(
      false
    );

    return;

  }

  const accountId =
    state.account.account_id ||
    state.account.accountId ||
    state.account.loginid ||
    state.account.login_id;

  if (!accountId) {
    return;
  }

  const generation =
    ++state.tradingGeneration;

  state.tradingReady =
    false;

  if (state.tradingWS) {

    try {

      state.tradingWS.close();

    } catch (_) {}

    state.tradingWS =
      null;

  }

  setTradingButtons(
    false
  );

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
          method:
            "POST",

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

    if (
      !response.ok
    ) {

      throw new Error(
        payload?.error ||
        payload?.message ||
        `HTTP ${response.status}`
      );

    }

    const url =
      payload?.url ||
      payload?.data?.url;

    if (!url) {

      throw new Error(
        "Deriv did not return a WebSocket URL."
      );

    }

    const ws =
      new WebSocket(
        url
      );

    state.tradingWS =
      ws;

    ws.onopen =
      () => {

        if (
          generation !==
          state.tradingGeneration
        ) {
          return;
        }

        state.tradingConnecting =
          false;

        state.tradingReady =
          true;

        setText(
          "accountBadge",
          "TRADE READY"
        );

        setTradingButtons(
          true
        );

        log(
          "Authenticated trading WebSocket connected."
        );

        sendTrading({

          balance:
            1,

          subscribe:
            1,

          req_id:
            nextRequestId()

        });

        sendTrading({

          ticks:
            state.symbol,

          subscribe:
            1,

          req_id:
            nextRequestId()

        });

        updateProposal();

      };

    ws.onmessage =
      event => {

        if (
          generation !==
          state.tradingGeneration
        ) {
          return;
        }

        try {

          const data =
            JSON.parse(
              event.data
            );

          handleTradingMessage(
            data
          );

        } catch (error) {

          log(
            "Trading message parse error: " +
            error.message
          );

        }

      };

    ws.onerror =
      () => {

        state.tradingReady =
          false;

        setTradingButtons(
          false
        );

        setText(
          "accountBadge",
          "TRADE ERROR"
        );

        log(
          "Trading WebSocket error."
        );

      };

    ws.onclose =
      () => {

        if (
          generation !==
          state.tradingGeneration
        ) {
          return;
        }

        state.tradingReady =
          false;

        state.tradingWS =
          null;

        setTradingButtons(
          false
        );

        setText(
          "accountBadge",
          "TRADE OFFLINE"
        );

        log(
          "Trading WebSocket disconnected."
        );

      };

  } catch (error) {

    state.tradingReady =
      false;

    setTradingButtons(
      false
    );

    setText(
      "accountBadge",
      "TRADE ERROR"
    );

    log(
      "Trading connection error: " +
      error.message
    );

  }

}


/* =======================================================
   TRADING BUTTON STATE
======================================================= */

function setTradingButtons(
  enabled
) {

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

function sendTrading(
  payload
) {

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
    JSON.stringify(
      payload
    )
  );

}


/* =======================================================
   TRADING MESSAGE
======================================================= */

function handleTradingMessage(
  data
) {

  if (data.error) {

    log(
      "Deriv trading error",
      data.error
    );

    return;

  }


  /* BALANCE */

  if (
    data.msg_type ===
      "balance" &&
    data.balance
  ) {

    setText(
      "balance",
      data.balance.balance ??
        "—"
    );

    setText(
      "currency",
      data.balance.currency ??
        "—"
    );

    return;

  }


  /* PROPOSAL */

  if (
    data.msg_type ===
      "proposal" &&
    data.proposal
  ) {

    state.proposal =
      data.proposal;

    setText(
      "askPrice",
      data.proposal.ask_price ??
        "—"
    );

    setText(
      "payout",
      data.proposal.payout ??
        "—"
    );

    setText(
      "proposalId",
      data.proposal.id ??
        "—"
    );

    setTradingButtons(
      true
    );

    log(
      "Live proposal received.",
      data.proposal
    );

    return;

  }


  /* BUY */

  if (
    data.msg_type ===
      "buy" &&
    data.buy
  ) {

    state.contractId =
      data.buy.contract_id;

    setText(
      "contractId",
      data.buy.contract_id ??
        "—"
    );

    setText(
      "contractStatus",
      "OPEN"
    );

    setText(
      "contractProfit",
      "0"
    );

    setText(
      "contractBuyPrice",
      data.buy.buy_price ??
        "—"
    );

    setTradingButtons(
      true
    );

    log(
      "Contract purchased.",
      data.buy
    );

    if (
      data.buy.contract_id
    ) {

      sendTrading({

        proposal_open_contract:
          1,

        contract_id:
          Number(
            data.buy.contract_id
          ),

        subscribe:
          1,

        req_id:
          nextRequestId()

      });

    }

    return;

  }


  /* OPEN CONTRACT */

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
      contract.contract_id ??
        "—"
    );

    setText(
      "contractStatus",
      contract.status ??
        "—"
    );

    setText(
      "contractProfit",
      contract.profit ??
        "—"
    );

    setText(
      "contractBuyPrice",
      contract.buy_price ??
        "—"
    );

    setTradingButtons(
      true
    );

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
      $("stake")?.value ||
      1
    );

  const duration =
    Number(
      $("duration")?.value ||
      1
    );

  const durationUnit =
    $("durationUnit")?.value ||
    "t";

  let contractType =
    $("contractType")?.value ||
    "DIGITMATCH";

  const barrierInput =
    $("barrier")?.value;


  const request = {

    proposal:
      1,

    amount:
      Number.isFinite(amount)
        ? amount
        : 1,

    basis:
      "stake",

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


  /*
   * Digit contracts require a barrier.
   *
   * If the user selected MATCHES and there is a
   * validated prediction, use the predicted digit.
   *
   * Otherwise use the manually entered barrier.
   */

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


    if (
      (
        contractType ===
          "DIGITOVER" ||
        contractType ===
          "DIGITUNDER"
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
   * Proposal subscriptions are valid on the
   * authenticated trading connection.
   */

  request.subscribe =
    1;


  try {

    sendTrading(
      request
    );

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

  if (
    !state.tradingReady
  ) {

    log(
      "Cannot buy: trading connection is not ready."
    );

    return;

  }

  if (
    !state.proposal?.id
  ) {

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
    !Number.isFinite(
      askPrice
    )
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

  if (
    !state.tradingReady
  ) {

    log(
      "Trading connection is not ready."
    );

    return;

  }

  if (
    !state.contractId
  ) {

    log(
      "No open contract selected."
    );

    return;

  }

  try {

    sendTrading({

      sell:
        Number(
          state.contractId
        ),

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

    refresh.onclick =
      () => {

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


  function changeSymbol(
    symbol
  ) {

    if (!symbol) {
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

    connectPublicMarket();

    if (
      state.account
    ) {

      connectTradingForSelectedAccount();

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
        updateSelectedAccount(
          true
        )
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
    .querySelectorAll(
      ".step"
    )
    .forEach(
      button => {

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
                input.step ||
                0.01
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
              direction *
              step;

            const min =
              Number(
                input.min ||
                0
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

      }
    );

}


/* =======================================================
   LOG CONTROLS
======================================================= */

function setupLogControls() {

  const clear =
    $("clearLog");

  if (clear) {

    clear.onclick =
      () => {

        const box =
          $("log");

        if (box) {
          box.textContent = "";
        }

      };

  }

}


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
    "TRADERS HUB upgraded engine initialized."
  );

  setupAuthButtons();

  setupBotControls();

  setupMarketControls();

  setupAccountControls();

  setupTradingControls();

  setupStakeControls();

  setupLogControls();

  resetPredictionUI();

  setTradingButtons(
    false
  );

  setTimeout(
    () => {

      connectPublicMarket();

    },
    200
  );

  await loadAuthAndAccounts();

}


/* =======================================================
   START
======================================================= */

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
