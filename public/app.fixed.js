"use strict";

/*
=========================================================
 TRADERS HUB
 Deriv Options Terminal + Digit Analysis Engine

 CORRECTED / HARDENED VERSION

 PUBLIC MARKET
   - Historical ticks
   - Continuous live tick subscription
   - Current price
   - Last digit
   - Digit history
   - Rolling statistical predictor

 AUTHENTICATED TRADING
   - Account balance
   - Proposal
   - Buy
   - Open contract
   - Sell
   - Contract status

 IMPORTANT
 ---------------------------------------------------------
 The predictor is statistical analysis only.

 It does NOT guarantee:
   - future results
   - prediction accuracy
   - profitability
   - winning trades

 BUY IS ALWAYS MANUAL.

 This file does NOT automatically place trades.
=========================================================
*/


/* =======================================================
   CONSTANTS
======================================================= */

const MARKET_WS_URL =
  "wss://api.derivws.com/trading/v1/options/ws/public";

const DEFAULT_SYMBOL =
  "1HZ100V";

const DEFAULT_HISTORY_LIMIT =
  500;

const DIGIT_CONTRACT_TYPES =
  [
    "DIGITMATCH",
    "DIGITOVER",
    "DIGITUNDER"
  ];

const MAX_RECONNECT_DELAY =
  15000;

const MARKET_INITIAL_DELAY =
  200;

const TRADE_RECONNECT_BASE =
  2000;


/* =======================================================
   DOM HELPERS
======================================================= */

const $ = (id) =>
  document.getElementById(id);


function setText(id, value) {

  const element = $(id);

  if (element) {
    element.textContent =
      value;
  }

}


function percentage(value) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? `${n.toFixed(1)}%`
    : "—";

}


function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(max, value)
  );

}


/* =======================================================
   LOGGING
======================================================= */

function log(
  message,
  data = null
) {

  const box =
    $("log");

  const line =
    `[${new Date().toLocaleTimeString()}] ${message}`;

  const extra =
    data !== null
      ? "\n" +
        safeJSONStringify(data)
      : "";

  if (box) {

    box.textContent =
      `${line}${extra}\n${box.textContent}`;

  }

  console.log(
    line,
    data ?? ""
  );

}


function safeJSONStringify(value) {

  try {

    return JSON.stringify(
      value,
      null,
      2
    );

  } catch (_) {

    return String(value);

  }

}


/* =======================================================
   STATUS
======================================================= */

function setStatus(
  online,
  text
) {

  const dot =
    $("connectionDot");

  const label =
    $("connectionText");

  if (dot) {

    dot.className =
      `status-dot ${
        online
          ? "online"
          : "offline"
      }`;

  }

  if (label) {

    label.textContent =
      text;

  }

}


/* =======================================================
   STATE
======================================================= */

const state = {

  symbol:
    DEFAULT_SYMBOL,

  prices: [],

  digits: [],

  epochs: [],

  previous: null,

  pipSize: null,

  /* -----------------------------------------------------
     PUBLIC MARKET
  ----------------------------------------------------- */

  marketWS:
    null,

  marketGeneration:
    0,

  marketReconnectTimer:
    null,

  marketReconnectAttempts:
    0,

  marketTickSubscriptionId:
    null,

  marketHistoryLoaded:
    false,

  marketHistoryRequestId:
    null,

  /*
   * Live ticks received while history is still loading.
   * They are merged after the history response arrives.
   */
  marketLiveBuffer: [],

  /*
   * Last received market epoch.
   */
  lastMarketEpoch:
    0,

  /*
   * Prevent duplicate processing.
   */
  lastMarketTickKey:
    null,

  /*
   * Timestamp of last received live tick.
   */
  lastLiveTickAt:
    0,


  /* -----------------------------------------------------
     AUTHENTICATED TRADING
  ----------------------------------------------------- */

  account:
    null,

  accounts:
    [],

  tradingWS:
    null,

  tradingGeneration:
    0,

  tradingReady:
    false,

  tradingConnecting:
    false,

  tradingReconnectTimer:
    null,

  tradingReconnectAttempts:
    0,

  balanceSubscriptionId:
    null,

  proposalSubscriptionId:
    null,

  contractSubscriptionId:
    null,

  proposal:
    null,

  proposalRequestId:
    null,

  contractId:
    null,

  requestId:
    100,


  /* -----------------------------------------------------
     PREDICTOR
  ----------------------------------------------------- */

  bot: {

    historyLimit:
      DEFAULT_HISTORY_LIMIT,

    analysisWindow:
      240,

    minimumSamples:
      60,

    validationSamples:
      120,

    highConfidenceAccuracy:
      80,

    minimumProbability:
      20,

    minimumMargin:
      5,

    threshold:
      4,

    lastStats:
      null,

    lastPredictionEpoch:
      0,

    lastProposalPredictionKey:
      null

  },


  /* -----------------------------------------------------
     RISK CONTROLS
  ----------------------------------------------------- */

  risk: {

    /*
     * Safety ceiling for the stake field.
     *
     * This does not replace server-side risk controls.
     */
    maxStake:
      100,

    maxTradesPerSession:
      20,

    tradesThisSession:
      0,

    maxConsecutiveLosses:
      3,

    consecutiveLosses:
      0

  }

};


/* =======================================================
   REQUEST IDS
======================================================= */

function nextRequestId() {

  state.requestId += 1;

  return state.requestId;

}


