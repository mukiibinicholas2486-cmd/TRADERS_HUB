/* =========================================================
   TRADERS HUB — ADVANCED APP.JS
   Deriv Options Terminal + Live Digit Prediction Engine

   IMPORTANT:
   - Public market data uses the current Deriv Options API.
   - Prediction is statistical, NOT guaranteed.
   - Confidence is based on walk-forward validation.
   - Trading/account connection is kept separate from
     the public market connection.
   ========================================================= */

"use strict";


/* =========================================================
   HELPERS
   ========================================================= */

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


function percentage(value) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "—";
  }

  return `${n.toFixed(1)}%`;

}


function clamp(value, min, max) {

  return Math.max(
    min,
    Math.min(max, value)
  );

}


/* =========================================================
   GLOBAL STATE
   ========================================================= */

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

  reconnectAttempts: 0,

  account: null,

  accounts: [],

  tradingWS: null,

  tradingGeneration: 0,

  tradingConnecting: false,

  tradingReady: false,

  proposal: null,

  contractId: null,

  requestId: 100,

  pendingRequests: new Map(),

  bot: {

    historyLimit: 500,

    analysisWindow: 240,

    minimumSamples: 60,

    validationSamples: 120,

    highConfidenceAccuracy: 80,

    highConfidenceProbability: 20,

    minimumMargin: 5,

    threshold: 4,

    lastStats: null

  }

};


/* =========================================================
   REQUEST ID
   ========================================================= */

function nextRequestId() {

  state.requestId += 1;

  return state.requestId;

}


/* =========================================================
   DIGIT EXTRACTION
   ========================================================= */

/*
 * Deriv supplies pip_size on historical data.
 *
 * Using pip_size is more reliable than simply converting
 * a number to String(), because JavaScript can remove
 * trailing decimal zeroes.
 */

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


  let text;


  if (
    Number.isInteger(Number(pipSize)) &&
    Number(pipSize) >= 0 &&
    Number(pipSize) <= 10
  ) {

    text =
      number.toFixed(
        Number(pipSize)
      );

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


/* =========================================================
   MARKET UI
   ========================================================= */

function updatePriceUI(
  quote,
  epoch
) {

  setText(
    "price",
    Number(quote).toFixed(
      state.pipSize ?? 2
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


  /* GRID */

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
    Math.min(
      ...visible
    );


  const max =
    Math.max(
      ...visible
    );


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


/* =========================================================
   RESET MARKET
   ========================================================= */

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


/* =========================================================
   MARKET TICK
   ========================================================= */

function processMarketTick(
  quote,
  epoch,
  pipSize = null
) {

  const price =
    Number(quote);


  if (
    !Number.isFinite(price)
  ) {
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
    Number(epoch) || Date.now() / 1000
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
    digit !== null
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


  /*
   * Do not wait for a manual refresh.
   * The prediction is recalculated after every tick.
   */

  updatePredictionBot();

}


/* =========================================================
   HISTORICAL TICKS
   ========================================================= */

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


  ws.send(
    JSON.stringify({

      ticks_history:
        symbol,

      count:
        state.bot.historyLimit,

      end:
        "latest",

      style:
        "ticks",

      subscribe:
        0

    })
  );


  log(
    `Requested ${state.bot.historyLimit} historical ticks for ${symbol}.`
  );

}


/* =========================================================
   PUBLIC MARKET WEBSOCKET
   ========================================================= */

function connectPublicMarket() {

  const generation =
    ++state.marketGeneration;


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


  if (
    state.reconnectTimer
  ) {

    clearTimeout(
      state.reconnectTimer
    );

    state.reconnectTimer =
      null;

  }


  resetMarketData();


  setStatus(
    false,
    "Connecting..."
  );


  const symbol =
    state.symbol ||
    "1HZ100V";


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


    /*
     * Historical data first.
     */

    loadHistoricalTicks(
      ws,
      symbol
    );


    /*
     * Then subscribe to live ticks.
     */

    ws.send(
      JSON.stringify({

        ticks:
          symbol,

        subscribe:
          1

      })
    );


    log(
      `Subscribed to live ticks: ${symbol}`
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
          "Deriv market error",
          data.error
        );

        return;

      }


      /* =====================================================
         HISTORY
         ===================================================== */

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


        state.pipSize =
          Number.isFinite(
            Number(
              data.pip_size
            )
          )
            ? Number(
                data.pip_size
              )
            : state.pipSize;


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
              digit =>
                Number.isInteger(digit)
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
            latestDigit !== null
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


      /* =====================================================
         LIVE TICK
         ===================================================== */

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

      }

    } catch (error) {

      console.error(
        "Market message error:",
        error
      );

      log(
        "Market message error: " +
        error.message
      );

    }

  };


  ws.onerror = (
    error
  ) => {

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


  ws.onclose = () => {

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


/* =========================================================
   ADVANCED PREDICTION ENGINE
   ========================================================= */


/*
 * The model is deliberately transparent.
 *
 * It combines:
 *
 * 1. Recency-weighted digit frequency
 * 2. Short-term frequency
 * 3. Previous-digit transition probability
 * 4. Last-two-digit context
 *
 * These are blended into one probability distribution.
 *
 * This does NOT claim to predict a random process with certainty.
 */


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


/* =========================================================
   MODEL: RECENCY FREQUENCY
   ========================================================= */

function recencyDistribution(
  digits
) {

  const scores =
    Array(10).fill(0);


  /*
   * Exponential decay.
   * Newer ticks receive more weight.
   */

  const decay =
    0.985;


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


/* =========================================================
   MODEL: SHORT WINDOW
   ========================================================= */

function shortWindowDistribution(
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

        counts[digit] += 1;

      }

    }
  );


  return normalizeDistribution(
    counts
  );

}


/* =========================================================
   MODEL: PREVIOUS DIGIT TRANSITIONS
   ========================================================= */

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


/* =========================================================
   MODEL: TWO-DIGIT CONTEXT
   ========================================================= */

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

        counts[next] += 3;

      }

    }

  }


  return normalizeDistribution(
    counts
  );

}


