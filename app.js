"use strict";

/* =========================================================
   TRADERS HUB
   ADVANCED DERIV OPTIONS TERMINAL
   MARKET + PREDICTION + AUTHENTICATED TRADING
   ========================================================= */


/* =========================================================
   HELPERS
   ========================================================= */

const $ = id => document.getElementById(id);


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


/* =========================================================
   STATE
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

    highConfidenceProbability: 20,

    minimumMargin: 5,

    threshold: 4,

    lastStats: null

  }

};


/* =========================================================
   REQUEST IDS
   ========================================================= */

function nextRequestId() {

  state.requestId += 1;

  return state.requestId;

}


/* =========================================================
   DIGIT EXTRACTION
   ========================================================= */

function digitFromPrice(
  price,
  pipSize = null
) {

  if (
    price === null ||
    price === undefined
  ) {
    return null;
  }

  const number =
    Number(price);

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

  const decimals =
    Number.isInteger(
      state.pipSize
    )
      ? state.pipSize
      : 2;

  setText(
    "price",
    Number(quote).toFixed(decimals)
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
    state.prices.slice(-100);

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
        ) *
        width;

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

  setText("price", "—");
  setText("lastTick", "—");
  setText("lastDigit", "—");
  setText("botDigit", "—");

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
   PROCESS LIVE TICK
   ========================================================= */

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


/* =========================================================
   HISTORICAL DATA
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
   PUBLIC MARKET CONNECTION
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

  ws.onopen =
    () => {

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


  ws.onmessage =
    event => {

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


        /* HISTORY */

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

            const digit =
              digitFromPrice(
                latest,
                state.pipSize
              );

            if (
              Number.isInteger(digit)
            ) {

              setText(
                "lastDigit",
                digit
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


        /* LIVE TICK */

        if (
          data.msg_type === "tick" &&
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

        log(
          "Market message error: " +
          error.message
        );

      }

    };


  ws.onerror =
    () => {

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
   PREDICTION ENGINE
   ========================================================= */

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

    return Array(10).fill(0.1);

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
   RECENCY MODEL
   ========================================================= */

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
   SHORT WINDOW
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

        counts[digit] +=
          1;

      }

    }
  );

  return normalizeDistribution(
    counts
  );

}


/* =========================================================
   TRANSITION MODEL
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

    return Array(10).fill(0.1);

  }

  return normalizeDistribution(
    counts[last]
  );

}


/* =========================================================
   TWO-DIGIT CONTEXT
   ========================================================= */

function contextDistribution(
  digits
) {

  if (
    digits.length < 3
  ) {

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

        counts[next] +=
          3;

      }

    }

  }

  return normalizeDistribution(
    counts
  );

}


/* =========================================================
   ENSEMBLE MODEL
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
      recent[digit] * 0.30 +
      short[digit] * 0.20 +
      medium[digit] * 0.15 +
      transition[digit] * 0.20 +
      context[digit] * 0.15;

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
              ranking[1]?.probability ||
              0
            )
          ) * 100
        : 0

  };

}


/* =========================================================
   WALK-FORWARD VALIDATION
   ========================================================= */

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
        ? wins / samples * 100
        : 0,

    averageActualProbability:
      probabilityHits.length
        ? probabilityHits.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          probabilityHits.length *
          100
        : 0

  };

}


/* =========================================================
   BINARY CLASSIFIER
   ========================================================= */

function classifyBinary(
  values
) {

  const total =
    values.length;

  if (
    total < 2
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
    ) *
    100;

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
      train.length < 30
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

    probability,

    wins,

    samples,

    accuracy:
      samples
        ? wins / samples * 100
        : 0

  };

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

  const evenValues =
    digits.map(
      digit =>
        digit % 2 === 0
    );

  const overValues =
    digits.map(
      digit =>
        digit >
        state.bot.threshold
    );

  const even =
    classifyBinary(
      evenValues
    );

  const over =
    classifyBinary(
      overValues
    );

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

    digits:
      digits.length,

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
   SIGNAL UI
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
   RESET PREDICTION
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

  const container =
    $("advancedPredictionDisplay");

  if (container) {

    container.innerHTML = `
      <div class="prediction-title">
        LIVE VALIDATED PREDICTION
      </div>

      <div class="prediction-waiting">
        Waiting for enough validated ticks…
      </div>
    `;

  }

}


/* =========================================================
   RENDER PREDICTION
   ========================================================= */

