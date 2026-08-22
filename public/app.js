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

const DIGIT_CONTRACT_TYPES = [
  "DIGITMATCH",
  "DIGITDIFF",
  "DIGITOVER",
  "DIGITUNDER",
  "DIGITEVEN",
  "DIGITODD"
];

const FALLBACK_VOLATILITY_MARKETS = [
  ["1HZ10V", "Volatility 10 (1s)"],
  ["1HZ25V", "Volatility 25 (1s)"],
  ["1HZ50V", "Volatility 50 (1s)"],
  ["1HZ75V", "Volatility 75 (1s)"],
  ["1HZ100V", "Volatility 100 (1s)"]
];

const DEFAULT_HISTORY_LIMIT =
  500;

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
   RUNTIME DIAGNOSTICS
======================================================= */

window.addEventListener("error", event => {
  try {
    const message = event?.error?.message || event?.message || "Unknown browser error";
    const box = document.getElementById("log");
    if (box) {
      box.textContent = `[${new Date().toLocaleTimeString()}] APP ERROR: ${message}\n${box.textContent}`;
    }
    console.error("TRADERS HUB APP ERROR", event.error || event.message);
  } catch (_) {}
});

window.addEventListener("unhandledrejection", event => {
  try {
    const reason = event?.reason?.message || String(event?.reason || "Unknown promise rejection");
    const box = document.getElementById("log");
    if (box) {
      box.textContent = `[${new Date().toLocaleTimeString()}] APP ASYNC ERROR: ${reason}\n${box.textContent}`;
    }
    console.error("TRADERS HUB APP ASYNC ERROR", event.reason);
  } catch (_) {}
});


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

    /* Evidence thresholds for the exact next-digit candidate. */
    baselineDigitRate:
      10,

    minimumCandidateSignals:
      20,

    minimumCandidateAccuracy:
      20,

    minimumRecentSignals:
      8,

    minimumRecentAccuracy:
      15,

    threshold:
      4,

    lastStats:
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
   REAL-TIME PRICE CHART
======================================================= */