/* =======================================================
   DIGIT EXTRACTION
======================================================= */

function digitFromPrice(
  price,
  pipSize = null
) {

  if (
    price === undefined ||
    price === null
  ) {
    return null;
  }

  const number =
    Number(price);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  const p =
    Number(pipSize);

  let text;

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

  if (
    !cleaned.length
  ) {

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

  if (
    epoch !== undefined &&
    epoch !== null
  ) {

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

    if (
      difference > 0
    ) {

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


/* =======================================================
   RESET MARKET DATA
======================================================= */

function resetMarketData() {

  state.prices =
    [];

  state.digits =
    [];

  state.epochs =
    [];

  state.previous =
    null;

  state.pipSize =
    null;

  state.marketHistoryLoaded =
    false;

  state.marketHistoryRequestId =
    null;

  state.marketTickSubscriptionId =
    null;

  state.marketLiveBuffer =
    [];

  state.lastMarketEpoch =
    0;

  state.lastMarketTickKey =
    null;

  state.lastLiveTickAt =
    0;

  state.bot.lastStats =
    null;

  state.bot.lastPredictionEpoch =
    0;

  state.bot.lastProposalPredictionKey =
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
    "priceChange",
    "WAITING"
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
    $("priceChange");

  if (change) {

    change.className =
      "change neutral";

  }

  resetPredictionUI();

  drawChart();

}


/* =======================================================
   APPEND TICK
======================================================= */

function appendTick(
  quote,
  epoch,
  pipSize = null
) {

  const price =
    Number(quote);

  if (
    !Number.isFinite(price)
  ) {

    return false;

  }

  const numericEpoch =
    Number(epoch);

  const safeEpoch =
    Number.isFinite(
      numericEpoch
    )
      ? numericEpoch
      : Date.now() / 1000;

  if (
    Number.isFinite(
      Number(pipSize)
    )
  ) {

    state.pipSize =
      Number(pipSize);

  }

  const key =
    `${safeEpoch}|${price}`;

  if (
    key ===
    state.lastMarketTickKey
  ) {

    return false;

  }

  /*
   * Ignore an old tick that arrived after a
   * newer tick unless we are building the history.
   */
  if (
    state.marketHistoryLoaded &&
    safeEpoch <
      state.lastMarketEpoch
  ) {

    return false;

  }

  state.lastMarketTickKey =
    key;

  state.lastMarketEpoch =
    Math.max(
      state.lastMarketEpoch,
      safeEpoch
    );

  state.lastLiveTickAt =
    Date.now();

  updatePriceUI(
    price,
    safeEpoch
  );

  state.prices.push(
    price
  );

  state.epochs.push(
    safeEpoch
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

  return true;

}


/* =======================================================
   PROCESS LIVE MARKET TICK
======================================================= */

function processMarketTick(
  quote,
  epoch,
  pipSize = null
) {

  /*
   * During initial history loading, preserve live
   * ticks instead of allowing history to overwrite them.
   */
  if (
    !state.marketHistoryLoaded
  ) {

    state.marketLiveBuffer.push({

      quote:
        Number(quote),

      epoch:
        Number(epoch),

      pipSize:
        Number(pipSize)

    });

    /*
     * Prevent unlimited growth if the history
     * response is delayed.
     */
    if (
      state.marketLiveBuffer.length >
      100
    ) {

      state.marketLiveBuffer.shift();

    }

    /*
     * Still display the live quote immediately.
     */
    updatePriceUI(
      quote,
      epoch
    );

    const digit =
      digitFromPrice(
        quote,
        pipSize ??
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

    return;

  }

  appendTick(
    quote,
    epoch,
    pipSize
  );

}


/* =======================================================
   LOAD HISTORICAL TICKS
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

  const reqId =
    nextRequestId();

  state.marketHistoryRequestId =
    reqId;

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
      reqId

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
   SUBSCRIBE LIVE TICKS
======================================================= */

function subscribePublicTicks(
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
   MERGE HISTORY + BUFFERED LIVE TICKS
======================================================= */

function applyHistoricalData(
  data
) {

  const history =
    data.history;

  if (!history) {
    return;
  }

  const prices =
    Array.isArray(
      history.prices
    )
      ? history.prices
      : [];

  const times =
    Array.isArray(
      history.times
    )
      ? history.times
      : [];

  if (
    Number.isFinite(
      Number(data.pip_size)
    )
  ) {

    state.pipSize =
      Number(data.pip_size);

  }

  const normalizedPrices =
    [];

  const normalizedEpochs =
    [];

  const count =
    Math.min(
      prices.length,
      times.length
    );

  for (
    let i = 0;
    i < count;
    i++
  ) {

    const price =
      Number(
        prices[i]
      );

    const epoch =
      Number(
        times[i]
      );

    if (
      Number.isFinite(price) &&
      Number.isFinite(epoch)
    ) {

      normalizedPrices.push(
        price
      );

      normalizedEpochs.push(
        epoch
      );

    }

  }

  /*
   * History is the base.
   */
  state.prices =
    normalizedPrices.slice(
      -state.bot.historyLimit
    );

  state.epochs =
    normalizedEpochs.slice(
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
      .filter(
        Number.isInteger
      )
      .slice(
        -state.bot.historyLimit
      );

  state.marketHistoryLoaded =
    true;

  state.lastMarketEpoch =
    state.epochs.length
      ? Math.max(
          ...state.epochs
        )
      : 0;

  /*
   * Merge all live ticks that arrived while
   * the history request was in flight.
   */
  const buffered =
    state.marketLiveBuffer
      .slice()
      .sort(
        (a, b) =>
          Number(a.epoch) -
          Number(b.epoch)
      );

  state.marketLiveBuffer =
    [];

  buffered.forEach(
    tick => {

      if (
        Number.isFinite(
          Number(tick.epoch)
        ) &&
        Number(tick.epoch) >
          state.lastMarketEpoch
      ) {

        appendTick(
          tick.quote,
          tick.epoch,
          tick.pipSize ??
            state.pipSize
        );

      }

    }
  );

  /*
   * Display the newest historical/live point.
   */
  if (
    state.prices.length
  ) {

    const latestIndex =
      state.prices.length - 1;

    const latest =
      state.prices[
        latestIndex
      ];

    const latestEpoch =
      state.epochs[
        latestIndex
      ];

    updatePriceUI(
      latest,
      latestEpoch
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

    state.marketReconnectTimer =
      null;

  }

  if (state.marketWS) {

    try {

      if (
        state.marketWS.readyState ===
        WebSocket.OPEN
      ) {

        try {

          state.marketWS.send(
            JSON.stringify({

              forget_all:
                "ticks",

              req_id:
                nextRequestId()

            })
          );

        } catch (_) {}

      }

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

  let ws;

  try {

    ws =
      new WebSocket(
        MARKET_WS_URL
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

  state.marketWS =
    ws;


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

    state.marketReconnectAttempts =
      0;

    setStatus(
      true,
      "Market online"
    );

    log(
      "Public market WebSocket connected."
    );

    /*
     * Request history and start the continuous
     * stream independently.
     *
     * The merge logic protects against ordering
     * races between the two responses.
     */
    loadHistoricalTicks(
      ws,
      symbol
    );

    subscribePublicTicks(
      ws,
      symbol
    );

  };


  /* =====================================================
     MESSAGE
  ===================================================== */

  ws.onmessage =
    event => {

      if (
        generation !==
        state.marketGeneration
      ) {

        return;

      }

      let data;

      try {

        data =
          JSON.parse(
            event.data
          );

      } catch (error) {

        log(
          "Market JSON parse error: " +
          error.message
        );

        return;

      }


      /* -----------------------------------------------
         API ERROR
      ------------------------------------------------ */

      if (
        data.error
      ) {

        log(
          "Market API error",
          data.error
        );

        /*
         * A bad market subscription should cause
         * a clean reconnect.
         */
        if (
          data.echo_req?.ticks ===
          symbol
        ) {

          try {

            ws.close();

          } catch (_) {}

        }

        return;

      }


      /* -----------------------------------------------
         HISTORY
      ------------------------------------------------ */

      if (
        data.msg_type ===
          "history" &&
        data.history
      ) {

        applyHistoricalData(
          data
        );

        return;

      }


      /* -----------------------------------------------
         LIVE TICK
      ------------------------------------------------ */

      if (
        data.msg_type ===
          "tick" &&
        data.tick
      ) {

        const tick =
          data.tick;

        if (
          tick.symbol &&
          tick.symbol !==
            state.symbol
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


      /* -----------------------------------------------
         SUBSCRIPTION CONFIRMATION
      ------------------------------------------------ */

      if (
        data.subscription?.id &&
        data.echo_req?.ticks ===
          symbol
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

    state.marketWS =
      null;

    state.marketTickSubscriptionId =
      null;

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
      MAX_RECONNECT_DELAY,
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
   PREDICTOR
======================================================= */

function normalizeDistribution(
  values
) {

  const total =
    values.reduce(
      (
        sum,
        value
      ) =>
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

  /*
   * Laplace smoothing.
   */
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

      counts[previous][current] +=
        1;

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
   TWO-DIGIT CONTEXT MODEL
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
        (
          probability,
          digit
        ) => ({
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
              (
                sum,
                value
              ) =>
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
      positive +
      negative
    );

  const validationStart =
    Math.max(
      1,
      values.length - 120
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

  /*
   * IMPORTANT:
   *
   * High confidence is deliberately conservative.
   *
   * Historical validation alone is not a guarantee
   * about the next tick.
   */
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

  state.bot.lastStats =
    null;

  state.bot.lastPredictionEpoch =
    0;

  state.bot.lastProposalPredictionKey =
    null;

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

  renderPredictionPanel(
    null
  );

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
        LIVE NEXT-DIGIT PREDICTION
      </div>

      <div class="prediction-wait">
        Waiting for enough validated ticks…
      </div>

    `;

    return;

  }

  const top =
    prediction.match.ranking ||
    [];

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
      LIVE NEXT-DIGIT PREDICTION
    </div>

    <div class="prediction-small">
      ${prediction.match.highConfidence
        ? "VALIDATED SIGNAL"
        : "MODEL CANDIDATE • NOT HIGH-CONFIDENCE"}
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

  state.bot.lastPredictionEpoch =
    state.lastMarketEpoch;


  /* -----------------------------------------------------
     MATCH
  ----------------------------------------------------- */

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


  /* -----------------------------------------------------
     EVEN / ODD
  ----------------------------------------------------- */

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


  /* -----------------------------------------------------
     OVER / UNDER
  ----------------------------------------------------- */

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


  /* -----------------------------------------------------
     GLOBAL FILTER
  ----------------------------------------------------- */

  const highCount =
    [
      prediction.match.highConfidence,
      prediction.even.highConfidence,
      prediction.over.highConfidence
    ].filter(Boolean).length;

  setText(
    "filterStatus",
    highCount
      ? `${highCount} HIGH-CONFIDENCE SIGNAL${
          highCount > 1
            ? "S"
            : ""
        }`
      : "NO VALIDATED HIGH-CONFIDENCE SIGNAL"
  );

  setText(
    "dataQuality",
    `${digits.length} ticks analysed`
  );

  renderPredictionPanel(
    prediction
  );

  syncPredictionToTradePanel(
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

    loginBtn.style.display =
      "";

  }

  if (logoutBtn) {

    logoutBtn.style.display =
      "none";

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

  invalidateTradingConnection();

  setTradingButtons(
    false
  );

}


/* =======================================================
   LOGGED-IN STATE
======================================================= */

function showLoggedInState() {

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

  const text =
    await response.text();

  let payload;

  try {

    payload =
      text
        ? JSON.parse(text)
        : {};

  } catch (_) {

    payload = {
      raw: text
    };

  }

  if (!response.ok) {

    throw new Error(
      `Could not load Deriv accounts (${response.status}): ${
        text || "Unknown error"
      }`
    );

  }

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
    (
      account,
      index
    ) => {

      const accountId =
        getAccountId(
          account
        );

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

  /*
   * Prefer an existing selected account
   * if it is still present.
   */
  const existingId =
    getAccountId(
      state.account
    );

  if (
    existingId
  ) {

    const existingOption =
      Array.from(
        accountSelect.options
      ).find(
        option =>
          option.value ===
          existingId
      );

    if (
      existingOption
    ) {

      accountSelect.value =
        existingId;

    }

  }

  updateSelectedAccount(
    false
  );

  log(
    `Loaded ${accounts.length} account(s).`
  );

}


/* =======================================================
   ACCOUNT ID
======================================================= */

function getAccountId(
  account
) {

  if (!account) {
    return "";
  }

  return (
    account.account_id ||
    account.accountId ||
    account.loginid ||
    account.login_id ||
    account.id ||
    ""
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

    invalidateTradingConnection();

    setTradingButtons(
      false
    );

    return;

  }

  const accountId =
    selected.value;

  const selectedAccount =
    state.accounts.find(
      account =>
        getAccountId(
          account
        ) ===
        accountId
    );

  state.account =
    selectedAccount ||
    null;

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

          invalidateTradingConnection();

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
   INVALIDATE TRADING CONNECTION
======================================================= */

function invalidateTradingConnection() {

  ++state.tradingGeneration;

  state.tradingReady =
    false;

  state.tradingConnecting =
    false;

  state.balanceSubscriptionId =
    null;

  state.proposalSubscriptionId =
    null;

  state.contractSubscriptionId =
    null;

  state.proposal =
    null;

  state.proposalRequestId =
    null;

  /*
   * Keep contract information visible until a new
   * account is selected, but it cannot be sold
   * through the invalidated connection.
   */
  state.contractId =
    null;

  if (
    state.tradingReconnectTimer
  ) {

    clearTimeout(
      state.tradingReconnectTimer
    );

    state.tradingReconnectTimer =
      null;

  }

  if (
    state.tradingWS
  ) {

    try {

      if (
        state.tradingWS.readyState ===
        WebSocket.OPEN
      ) {

        /*
         * Clear account-related subscriptions.
         */
        try {

          state.tradingWS.send(
            JSON.stringify({
              forget_all:
                [
                  "balance",
                  "proposal",
                  "proposal_open_contract"
                ],
              req_id:
                nextRequestId()
            })
          );

        } catch (_) {}

      }

      state.tradingWS.close();

    } catch (_) {}

    state.tradingWS =
      null;

  }

  setTradingButtons(
    false
  );

}


/* =======================================================
   TRADING WEBSOCKET
======================================================= */

async function connectTradingForSelectedAccount() {

  if (
    !state.account
  ) {

    invalidateTradingConnection();

    return;

  }

  const accountId =
    getAccountId(
      state.account
    );

  if (!accountId) {

    log(
      "Selected account has no account ID."
    );

    return;

  }

  /*
   * New generation invalidates any previous
   * asynchronous connection attempt.
   */
  const generation =
    ++state.tradingGeneration;

  state.tradingReady =
    false;

  state.tradingConnecting =
    true;

  state.proposal =
    null;

  state.proposalSubscriptionId =
    null;

  state.contractSubscriptionId =
    null;

  state.balanceSubscriptionId =
    null;

  if (
    state.tradingReconnectTimer
  ) {

    clearTimeout(
      state.tradingReconnectTimer
    );

    state.tradingReconnectTimer =
      null;

  }

  if (
    state.tradingWS
  ) {

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

    const text =
      await response.text();

    let payload;

    try {

      payload =
        text
          ? JSON.parse(text)
          : {};

    } catch (_) {

      payload = {
        raw: text
      };

    }

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
        payload?.errors?.[0]?.message ||
        `HTTP ${response.status}`
      );

    }

    /*
     * Current Deriv documentation returns:
     *
     * {
     *   data: {
     *     url: "wss://..."
     *   }
     * }
     *
     * Support the older shapes too.
     */
    const url =
      payload?.data?.url ||
      payload?.url ||
      payload?.wsUrl ||
      payload?.ws_url ||
      payload?.data?.wsUrl ||
      payload?.data?.ws_url;

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


    /* ===================================================
       OPEN
    =================================================== */

    ws.onopen = () => {

      if (
        generation !==
        state.tradingGeneration
      ) {

        try {
          ws.close();
        } catch (_) {}

        return;

      }

      state.tradingConnecting =
        false;

      state.tradingReconnectAttempts =
        0;

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

      /*
       * Balance subscription.
       */
      try {

        sendTrading({

          balance:
            1,

          subscribe:
            1,

          req_id:
            nextRequestId()

        });

      } catch (error) {

        log(
          "Balance subscription failed: " +
          error.message
        );

      }

      /*
       * Do not duplicate market ticks here.
       * The public WebSocket owns market data.
       */

      /*
       * Generate a proposal only after the
       * trading channel is ready.
       */
      updateProposal();

    };


    /* ===================================================
       MESSAGE
    =================================================== */

    ws.onmessage =
      event => {

        if (
          generation !==
          state.tradingGeneration
        ) {

          return;

        }

        let data;

        try {

          data =
            JSON.parse(
              event.data
            );

        } catch (error) {

          log(
            "Trading message parse error: " +
            error.message
          );

          return;

        }

        handleTradingMessage(
          data
        );

      };


    /* ===================================================
       ERROR
    =================================================== */

    ws.onerror =
      () => {

        if (
          generation !==
          state.tradingGeneration
        ) {

          return;

        }

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


    /* ===================================================
       CLOSE
    =================================================== */

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

        state.tradingConnecting =
          false;

        state.tradingWS =
          null;

        state.balanceSubscriptionId =
          null;

        state.proposalSubscriptionId =
          null;

        state.contractSubscriptionId =
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

    state.tradingReady =
      false;

    state.tradingConnecting =
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
      MAX_RECONNECT_DELAY,
      TRADE_RECONNECT_BASE *
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
      !state.proposal?.id ||
      !canTrade();

  }

  if (sellBtn) {

    sellBtn.disabled =
      !enabled ||
      !state.contractId;

  }

}


/* =======================================================
   RISK GATE
======================================================= */

function canTrade() {

  if (
    !state.tradingReady
  ) {

    return false;

  }

  if (
    state.risk.tradesThisSession >=
    state.risk.maxTradesPerSession
  ) {

    return false;

  }

  if (
    state.risk.consecutiveLosses >=
    state.risk.maxConsecutiveLosses
  ) {

    return false;

  }

  return true;

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
   FORGET SUBSCRIPTION
======================================================= */

function forgetTradingSubscription(
  subscriptionId
) {

  if (
    !subscriptionId
  ) {

    return;

  }

  if (
    !state.tradingWS ||
    state.tradingWS.readyState !==
      WebSocket.OPEN
  ) {

    return;

  }

  try {

    sendTrading({

      forget:
        subscriptionId,

      req_id:
        nextRequestId()

    });

  } catch (error) {

    log(
      "Could not cancel subscription: " +
      error.message
    );

  }

}


/* =======================================================
   TRADING MESSAGE
======================================================= */

function handleTradingMessage(
  data
) {

  if (
    data.error
  ) {

    log(
      "Deriv trading error",
      data.error
    );

    /*
     * Proposal errors should not leave a stale
     * proposal available for BUY.
     */
    if (
      data.echo_req?.proposal
    ) {

      state.proposal =
        null;

      setTradingButtons(
        true
      );

    }

    return;

  }


  /* =====================================================
     BALANCE
  ===================================================== */

  if (
    data.msg_type ===
      "balance" &&
    data.balance
  ) {

    if (
      data.subscription?.id
    ) {

      state.balanceSubscriptionId =
        data.subscription.id;

    }

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


  /* =====================================================
     PROPOSAL
  ===================================================== */

  if (
    data.msg_type ===
      "proposal" &&
    data.proposal
  ) {

    /*
     * Ignore proposal responses from an older
     * request when req_id is available.
     */
    const responseReqId =
      data.req_id;

    const subscriptionId =
      data.subscription?.id;

    const isCurrentSubscription =
      Boolean(
        subscriptionId &&
        state.proposalSubscriptionId &&
        String(subscriptionId) ===
          String(state.proposalSubscriptionId)
      );

    if (
      state.proposalRequestId !==
        null &&
      responseReqId !==
        undefined &&
      Number(responseReqId) !==
        Number(
          state.proposalRequestId
        ) &&
      !isCurrentSubscription
    ) {

      return;

    }

    state.proposal =
      data.proposal;

    if (
      data.subscription?.id
    ) {

      state.proposalSubscriptionId =
        data.subscription.id;

    }

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


  /* =====================================================
     BUY
  ===================================================== */

  if (
    data.msg_type ===
      "buy" &&
    data.buy
  ) {

    state.contractId =
      data.buy.contract_id;

    state.risk.tradesThisSession++;

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
      data.buy.profit ??
        "0"
    );

    setText(
      "contractBuyPrice",
      data.buy.buy_price ??
        "—"
    );

    /*
     * A proposal is consumed by the purchase.
     */
    state.proposal =
      null;

    setTradingButtons(
      true
    );

    log(
      "Contract purchased.",
      data.buy
    );

    /*
     * Monitor the open contract.
     */
    if (
      data.buy.contract_id
    ) {

      /*
       * Cancel an older contract stream first.
       */
      forgetTradingSubscription(
        state.contractSubscriptionId
      );

      state.contractSubscriptionId =
        null;

      try {

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

    if (
      data.subscription?.id
    ) {

      state.contractSubscriptionId =
        data.subscription.id;

    }

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

    const status =
      String(
        contract.status ||
        ""
      ).toLowerCase();

    const finished =
      [
        "sold",
        "won",
        "lost",
        "expired"
      ].includes(
        status
      );

    if (finished) {

      /*
       * Record the result for session protection.
       */
      if (
        status ===
        "lost"
      ) {

        state.risk.consecutiveLosses++;

      } else if (
        status ===
          "won" ||
        status ===
          "sold"
      ) {

        state.risk.consecutiveLosses =
          0;

      }

      /*
       * Contract is no longer sellable.
       */
      state.contractId =
        null;

      /*
       * Stop the contract subscription.
       */
      forgetTradingSubscription(
        state.contractSubscriptionId
      );

      state.contractSubscriptionId =
        null;

    }

    setTradingButtons(
      state.tradingReady
    );

    return;

  }


  /* =====================================================
     SELL
  ===================================================== */

  if (
    data.msg_type ===
      "sell" &&
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

    state.contractId =
      null;

    forgetTradingSubscription(
      state.contractSubscriptionId
    );

    state.contractSubscriptionId =
      null;

    setTradingButtons(
      true
    );

    return;

  }

}


/* =======================================================
   DIGIT CONTRACT MODE
======================================================= */

function enforceDigitContractMode() {

  const select =
    $("contractType");

  if (!select) {
    return;
  }

  const current =
    String(
      select.value ||
      ""
    ).toUpperCase();

  Array.from(
    select.options
  ).forEach(
    option => {
      const value =
        String(
          option.value ||
          ""
        ).toUpperCase();

      if (
        !DIGIT_CONTRACT_TYPES.includes(
          value
        )
      ) {
        option.remove();
      }
    }
  );

  if (!select.options.length) {
    DIGIT_CONTRACT_TYPES.forEach(
      type => {
        const option =
          document.createElement("option");

        option.value =
          type;

        option.textContent =
          type === "DIGITMATCH"
            ? "Matches Digit"
            : type === "DIGITOVER"
              ? "Over"
              : "Under";

        select.appendChild(option);
      }
    );
  }

  if (
    !DIGIT_CONTRACT_TYPES.includes(
      current
    )
  ) {
    select.value =
      "DIGITMATCH";
  }

}


/* =======================================================
   PREDICTION -> TRADE PANEL SYNC
======================================================= */

function syncPredictionToTradePanel(
  prediction
) {

  if (
    !prediction ||
    !state.tradingReady ||
    !state.account
  ) {
    return;
  }

  enforceDigitContractMode();

  const params =
    getProposalParameters();

  let barrier =
    params.barrierInput;

  if (
    params.contractType === "DIGITMATCH" &&
    Number.isInteger(
      prediction.match?.prediction
    )
  ) {
    barrier =
      String(
        prediction.match.prediction
      );
  } else if (
    (params.contractType === "DIGITOVER" ||
      params.contractType === "DIGITUNDER") &&
    Number.isInteger(
      prediction.over?.threshold
    )
  ) {
    barrier =
      String(
        prediction.over.threshold
      );
  }

  if (
    barrier === undefined ||
    barrier === null ||
    String(barrier).trim() === ""
  ) {
    return;
  }

  const barrierField =
    $("barrier");

  if (
    barrierField &&
    !barrierField.matches(":focus")
  ) {
    barrierField.value =
      String(barrier);
  }

  const key =
    [
      state.symbol,
      params.contractType,
      barrier,
      params.amount,
      params.duration,
      params.durationUnit
    ].join("|");

  if (
    key ===
      state.bot.lastProposalPredictionKey &&
    state.proposal?.id
  ) {
    return;
  }

  state.bot.lastProposalPredictionKey =
    key;

  updateProposal();

}


/* =======================================================
   PROPOSAL PARAMETERS
======================================================= */

function getProposalParameters() {

  enforceDigitContractMode();

  const currency =
    state.account?.currency ||
    state.account?.currency_code ||
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

  const rawContractType =
    $("contractType")?.value ||
    "DIGITMATCH";

  const contractType =
    String(
      rawContractType
    ).toUpperCase();

  const barrierInput =
    $("barrier")?.value;

  return {

    currency,

    amount:
      Number.isFinite(amount)
        ? amount
        : 1,

    duration:
      Number.isFinite(duration)
        ? duration
        : 1,

    durationUnit,

    contractType,

    barrierInput

  };

}


/* =======================================================
   VALIDATE PROPOSAL PARAMETERS
======================================================= */

function validateProposalParameters(
  params
) {

  if (
    !params.currency ||
    params.currency ===
      "—"
  ) {

    return {
      valid: false,
      error:
        "Account currency is not available."
    };

  }

  if (
    !Number.isFinite(
      params.amount
    ) ||
    params.amount <= 0
  ) {

    return {
      valid: false,
      error:
        "Stake must be greater than zero."
    };

  }

  if (
    params.amount >
    state.risk.maxStake
  ) {

    return {
      valid: false,
      error:
        `Stake exceeds the ${state.risk.maxStake} session safety ceiling.`
    };

  }

  if (
    !Number.isFinite(
      params.duration
    ) ||
    params.duration <= 0
  ) {

    return {
      valid: false,
      error:
        "Duration must be greater than zero."
    };

  }

  const validUnits =
    [
      "t",
      "s",
      "m",
      "h",
      "d"
    ];

  if (
    !validUnits.includes(
      params.durationUnit
    )
  ) {

    return {
      valid: false,
      error:
        "Invalid duration unit."
    };

  }

  if (
    !DIGIT_CONTRACT_TYPES.includes(
      params.contractType
    )
  ) {

    return {
      valid: false,
      error:
        "This terminal currently supports DIGITMATCH, DIGITOVER and DIGITUNDER."
    };

  }

  return {
    valid: true
  };

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

  const params =
    getProposalParameters();

  const validation =
    validateProposalParameters(
      params
    );

  if (
    !validation.valid
  ) {

    log(
      validation.error
    );

    return;

  }

  /*
   * Always invalidate the old proposal before
   * requesting a new one.
   */
  if (
    state.proposalSubscriptionId
  ) {

    forgetTradingSubscription(
      state.proposalSubscriptionId
    );

    state.proposalSubscriptionId =
      null;

  }

  state.proposal =
    null;

  setText(
    "proposalId",
    "REQUESTING..."
  );

  setText(
    "askPrice",
    "—"
  );

  setText(
    "payout",
    "—"
  );

  /*
   * Never use a stale predictor prediction.
   */
  const prediction =
    state.bot.lastStats;


  const request = {

    proposal:
      1,

    amount:
      params.amount,

    basis:
      "stake",

    contract_type:
      params.contractType,

    currency:
      params.currency,

    underlying_symbol:
      state.symbol,

    duration:
      params.duration,

    duration_unit:
      params.durationUnit,

    req_id:
      nextRequestId()

  };

  /*
   * Save the request ID so a stale proposal
   * response can be ignored.
   */
  state.proposalRequestId =
    request.req_id;


  /* =====================================================
     DIGIT MATCH
  ===================================================== */

  if (
    params.contractType ===
      "DIGITMATCH"
  ) {

    let barrier =
      params.barrierInput;

    /*
     * Only automatically suggest the model digit
     * if the model has enough validated data.
     */
    if (
      Number.isInteger(
        prediction?.match?.prediction
      )
    ) {

      barrier =
        String(
          prediction.match.prediction
        );

    }

    /*
     * If no barrier was supplied and the model is
     * not validated, do not silently invent one.
     */
    if (
      barrier === undefined ||
      barrier === null ||
      String(barrier).trim() === ""
    ) {

      log(
        "DIGITMATCH proposal blocked: no validated prediction/barrier."
      );

      setText(
        "proposalId",
        "NO VALIDATED BARRIER"
      );

      return;

    }

    const digit =
      Number(barrier);

    if (
      !Number.isInteger(digit) ||
      digit < 0 ||
      digit > 9
    ) {

      log(
        "DIGITMATCH barrier must be an integer from 0 to 9."
      );

      return;

    }

    request.barrier =
      String(digit);

  }


  /* =====================================================
     DIGIT OVER
  ===================================================== */

  if (
    params.contractType ===
      "DIGITOVER"
  ) {

    let barrier =
      params.barrierInput;

    if (
      Number.isInteger(
        prediction?.over?.threshold
      )
    ) {

      barrier =
        String(
          prediction.over.threshold
        );

    }

    if (
      barrier === undefined ||
      barrier === null ||
      String(barrier).trim() === ""
    ) {

      log(
        "DIGITOVER proposal blocked: no validated threshold."
      );

      setText(
        "proposalId",
        "NO VALIDATED BARRIER"
      );

      return;

    }

    const threshold =
      Number(barrier);

    if (
      !Number.isInteger(threshold) ||
      threshold < 0 ||
      threshold > 8
    ) {

      log(
        "DIGITOVER barrier must be an integer from 0 to 8."
      );

      return;

    }

    request.barrier =
      String(threshold);

  }


  /* =====================================================
     DIGIT UNDER
  ===================================================== */

  if (
    params.contractType ===
      "DIGITUNDER"
  ) {

    let barrier =
      params.barrierInput;

    if (
      Number.isInteger(
        prediction?.over?.threshold
      )
    ) {

      barrier =
        String(
          prediction.over.threshold
        );

    }

    if (
      barrier === undefined ||
      barrier === null ||
      String(barrier).trim() === ""
    ) {

      log(
        "DIGITUNDER proposal blocked: no validated threshold."
      );

      setText(
        "proposalId",
        "NO VALIDATED BARRIER"
      );

      return;

    }

    const threshold =
      Number(barrier);

    if (
      !Number.isInteger(threshold) ||
      threshold < 1 ||
      threshold > 9
    ) {

      log(
        "DIGITUNDER barrier must be an integer from 1 to 9."
      );

      return;

    }

    request.barrier =
      String(threshold);

  }


  /*
   * IMPORTANT:
   *
   * Proposal subscriptions are not required for the
   * predictor. They are used here so the proposal can
   * update with price changes when supported.
   *
   * The subscription ID is tracked and cancelled
   * whenever a new proposal is requested.
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
    !canTrade()
  ) {

    log(
      "BUY blocked by session risk controls."
    );

    return;

  }

  if (
    !state.proposal?.id
  ) {

    log(
      "Cannot buy: no current proposal available."
    );

    return;

  }

  /*
   * Require current market data.
   */
  const tickAge =
    state.lastLiveTickAt
      ? Date.now() -
        state.lastLiveTickAt
      : Infinity;

  if (
    tickAge > 10000
  ) {

    log(
      "BUY blocked: market tick is stale."
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
    ) ||
    askPrice <= 0
  ) {

    log(
      "Cannot buy: invalid proposal price."
    );

    return;

  }

  /*
   * Explicit confirmation is deliberately kept.
   */
  const confirmed =
    window.confirm(
      `BUY ${state.proposal.contract_type || "contract"}?\n\n` +
      `Stake: ${$("stake")?.value || "—"}\n` +
      `Ask price: ${askPrice}\n` +
      `Payout: ${state.proposal.payout ?? "—"}\n` +
      `Symbol: ${state.symbol}\n\n` +
      `This order will be sent to Deriv.`
    );

  if (!confirmed) {

    log(
      "BUY cancelled by user."
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

  const confirmed =
    window.confirm(
      `Sell contract ${state.contractId} at market?`
    );

  if (!confirmed) {

    log(
      "SELL cancelled by user."
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

        /*
         * Do not silently submit a new trade proposal.
         * The user must press Quote after changing
         * the threshold.
         */

        state.proposal =
          null;

        setTradingButtons(
          state.tradingReady
        );

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

    if (
      symbol ===
      state.symbol
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

    /*
     * Any existing proposal is now stale because
     * it belongs to the previous symbol.
     */
    invalidateProposal();

    log(
      `Changing market to ${symbol}.`
    );

    connectPublicMarket();

    /*
     * Trading WebSocket remains connected.
     *
     * We intentionally do not automatically submit
     * a new proposal. User must request a fresh quote.
     */

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
      event =>
        changeSymbol(
          event.target.value
        )
    );

  }


  if (botSymbol) {

    botSymbol.value =
      state.symbol;

    botSymbol.addEventListener(
      "change",
      event =>
        changeSymbol(
          event.target.value
        )
    );

  }

}


/* =======================================================
   INVALIDATE PROPOSAL
======================================================= */

function invalidateProposal() {

  forgetTradingSubscription(
    state.proposalSubscriptionId
  );

  state.proposalSubscriptionId =
    null;

  state.proposal =
    null;

  state.proposalRequestId =
    null;

  state.bot.lastProposalPredictionKey =
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

  setTradingButtons(
    state.tradingReady
  );

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
   STAKE CONTROLS
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

            const max =
              Number(
                input.max ||
                state.risk.maxStake
              );

            value =
              Math.max(
                min,
                Math.min(
                  max,
                  value
                )
              );

            input.value =
              value.toFixed(
                2
              );

            /*
             * Existing proposal no longer matches
             * the stake.
             */
            invalidateProposal();

          }
        );

      }
    );

}


/* =======================================================
   PROPOSAL FORM INPUTS
======================================================= */

function setupProposalInputs() {

  enforceDigitContractMode();

  const ids = [

    "stake",
    "duration",
    "durationUnit",
    "contractType",
    "barrier"

  ];

  ids.forEach(
    id => {

      const element =
        $(id);

      if (!element) {
        return;
      }

      element.addEventListener(
        "change",
        () => {

          /*
           * Never automatically submit a new proposal
           * just because an input changed.
           *
           * The old proposal is invalid.
           */
          invalidateProposal();

          state.bot.lastProposalPredictionKey =
            null;

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

          box.textContent =
            "";

        }

      };

  }

}


/* =======================================================
   MARKET HEALTH MONITOR
======================================================= */

function startMarketHealthMonitor() {

  setInterval(
    () => {

      if (
        !state.marketWS ||
        state.marketWS.readyState !==
          WebSocket.OPEN
      ) {

        return;

      }

      if (
        !state.lastLiveTickAt
      ) {

        return;

      }

      const age =
        Date.now() -
        state.lastLiveTickAt;

      if (
        age > 15000
      ) {

        setStatus(
          false,
          "Market stale"
        );

      } else {

        setStatus(
          true,
          "Market online"
        );

      }

    },
    5000
  );

}


/* =======================================================
   PAGE VISIBILITY
======================================================= */

document.addEventListener(
  "visibilitychange",
  () => {

    /*
     * We keep the public stream alive.
     *
     * If the browser/platform has closed it while
     * the page was hidden, reconnect when visible.
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
   WINDOW RESIZE
======================================================= */

window.addEventListener(
  "resize",
  drawChart
);


/* =======================================================
   BEFORE UNLOAD
======================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    try {

      if (
        state.marketWS &&
        state.marketWS.readyState ===
          WebSocket.OPEN
      ) {

        state.marketWS.send(
          JSON.stringify({

            forget_all:
              "ticks",

            req_id:
              nextRequestId()

          })
        );

      }

    } catch (_) {}

    try {

      if (
        state.tradingWS &&
        state.tradingWS.readyState ===
          WebSocket.OPEN
      ) {

        state.tradingWS.send(
          JSON.stringify({

            forget_all:
              [
                "balance",
                "proposal",
                "proposal_open_contract"
              ],

            req_id:
              nextRequestId()

          })
        );

      }

    } catch (_) {}

  }
);


/* =======================================================
   INITIALIZATION
======================================================= */

async function initializeApp() {

  log(
    "TRADERS HUB hardened engine initialized."
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

  setTradingButtons(
    false
  );

  startMarketHealthMonitor();

  /*
   * Public market starts independently of login.
   */
  setTimeout(
    () => {

      connectPublicMarket();

    },
    MARKET_INITIAL_DELAY
  );

  /*
   * Authentication/trading is independent.
   */
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