function renderAdvancedPrediction(
  prediction
) {

  const container =
    $("advancedPredictionDisplay");

  if (!container) {
    return;
  }

  const top =
    prediction.match.ranking || [];

  const topDigits =
    top
      .map(
        item =>
          `
          <span class="digit-chip">
            ${item.digit}
            <small>
              ${(item.probability * 100).toFixed(1)}%
            </small>
          </span>
          `
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

  container.innerHTML = `

    <div class="prediction-title">
      LIVE VALIDATED PREDICTION
    </div>

    <div class="prediction-main-grid">

      <div
        class="main-prediction"
        style="border-color:${matchColor}"
      >

        <div class="small-label">
          TOP DIGIT
        </div>

        <div
          class="big-digit"
          style="color:${matchColor}"
        >
          ${prediction.match.prediction}
        </div>

        <div class="model-probability">
          ${prediction.match.probability.toFixed(1)}%
          model probability
        </div>

        <div class="validation-line">
          ${prediction.match.accuracy.toFixed(1)}%
          walk-forward accuracy
        </div>

        <div class="margin-line">
          ${prediction.match.margin.toFixed(1)}%
          top-digit margin
        </div>

      </div>


      <div
        class="secondary-prediction"
        style="border-color:${evenColor}"
      >

        <div class="small-label">
          PARITY
        </div>

        <div
          class="secondary-value"
          style="color:${evenColor}"
        >
          ${prediction.even.prediction}
        </div>

        <div class="model-probability">
          ${prediction.even.probability.toFixed(1)}%
          model probability
        </div>

        <div class="validation-line">
          ${prediction.even.accuracy.toFixed(1)}%
          validation accuracy
        </div>

      </div>


      <div
        class="secondary-prediction"
        style="border-color:${overColor}"
      >

        <div class="small-label">
          THRESHOLD ${prediction.over.threshold}
        </div>

        <div
          class="secondary-value"
          style="color:${overColor}"
        >
          ${prediction.over.prediction}
        </div>

        <div class="model-probability">
          ${prediction.over.probability.toFixed(1)}%
          model probability
        </div>

        <div class="validation-line">
          ${prediction.over.accuracy.toFixed(1)}%
          validation accuracy
        </div>

      </div>

    </div>


    <div class="top-digits">
      TOP DIGITS:
      ${topDigits}
    </div>

  `;

}


/* =========================================================
   UPDATE PREDICTION
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
    "botDigit",
    prediction.match.prediction
  );

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

  renderAdvancedPrediction(
    prediction
  );

}


/* =========================================================
   AUTHENTICATION
   ========================================================= */

async function loadAuthAndAccounts() {

  const loginBtn =
    $("loginBtn");

  const logoutBtn =
    $("logoutBtn");

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
        loginBtn.classList.remove(
          "hidden"
        );
      }

      if (logoutBtn) {
        logoutBtn.classList.add(
          "hidden"
        );
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
      loginBtn.classList.add(
        "hidden"
      );
    }

    if (logoutBtn) {
      logoutBtn.classList.remove(
        "hidden"
      );
    }

    setText(
      "accountBadge",
      "LOGGED IN"
    );

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


/* =========================================================
   LOAD ACCOUNTS
   ========================================================= */

async function loadAccounts() {

  const select =
    $("accountSelect");

  if (!select) {
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

    throw new Error(
      `Could not load accounts (${response.status})`
    );

  }

  const payload =
    await response.json();

  let accounts = [];

  if (
    Array.isArray(payload)
  ) {

    accounts =
      payload;

  } else if (
    Array.isArray(payload?.data)
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

  select.innerHTML =
    "";

  if (
    !accounts.length
  ) {

    select.innerHTML =
      `
      <option value="">
        No accounts found
      </option>
      `;

    return;

  }

  accounts.forEach(
    (account, index) => {

      const id =
        account.account_id ||
        account.accountId ||
        account.loginid ||
        account.login_id ||
        account.id ||
        "";

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
        `Account ${index + 1}`;

      option.dataset.balance =
        account.balance ??
        account.amount ??
        "";

      option.dataset.currency =
        account.currency ||
        account.currency_code ||
        "";

      select.appendChild(
        option
      );

    }
  );

  select.disabled =
    false;

  select.selectedIndex =
    0;

  updateSelectedAccount(
    false
  );

  log(
    `Loaded ${accounts.length} account(s).`
  );

}


/* =========================================================
   SELECT ACCOUNT
   ========================================================= */

function updateSelectedAccount(
  reconnect = true
) {

  const select =
    $("accountSelect");

  if (!select) {
    return;
  }

  const option =
    select.options[
      select.selectedIndex
    ];

  if (!option) {
    return;
  }

  const id =
    option.value;

  state.account =
    state.accounts.find(
      account =>
        (
          account.account_id ||
          account.accountId ||
          account.loginid ||
          account.login_id ||
          account.id
        ) === id
    ) || null;

  setText(
    "balance",
    option.dataset.balance ||
      "—"
  );

  setText(
    "currency",
    option.dataset.currency ||
      "—"
  );

  if (
    reconnect &&
    state.account
  ) {

    connectTradingForSelectedAccount();

  }

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

        logoutBtn.disabled =
          true;

        try {

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

          log(
            "Logout error: " +
            error.message
          );

        }

        window.location.reload();

      };

  }

}