function drawChart() {

  const canvas = $("chart");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(220, Math.min(300, rect.height || 260));
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { top: 16, right: 18, bottom: 24, left: 12 };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = Math.max(1, height - pad.top - pad.bottom);
  const visible = state.prices.slice(-120);

  ctx.fillStyle = "#0a0f19";
  ctx.fillRect(0, 0, width, height);

  /* subtle trading-terminal grid */
  ctx.strokeStyle = "rgba(120,135,160,.14)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }
  for (let i = 0; i <= 6; i++) {
    const x = pad.left + (plotW / 6) * i;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, height - pad.bottom); ctx.stroke();
  }

  if (visible.length < 2) {
    ctx.fillStyle = "rgba(180,190,205,.65)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("Waiting for live ticks…", pad.left + 8, pad.top + 20);
    return;
  }

  const min = Math.min(...visible);
  const max = Math.max(...visible);
  const range = max - min || Math.max(Math.abs(max) * 0.000001, 1);
  const yOf = price => pad.top + (1 - (price - min) / range) * plotH;
  const xOf = i => pad.left + (i / (visible.length - 1)) * plotW;

  /* area fill */
  const area = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  area.addColorStop(0, "rgba(255,61,105,.22)");
  area.addColorStop(1, "rgba(255,61,105,0)");
  ctx.beginPath();
  visible.forEach((price, i) => {
    const x = xOf(i), y = yOf(price);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(xOf(visible.length - 1), height - pad.bottom);
  ctx.lineTo(xOf(0), height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = area;
  ctx.fill();

  /* price line */
  ctx.beginPath();
  visible.forEach((price, i) => {
    const x = xOf(i), y = yOf(price);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#ff3d69";
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  const last = visible[visible.length - 1];
  const lastX = xOf(visible.length - 1);
  const lastY = yOf(last);

  /* current-price guide */
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = "rgba(255,255,255,.24)";
  ctx.beginPath(); ctx.moveTo(pad.left, lastY); ctx.lineTo(width - pad.right, lastY); ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#ff3d69";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 1;
  ctx.stroke();

  /* compact price labels */
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillStyle = "rgba(190,200,215,.72)";
  ctx.textAlign = "right";
  ctx.fillText(String(max), width - 4, pad.top + 10);
  ctx.fillText(String(min), width - 4, height - pad.bottom - 2);

}


/* =======================================================
   PROPOSAL PARAMETERS
======================================================= */

function getProposalParameters() {

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

  const contractType =
    $("contractType")?.value ||
    "DIGITMATCH";

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

  const validContractTypes =
    DIGIT_CONTRACT_TYPES;

  if (
    !validContractTypes.includes(
      params.contractType
    )
  ) {

    return {
      valid: false,
      error:
        "This terminal supports digit Match, Differs, Over, Under, Even and Odd contracts only."
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
      prediction?.match?.highConfidence &&
      Number.isInteger(
        prediction.match.prediction
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
     DIGIT DIFFERS
  ===================================================== */

  if (params.contractType === "DIGITDIFF") {

    let barrier = params.barrierInput;

    if (
      prediction?.match?.highConfidence &&
      Number.isInteger(prediction.match.prediction)
    ) {
      barrier = String(prediction.match.prediction);
    }

    if (barrier === undefined || barrier === null || String(barrier).trim() === "") {
      setText("proposalId", "ENTER DIGIT 0–9");
      log("DIGITDIFF requires a digit barrier from 0 to 9.");
      return;
    }

    const digit = Number(barrier);
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
      log("DIGITDIFF barrier must be an integer from 0 to 9.");
      return;
    }

    request.barrier = String(digit);
  }

  /* =====================================================
     DIGIT EVEN / ODD
  ===================================================== */

  if (
    params.contractType === "DIGITEVEN" ||
    params.contractType === "DIGITODD"
  ) {
    /* These contracts intentionally have no barrier. */
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
      prediction?.over?.highConfidence &&
      prediction.over.prediction ===
        "OVER"
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
      prediction?.over?.highConfidence &&
      prediction.over.prediction ===
        "UNDER"
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
   DIGIT-ONLY MARKET / CONTRACT OPTIONS
======================================================= */

function configureDigitOnlyContractTypes() {

  const select = $("contractType");

  if (!select) return;

  const current = select.value;

  select.innerHTML = "";

  const labels = {
    DIGITMATCH: "Digit Match",
    DIGITDIFF: "Digit Differs",
    DIGITOVER: "Digit Over",
    DIGITUNDER: "Digit Under",
    DIGITEVEN: "Digit Even",
    DIGITODD: "Digit Odd"
  };

  DIGIT_CONTRACT_TYPES.forEach(type => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = labels[type];
    select.appendChild(option);
  });

  select.value = DIGIT_CONTRACT_TYPES.includes(current)
    ? current
    : "DIGITMATCH";
}

function configureDigitBarrierUI() {

  const type = $("contractType")?.value || "DIGITMATCH";
  const barrier = $("barrier");
  if (!barrier) return;

  const wrapper = barrier.closest("label") || barrier.parentElement;
  const needsBarrier = ["DIGITMATCH", "DIGITDIFF", "DIGITOVER", "DIGITUNDER"].includes(type);

  barrier.disabled = !needsBarrier;
  barrier.placeholder = type === "DIGITMATCH" || type === "DIGITDIFF"
    ? "0–9"
    : type === "DIGITOVER"
      ? "0–8"
      : "1–9";

  if (wrapper) {
    wrapper.style.opacity = needsBarrier ? "1" : "0.55";
  }
}

function populateVolatilityMarkets(markets) {

  const select = $("symbolSelect");
  const botSelect = $("botSymbol");
  if (!select) return;

  const unique = new Map();
  markets.forEach(item => {
    if (!item?.symbol) return;
    unique.set(item.symbol, item.name || item.symbol);
  });

  if (!unique.size) {
    FALLBACK_VOLATILITY_MARKETS.forEach(([symbol, name]) => unique.set(symbol, name));
  }

  const sorted = [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
  const previous = state.symbol;

  select.innerHTML = "";
  sorted.forEach(([symbol, name]) => {
    const option = document.createElement("option");
    option.value = symbol;
    option.textContent = name;
    select.appendChild(option);
  });

  if (!unique.has(previous)) {
    state.symbol = unique.has(DEFAULT_SYMBOL) ? DEFAULT_SYMBOL : sorted[0]?.[0] || DEFAULT_SYMBOL;
  }

  select.value = state.symbol;
  setText("symbolName", select.selectedOptions?.[0]?.text || state.symbol);

  if (botSelect) {
    botSelect.innerHTML = "";
    sorted.forEach(([symbol, name]) => {
      const option = document.createElement("option");
      option.value = symbol;
      option.textContent = name;
      botSelect.appendChild(option);
    });
    botSelect.value = state.symbol;
  }
}

function requestVolatilityMarkets(ws) {

  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  try {
    ws.send(JSON.stringify({
      active_symbols: "full",
      contract_type: ["DIGITMATCH"],
      req_id: nextRequestId()
    }));
  } catch (error) {
    log("Could not request volatility markets: " + error.message);
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

  configureDigitOnlyContractTypes();
  configureDigitBarrierUI();

  const contractType = $("contractType");
  if (contractType) {
    contractType.addEventListener("change", () => {
      configureDigitBarrierUI();
      invalidateProposal();
    });
  }

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

  setupAuthButtons();

  setupBotControls();

  setupMarketControls();

  configureDigitOnlyContractTypes();
  configureDigitBarrierUI();

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