/* =========================================================
   ENSEMBLE
   ========================================================= */

function buildDigitModel(
  digits
) {

  const recent =
    recencyDistribution(
      digits
    );


  const short =
    shortWindowDistribution(
      digits,
      40
    );


  const medium =
    shortWindowDistribution(
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


  const finalScores =
    Array(10).fill(0);


  for (
    let digit = 0;
    digit < 10;
    digit++
  ) {

    finalScores[digit] =
      (
        recent[digit] *
        0.30
      ) +
      (
        short[digit] *
        0.20
      ) +
      (
        medium[digit] *
        0.15
      ) +
      (
        transition[digit] *
        0.20
      ) +
      (
        context[digit] *
        0.15
      );

  }


  const probabilities =
    normalizeDistribution(
      finalScores
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


  return {

    probabilities,

    ranking,

    prediction:
      ranking[0]?.digit ?? null,

    probability:
      ranking[0]?.probability ?? 0,

    secondProbability:
      ranking[1]?.probability ?? 0,

    margin:
      ranking[0]
        ? (
            ranking[0].probability -
            (
              ranking[1]?.probability || 0
            )
          ) * 100
        : 0

  };

}


/* =========================================================
   WALK-FORWARD VALIDATION
   ========================================================= */

/*
 * Critical difference from the previous engine:
 *
 * The validation does NOT train on the future.
 *
 * For each historical point:
 *
 *   history before point -> model -> prediction -> compare
 *
 * This gives a much more honest estimate of how the
 * current model has behaved on unseen ticks.
 */

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
      training.length <
      30
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


/* =========================================================
   CLASSIFIER
   ========================================================= */

function classifyBinary(
  digits,
  classifier
) {

  const values =
    digits.map(
      classifier
    );


  const total =
    values.length;


  if (
    total < 2
  ) {

    return {

      prediction: null,

      probability: 0,

      wins: 0,

      samples: 0,

      accuracy: 0

    };

  }


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


  /*
   * Walk-forward validation.
   */

  const validationStart =
    Math.max(
      1,
      total - 120
    );


  let wins =
    0;

  let samples =
    0;


  for (
    let i = validationStart;
    i < total;
    i++
  ) {

    const train =
      values.slice(
        0,
        i
      );


    if (
      train.length <
      30
    ) {
      continue;
    }


    const window =
      train.slice(
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


    const modelPrediction =
      p >= n;


    if (
      modelPrediction ===
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


/* =========================================================
   OVER / UNDER
   ========================================================= */

function calculateOverUnder(
  digits,
  threshold
) {

  const values =
    digits.map(
      digit =>
        digit >
        threshold
    );


  return classifyBinary(
    values,
    value => value
  );

}


/* =========================================================
   EVEN / ODD
   ========================================================= */

function calculateEvenOdd(
  digits
) {

  return classifyBinary(
    digits,
    digit =>
      digit % 2 === 0
  );

}


/* =========================================================
   FULL PREDICTION
   ========================================================= */

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
    calculateEvenOdd(
      digits
    );


  const over =
    calculateOverUnder(
      digits,
      state.bot.threshold
    );


  /*
   * A model is considered HIGH confidence only when:
   *
   * 1. Enough historical samples exist.
   * 2. Walk-forward accuracy >= 80%.
   * 3. Current predicted probability is meaningful.
   * 4. For digit predictions, the top prediction has
   *    a meaningful margin over second place.
   */

  const matchHigh =
    validation.samples >=
      state.bot.minimumSamples &&
    validation.accuracy >=
      state.bot.highConfidenceAccuracy &&
    digitModel.probability * 100 >=
      state.bot.highConfidenceProbability &&
    digitModel.margin >=
      state.bot.minimumMargin;


  const evenHigh =
    even.samples >=
      state.bot.minimumSamples &&
    even.accuracy >=
      state.bot.highConfidenceAccuracy &&
    even.probability >=
      state.bot.highConfidenceProbability;


  const overHigh =
    over.samples >=
      state.bot.minimumSamples &&
    over.accuracy >=
      state.bot.highConfidenceAccuracy &&
    over.probability >=
      state.bot.highConfidenceProbability;


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


/* =========================================================
   PREDICTION BADGE
   ========================================================= */

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


  /*
   * Force visual highlighting even if the existing CSS
   * does not yet have a dedicated high-confidence class.
   */

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


/* =========================================================
   PREDICTION UI RESET
   ========================================================= */

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


  removePredictionBadge();

}


/* =========================================================
   EXTRA PREDICTION DISPLAY
   ========================================================= */

/*
 * If the current HTML only has the old signal fields,
 * create a prominent prediction panel dynamically.
 */

function getPredictionContainer() {

  let container =
    $("advancedPredictionDisplay");


  if (container) {
    return container;
  }


  const engine =
    document.querySelector(
      ".prediction-engine"
    ) ||
    document.querySelector(
      "[class*='prediction']"
    );


  /*
   * If we cannot find the prediction engine container,
   * simply use the existing signal elements.
   */

  if (!engine) {
    return null;
  }


  container =
    document.createElement(
      "div"
    );


  container.id =
    "advancedPredictionDisplay";


  container.style.cssText = `
    margin: 10px 0;
    padding: 12px;
    border-radius: 10px;
    background: #080d17;
    border: 1px solid #273044;
    font-family: inherit;
  `;


  engine.prepend(
    container
  );


  return container;

}


function removePredictionBadge() {

  const container =
    $("advancedPredictionDisplay");


  if (container) {

    container.innerHTML =
      `
        <div style="
          font-size:12px;
          color:#94a3b8;
          font-weight:700;
          letter-spacing:.04em;
        ">
          LIVE PREDICTION
        </div>

        <div style="
          margin-top:5px;
          color:#64748b;
          font-size:13px;
        ">
          Waiting for enough validated ticks…
        </div>
      `;

  }

}


/* =========================================================
   RENDER ADVANCED PREDICTION
   ========================================================= */

function renderAdvancedPrediction(
  prediction
) {

  const container =
    getPredictionContainer();


  if (!container) {
    return;
  }


  const top =
    prediction.match.ranking;


  const topDigits =
    top
      .map(
        item =>
          `<span style="
             display:inline-block;
             margin-right:6px;
             padding:4px 7px;
             border-radius:6px;
             background:#111827;
             color:#cbd5e1;
             font-weight:800;
           ">
             ${item.digit}
             <small style="
               color:#94a3b8;
               font-weight:600;
             ">
               ${(item.probability * 100).toFixed(1)}%
             </small>
           </span>`
      )
      .join("");


  const matchColor =
    prediction.match.highConfidence
      ? "#22c55e"
      : "#f59e0b";


  const evenColor =
    prediction.even.highConfidence
      ? "#22c55e"
      : "#f59e0b";


  const overColor =
    prediction.over.highConfidence
      ? "#22c55e"
      : "#f59e0b";


  container.innerHTML =
    `
      <div style="
        font-size:11px;
        color:#94a3b8;
        font-weight:800;
        letter-spacing:.06em;
      ">
        LIVE VALIDATED PREDICTION
      </div>

      <div style="
        display:grid;
        grid-template-columns:
          repeat(3,minmax(0,1fr));
        gap:8px;
        margin-top:8px;
      ">

        <div style="
          padding:10px;
          border-radius:9px;
          background:#0d1420;
          border:
            2px solid ${matchColor};
        ">

          <div style="
            font-size:10px;
            color:#94a3b8;
            font-weight:800;
          ">
            MATCHES
          </div>

          <div style="
            margin-top:3px;
            font-size:25px;
            font-weight:900;
            color:${matchColor};
          ">
            ${prediction.match.prediction}
          </div>

          <div style="
            font-size:11px;
            color:#cbd5e1;
          ">
            ${prediction.match.probability.toFixed(1)}%
            model probability
          </div>

          <div style="
            margin-top:4px;
            font-size:10px;
            color:#94a3b8;
          ">
            ${prediction.match.accuracy.toFixed(1)}%
            walk-forward accuracy
          </div>

        </div>


        <div style="
          padding:10px;
          border-radius:9px;
          background:#0d1420;
          border:
            2px solid ${evenColor};
        ">

          <div style="
            font-size:10px;
            color:#94a3b8;
            font-weight:800;
          ">
            EVEN / ODD
          </div>

          <div style="
            margin-top:3px;
            font-size:19px;
            font-weight:900;
            color:${evenColor};
          ">
            ${prediction.even.prediction}
          </div>

          <div style="
            font-size:11px;
            color:#cbd5e1;
          ">
            ${prediction.even.probability.toFixed(1)}%
            model probability
          </div>

          <div style="
            margin-top:4px;
            font-size:10px;
            color:#94a3b8;
          ">
            ${prediction.even.accuracy.toFixed(1)}%
            validation
          </div>

        </div>


        <div style="
          padding:10px;
          border-radius:9px;
          background:#0d1420;
          border:
            2px solid ${overColor};
        ">

          <div style="
            font-size:10px;
            color:#94a3b8;
            font-weight:800;
          ">
            OVER / UNDER
          </div>

          <div style="
            margin-top:3px;
            font-size:17px;
            font-weight:900;
            color:${overColor};
          ">
            ${prediction.over.prediction}
            ${prediction.over.threshold}
          </div>

          <div style="
            font-size:11px;
            color:#cbd5e1;
          ">
            ${prediction.over.probability.toFixed(1)}%
            model probability
          </div>

          <div style="
            margin-top:4px;
            font-size:10px;
            color:#94a3b8;
          ">
            ${prediction.over.accuracy.toFixed(1)}%
            validation
          </div>

        </div>

      </div>


      <div style="
        margin-top:9px;
        font-size:10px;
        color:#64748b;
      ">
        TOP DIGITS:
        ${topDigits}
      </div>
    `;

}


/* =========================================================
   UPDATE PREDICTION ENGINE
   ========================================================= */

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


    setBotText(
      "dataQuality",
      `Collecting ticks… ${digits.length}/${state.bot.minimumSamples}`
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
      `${remaining} more ticks needed`
    );


    setBotText(
      "evenConf",
      `${remaining} more ticks needed`
    );


    setBotText(
      "ouConf",
      `${remaining} more ticks needed`
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


  /* =======================================================
     MATCH
     ======================================================= */

  setBotText(
    "matchAcc",
    percentage(
      prediction.match.accuracy
    )
  );


  setBotText(
    "matchWins",
    prediction.match.wins
  );


  setBotText(
    "matchSamples",
    prediction.match.samples
  );


  const matchText =
    prediction.match.highConfidence

      ? `MATCH ${prediction.match.prediction}`

      : `MATCH ${prediction.match.prediction}`;


  setSignal(
    "matchSignal",
    prediction.match.highConfidence
      ? "good"
      : "neutral",
    matchText
  );


  setBotText(
    "matchConf",
    prediction.match.highConfidence
      ? `HIGH CONFIDENCE • ${prediction.match.probability.toFixed(1)}%`
      : `LOW CONFIDENCE • ${prediction.match.probability.toFixed(1)}%`
  );


  /*
   * The actual predicted digit is always shown.
   */

  setText(
    "botDigit",
    prediction.match.prediction
  );


  /* =======================================================
     EVEN / ODD
     ======================================================= */

  setBotText(
    "evenAcc",
    percentage(
      prediction.even.accuracy
    )
  );


  setBotText(
    "evenWins",
    prediction.even.wins
  );


  setBotText(
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


  setBotText(
    "evenConf",
    prediction.even.highConfidence
      ? `HIGH CONFIDENCE • ${prediction.even.probability.toFixed(1)}%`
      : `LOW CONFIDENCE • ${prediction.even.probability.toFixed(1)}%`
  );


  /* =======================================================
     OVER / UNDER
     ======================================================= */

  setBotText(
    "ouAcc",
    percentage(
      prediction.over.accuracy
    )
  );


  setBotText(
    "ouWins",
    prediction.over.wins
  );


  setBotText(
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


  setBotText(
    "ouConf",
    prediction.over.highConfidence
      ? `HIGH CONFIDENCE • ${prediction.over.probability.toFixed(1)}%`
      : `LOW CONFIDENCE • ${prediction.over.probability.toFixed(1)}%`
  );


  /* =======================================================
     GLOBAL FILTER
     ======================================================= */

  const highCount =
    [
      prediction.match.highConfidence,
      prediction.even.highConfidence,
      prediction.over.highConfidence
    ]
    .filter(Boolean)
    .length;


  if (
    highCount > 0
  ) {

    setBotText(
      "filterStatus",
      `${highCount} HIGH-CONFIDENCE SIGNAL${highCount > 1 ? "S" : ""}`
    );

  } else {

    setBotText(
      "filterStatus",
      "NO VALIDATED HIGH-CONFIDENCE SIGNAL"
    );

  }


  setBotText(
    "dataQuality",
    `${digits.length} ticks analysed`
  );


  renderAdvancedPrediction(
    prediction
  );

}


/* =========================================================
   GENERIC BOT TEXT
   ========================================================= */

function setBotText(
  id,
  text
) {

  setText(
    id,
    text
  );

}


/* =========================================================
   ACCOUNT / AUTH
   ========================================================= */

async function loadAuthAndAccounts() {

  const loginBtn =
    $("loginBtn");


  const logoutBtn =
    $("logoutBtn");


  const accountSelect =
    $("accountSelect");


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
        "Authentication status request failed."
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


    if (loginBtn) {

      loginBtn.style.display =
        "none";

    }


    if (logoutBtn) {

      logoutBtn.style.display =
        "";

    }


    setText(
      "accountBadge",
      "LOGGED IN"
    );


    await loadAccounts();


    /*
     * Automatically establish authenticated trading
     * WebSocket once an account exists.
     */

    await connectTradingForSelectedAccount();

  } catch (error) {

    console.error(
      "Authentication error:",
      error
    );


    setText(
      "accountBadge",
      "AUTH ERROR"
    );


    log(
      "Authentication/account error: " +
      error.message
    );

  }

}


/* =========================================================
   LOAD ACCOUNTS
   ========================================================= */

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


  accountSelect.innerHTML =
    "";


  if (
    !accounts.length
  ) {

    accountSelect.innerHTML =
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


  updateSelectedAccount();


  log(
    `Loaded ${accounts.length} account(s).`
  );

}


/* =========================================================
   SELECTED ACCOUNT
   ========================================================= */

function updateSelectedAccount() {

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

    return;

  }


  const accountId =
    selected.value;


  state.account =
    state.accounts.find(
      account =>
        account.account_id ===
          accountId ||
        account.accountId ===
          accountId ||
        account.loginid ===
          accountId ||
        account.login_id ===
          accountId
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


  /*
   * Reconnect trading socket to this account.
   */

  connectTradingForSelectedAccount();

}


/* =========================================================
   AUTH BUTTONS
   ========================================================= */

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


/* =========================================================
   TRADING WEBSOCKET
   ========================================================= */

/*
 * The public market socket cannot place trades.
 *
 * Deriv's current Options API requires an account-specific
 * authenticated WebSocket URL obtained from:
 *
 * POST /trading/v1/options/accounts/{accountId}/otp
 *
 * The server.js you supplied already exposes /api/ws-url.
 *
 * Therefore:
 *
 * PUBLIC WS
 *    -> market data
 *
 * AUTH WS
 *    -> proposal
 *    -> buy
 *    -> balance
 *    -> open contract
 *
 * This separation is intentional.
 */


async function connectTradingForSelectedAccount() {

  if (
    !state.account
  ) {
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


  state.tradingConnecting =
    true;


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
      payload?.url;


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


        log(
          "Authenticated trading WebSocket connected."
        );


        /*
         * Balance stream.
         */

        sendTrading({

          balance:
            1,

          subscribe:
            1,

          req_id:
            nextRequestId()

        });


        /*
         * Subscribe to the same market on the
         * authenticated channel for trading operations.
         */

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
      error => {

        console.error(
          "Trading WebSocket error:",
          error
        );


        state.tradingReady =
          false;


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


        setText(
          "accountBadge",
          "TRADE OFFLINE"
        );


        log(
          "Trading WebSocket disconnected."
        );

      };

  } catch (error) {

    state.tradingConnecting =
      false;


    state.tradingReady =
      false;


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


/* =========================================================
   SEND TRADING
   ========================================================= */

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


/* =========================================================
   TRADING MESSAGE
   ========================================================= */

function handleTradingMessage(
  data
) {

  if (data.error) {

    log(
      "Deriv trading error",
      data.error
    );


    setText(
      "accountBadge",
      "TRADE ERROR"
    );


    return;

  }


  /* =======================================================
     BALANCE
     ======================================================= */

  if (
    data.msg_type ===
      "balance" &&
    data.balance
  ) {

    const balance =
      data.balance.balance;


    const currency =
      data.balance.currency;


    setText(
      "balance",
      balance ??
        "—"
    );


    setText(
      "currency",
      currency ??
        "—"
    );


    return;

  }


  /* =======================================================
     PROPOSAL
     ======================================================= */

  if (
    data.msg_type ===
      "proposal" &&
    data.proposal
  ) {

    const proposal =
      data.proposal;


    state.proposal =
      proposal;


    setText(
      "askPrice",
      proposal.ask_price ??
        "—"
    );


    setText(
      "payout",
      proposal.payout ??
        "—"
    );


    setText(
      "proposalId",
      proposal.id ??
        "—"
    );


    log(
      "Live proposal received.",
      proposal
    );


    return;

  }


  /* =======================================================
     BUY
     ======================================================= */

  if (
    data.msg_type ===
      "buy" &&
    data.buy
  ) {

    const buy =
      data.buy;


    state.contractId =
      buy.contract_id;


    log(
      "Contract purchased.",
      buy
    );


    setText(
      "contractId",
      buy.contract_id ??
        "—"
    );


    /*
     * Subscribe to open contract.
     */

    if (
      buy.contract_id
    ) {

      sendTrading({

        proposal_open_contract:
          1,

        contract_id:
          buy.contract_id,

        subscribe:
          1,

        req_id:
          nextRequestId()

      });

    }


    return;

  }


  /* =======================================================
     OPEN CONTRACT
     ======================================================= */

  if (
    data.msg_type ===
      "proposal_open_contract" &&
    data.proposal_open_contract
  ) {

    const contract =
      data.proposal_open_contract;


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
      "contractPL",
      contract.profit ??
        "—"
    );


    setText(
      "buyPrice",
      contract.buy_price ??
        "—"
    );


    return;

  }

}


/* =========================================================
   PROPOSAL REQUEST
   ========================================================= */

function updateProposal() {

  if (
    !state.tradingReady
  ) {
    return;
  }


  const account =
    state.account;


  if (!account) {
    return;
  }


  const currency =
    account.currency ||
    account.currency_code ||
    $("currency")?.textContent ||
    "USD";


  const stakeElement =
    $("stake");


  const durationElement =
    $("duration");


  const durationUnitElement =
    $("durationUnit");


  const contractElement =
    $("contractType");


  const barrierElement =
    $("barrier");


  const amount =
    Number(
      stakeElement?.value ||
      stakeElement?.textContent ||
      1
    );


  const duration =
    Number(
      durationElement?.value ||
      1
    );


  const durationUnit =
    durationUnitElement?.value ||
    "t";


  let contractType =
    contractElement?.value ||
    "DIGITMATCH";


  /*
   * Support the wording used by the UI.
   */

  const normalized =
    String(
      contractType
    ).toLowerCase();


  if (
    normalized === "matches" ||
    normalized === "match" ||
    normalized === "digitmatch"
  ) {

    contractType =
      "DIGITMATCH";

  } else if (
    normalized === "even" ||
    normalized === "digiteven"
  ) {

    contractType =
      "DIGITEVEN";

  } else if (
    normalized === "odd" ||
    normalized === "digitodd"
  ) {

    contractType =
      "DIGITODD";

  } else if (
    normalized === "over" ||
    normalized === "digitover"
  ) {

    contractType =
      "DIGITOVER";

  } else if (
    normalized === "under" ||
    normalized === "digitunder"
  ) {

    contractType =
      "DIGITUNDER";

  }


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

    subscribe:
      1,

    req_id:
      nextRequestId()

  };


  /*
   * Digit match / over / under require a barrier.
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
      barrierElement?.value;


    /*
     * If the prediction engine has a digit
     * prediction, automatically use it.
     */

    if (
      contractType ===
        "DIGITMATCH" &&
      state.bot.lastStats?.match
    ) {

      barrier =
        String(
          state.bot.lastStats.match.prediction
        );

    }


    if (
      contractType ===
        "DIGITOVER" &&
      state.bot.lastStats?.over
    ) {

      barrier =
        String(
          state.bot.lastStats.over.threshold
        );

    }


    if (
      contractType ===
        "DIGITUNDER" &&
      state.bot.lastStats?.over
    ) {

      barrier =
        String(
          state.bot.lastStats.over.threshold
        );

    }


    if (
      barrier !==
      undefined &&
      barrier !==
      null &&
      String(barrier).trim() !== ""
    ) {

      request.barrier =
        String(barrier);

    }

  }


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


/* =========================================================
   BUY CONTRACT
   ========================================================= */

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


/* =========================================================
   SELL CONTRACT
   ========================================================= */

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


/* =========================================================
   BOT CONTROLS
   ========================================================= */

function setupBotControls() {

  const refreshBtn =
    $("botRefresh");


  if (refreshBtn) {

    refreshBtn.onclick =
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


        log(
          `Prediction threshold changed to ${state.bot.threshold}.`
        );

      }
    );

  }

}


/* =========================================================
   MARKET CONTROLS
   ========================================================= */

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


    if (marketSelect) {

      marketSelect.value =
        symbol;

    }


    if (botSymbol) {

      botSymbol.value =
        symbol;

    }


    log(
      `Changing market to ${symbol}.`
    );


    connectPublicMarket();


    /*
     * If authenticated, restart the trading connection
     * so its market subscription matches.
     */

    if (
      state.account
    ) {

      connectTradingForSelectedAccount();

    }

  }


  if (marketSelect) {

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


/* =========================================================
   ACCOUNT CONTROLS
   ========================================================= */

function setupAccountControls() {

  const accountSelect =
    $("accountSelect");


  if (
    accountSelect
  ) {

    accountSelect.addEventListener(
      "change",
      updateSelectedAccount
    );

  }

}


/* =========================================================
   ORDER PANEL CONTROLS
   ========================================================= */

function setupTradingControls() {

  const proposalBtn =
    $("getProposal");


  const buyBtn =
    $("buyContract");


  const sellBtn =
    $("sellContract");


  if (proposalBtn) {

    proposalBtn.onclick =
      () => {

        updateProposal();

      };

  }


  if (buyBtn) {

    buyBtn.onclick =
      () => {

        buyContract();

      };

  }


  if (sellBtn) {

    sellBtn.onclick =
      () => {

        sellOpenContract();

      };

  }


  /*
   * Some existing HTML versions may use alternative IDs.
   */

  const proposalAlt =
    $("getLiveProposal");


  const buyAlt =
    $("buyContractBtn");


  const sellAlt =
    $("sellOpenContract");


  if (
    proposalAlt &&
    proposalAlt !== proposalBtn
  ) {

    proposalAlt.onclick =
      updateProposal;

  }


  if (
    buyAlt &&
    buyAlt !== buyBtn
  ) {

    buyAlt.onclick =
      buyContract;

  }


  if (
    sellAlt &&
    sellAlt !== sellBtn
  ) {

    sellAlt.onclick =
      sellOpenContract;

  }

}


/* =========================================================
   WINDOW RESIZE
   ========================================================= */

window.addEventListener(
  "resize",
  () => {

    drawChart();

  }
);


/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initializeApp() {

  log(
    "TRADERS HUB advanced engine initialized."
  );


  setupAuthButtons();

  setupBotControls();

  setupMarketControls();

  setupAccountControls();

  setupTradingControls();


  resetPredictionUI();


  /*
   * PUBLIC MARKET DATA
   *
   * Does NOT require login.
   */

  setTimeout(
    () => {

      connectPublicMarket();

    },
    250
  );


  /*
   * AUTH / ACCOUNTS / TRADING
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