/* =========================================================
   TRADING CONNECTION
   ========================================================= */

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

  setText(
    "accountBadge",
    "CONNECTING TRADE"
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

    if (!payload?.url) {

      throw new Error(
        "No authenticated WebSocket URL returned."
      );

    }

    const ws =
      new WebSocket(
        payload.url
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

        state.tradingReady =
          true;

        setText(
          "accountBadge",
          "TRADE READY"
        );

        enableTradingButtons(
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

        enableTradingButtons(
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

        enableTradingButtons(
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

    enableTradingButtons(
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


/* =========================================================
   TRADING BUTTON STATE
   ========================================================= */

function enableTradingButtons(
  enabled
) {

  const proposal =
    $("getProposal");

  const buy =
    $("buyContract");

  const sell =
    $("sellContract");

  if (proposal) {
    proposal.disabled =
      !enabled;
  }

  if (buy) {
    buy.disabled =
      !enabled ||
      !state.proposal?.id;
  }

  if (sell) {
    sell.disabled =
      !enabled ||
      !state.contractId;
  }

}


/* =========================================================
   SEND TRADING MESSAGE
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
   TRADING MESSAGE HANDLER
   ========================================================= */

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

    const buy =
      $("buyContract");

    if (buy) {

      buy.disabled =
        !state.tradingReady ||
        !data.proposal.id;

    }

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

    showPosition();

    const sell =
      $("sellContract");

    if (sell) {
      sell.disabled =
        !state.contractId;
    }

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
          data.buy.contract_id,

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

    showPosition();

    if (
      contract.is_sold ||
      contract.status === "sold"
    ) {

      state.contractId =
        null;

      const sell =
        $("sellContract");

      if (sell) {
        sell.disabled =
          true;
      }

    }

  }

}


/* =========================================================
   PROPOSAL
   ========================================================= */

function updateProposal() {

  if (
    !state.tradingReady ||
    !state.account
  ) {
    return;
  }

  const stake =
    Number(
      $("stake")?.value
    );

  const duration =
    Number(
      $("duration")?.value
    );

  const durationUnit =
    $("durationUnit")?.value ||
    "t";

  let contractType =
    $("contractType")?.value ||
    "DIGITMATCH";

  const currency =
    state.account.currency ||
    state.account.currency_code ||
    $("currency")?.textContent ||
    "USD";

  const request = {

    proposal:
      1,

    amount:
      Number.isFinite(stake)
        ? stake
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


  /* DIGIT CONTRACT BARRIER */

  if (
    contractType ===
      "DIGITMATCH"
  ) {

    const prediction =
      state.bot.lastStats?.match?.prediction;

    const manual =
      $("barrier")?.value;

    request.barrier =
      manual !== undefined &&
      String(manual).trim() !== ""
        ? String(manual)
        : String(
            Number.isInteger(
              prediction
            )
              ? prediction
              : 0
          );

  }


  if (
    contractType ===
      "DIGITOVER" ||
    contractType ===
      "DIGITUNDER"
  ) {

    const manual =
      $("barrier")?.value;

    const threshold =
      state.bot.lastStats?.over?.threshold ??
      state.bot.threshold;

    request.barrier =
      manual !== undefined &&
      String(manual).trim() !== ""
        ? String(manual)
        : String(threshold);

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
   BUY
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
   SELL
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
      `Sell request sent for ${state.contractId}.`
    );

  } catch (error) {

    log(
      "Sell request failed: " +
      error.message
    );

  }

}


/* =========================================================
   POSITION UI
   ========================================================= */

function showPosition() {

  const empty =
    $("positionEmpty");

  const position =
    $("position");

  if (empty) {
    empty.classList.add(
      "hidden"
    );
  }

  if (position) {
    position.classList.remove(
      "hidden"
    );
  }

}


/* =========================================================
   MARKET CONTROLS
   ========================================================= */

function setupMarketControls() {

  const market =
    $("symbolSelect");

  const bot =
    $("botSymbol");

  function changeSymbol(
    symbol
  ) {

    if (!symbol) {
      return;
    }

    state.symbol =
      symbol;

    if (market) {
      market.value =
        symbol;
    }

    if (bot) {
      bot.value =
        symbol;
    }

    const names = {

      "1HZ100V":
        "Volatility 100 (1s)",

      "1HZ50V":
        "Volatility 50 (1s)",

      "1HZ75V":
        "Volatility 75 (1s)",

      "1HZ25V":
        "Volatility 25 (1s)",

      "R_100":
        "Volatility 100",

      "R_75":
        "Volatility 75",

      "R_50":
        "Volatility 50",

      "frxEURUSD":
        "EUR/USD"

    };

    setText(
      "symbolName",
      names[symbol] ||
      symbol
    );

    connectPublicMarket();

    log(
      `Changed market to ${symbol}.`
    );

  }


  if (market) {

    market.value =
      state.symbol;

    market.addEventListener(
      "change",
      event =>
        changeSymbol(
          event.target.value
        )
    );

  }


  if (bot) {

    bot.value =
      state.symbol;

    bot.addEventListener(
      "change",
      event =>
        changeSymbol(
          event.target.value
        )
    );

  }

}


/* =========================================================
   BOT CONTROLS
   ========================================================= */

function setupBotControls() {

  const refresh =
    $("botRefresh");

  if (refresh) {

    refresh.onclick =
      () => {

        updatePredictionBot();

        log(
          "Prediction model refreshed."
        );

      };

  }


  const threshold =
    $("botThreshold");

  if (threshold) {

    threshold.value =
      state.bot.threshold;

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
          `Over/Under threshold changed to ${state.bot.threshold}.`
        );

      }
    );

  }

}


/* =========================================================
   ACCOUNT CONTROLS
   ========================================================= */

function setupAccountControls() {

  const select =
    $("accountSelect");

  if (select) {

    select.addEventListener(
      "change",
      () =>
        updateSelectedAccount(
          true
        )
    );

  }

}


/* =========================================================
   TRADING CONTROLS
   ========================================================= */

function setupTradingControls() {

  const proposal =
    $("getProposal");

  const buy =
    $("buyContract");

  const sell =
    $("sellContract");


  if (proposal) {

    proposal.onclick =
      updateProposal;

  }

  if (buy) {

    buy.onclick =
      buyContract;

  }

  if (sell) {

    sell.onclick =
      sellOpenContract;

  }


  /* AUTO-PROPOSAL REFRESH WHEN CONTRACT SETTINGS CHANGE */

  [
    "stake",
    "duration",
    "durationUnit",
    "contractType",
    "barrier"
  ].forEach(
    id => {

      const element =
        $(id);

      if (!element) {
        return;
      }

      element.addEventListener(
        "change",
        () => {

          if (
            state.tradingReady
          ) {

            state.proposal =
              null;

            setText(
              "proposalId",
              "—"
            );

            setText(
              "askPrice",
              "—"
            );

            setText(
              "payout",
              "—"
            );

          }

        }
      );

    }
  );


  /* STAKE + / - */

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
                input.step
              ) || 0.01;

            const direction =
              Number(
                button.dataset.step
              ) || 0;

            const current =
              Number(
                input.value
              ) || 0;

            input.value =
              Math.max(
                Number(input.min) || 0,
                current +
                direction *
                step
              ).toFixed(2);

          }
        );

      }
    );


  const clear =
    $("clearLog");

  if (clear) {

    clear.onclick =
      () => {

        const box =
          $("log");

        if (box) {
          box.textContent =
            "";
        }

      };

  }

}


/* =========================================================
   RESIZE
   ========================================================= */

window.addEventListener(
  "resize",
  drawChart
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
   * PUBLIC MARKET
   */

  setTimeout(
    connectPublicMarket,
    250
  );

  /*
   * AUTHENTICATED ACCOUNT
   */

  await loadAuthAndAccounts();

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
    initializeApp,
    {
      once: true
    }
  );

} else {

  initializeApp();

    }j
