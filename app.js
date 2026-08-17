/* =========================================================
   TRADERS HUB — CLEAN APP.JS
   Deriv Options Terminal + Digit Analyzer
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


function setText(id, value) {
  const element = $(id);

  if (element) {
    element.textContent = value;
  }
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

  prices: [],

  digits: [],

  previous: null,

  marketWS: null,

  reconnectTimer: null,

  marketGeneration: 0,

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
   DIGIT / PRICE HELPERS
   ========================================================= */

function lastDigitFromPrice(price) {

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

  /*
    The quote is converted to a string so the final
    displayed decimal digit is used.
  */

  const text = String(price);

  const digits =
    text.replace(/\D/g, "");

  if (!digits.length) {
    return null;
  }

  return Number(
    digits[digits.length - 1]
  );
}


/* =========================================================
   MARKET UI
   ========================================================= */

function updatePriceUI(quote, epoch) {

  setText("price", quote);

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

  const canvas = $("chart");

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

  const height = 260;

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

  ctx.lineWidth = 1;

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


  const min =
    Math.min(
      ...state.prices
    );

  const max =
    Math.max(
      ...state.prices
    );

  const range =
    max - min || 1;


  ctx.strokeStyle =
    "#ff3d69";

  ctx.lineWidth = 2;

  ctx.beginPath();


  state.prices.forEach(
    (price, index) => {

      const x =
        (
          index /
          (state.prices.length - 1)
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

  state.previous = null;

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

  drawChart();
}


/* =========================================================
   ADD ONE MARKET TICK
   ========================================================= */

function processMarketTick(
  quote,
  epoch
) {

  const price =
    Number(quote);

  if (!Number.isFinite(price)) {
    return;
  }


  /* PRICE */

  updatePriceUI(
    price,
    epoch
  );


  /* PRICE HISTORY */

  state.prices.push(
    price
  );

  if (
    state.prices.length > 100
  ) {
    state.prices.shift();
  }


  /* LAST DIGIT */

  const digit =
    lastDigitFromPrice(price);

  if (
    digit !== null
  ) {

    state.digits.push(
      digit
    );

    if (
      state.digits.length >
      state.bot.window
    ) {

      state.digits =
        state.digits.slice(
          -state.bot.window
        );

    }

    setText(
      "lastDigit",
      digit
    );

    setText(
      "botDigit",
      digit
    );
  }


  /* CHART */

  drawChart();


  /* BOT */

  updatePredictionBot();
}


/* =========================================================
   LOAD HISTORICAL TICKS
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

      ticks_history: symbol,

      count: 100,

      end: "latest",

      style: "ticks",

      subscribe: 0

    })
  );

  log(
    `Requested 100 historical ticks for ${symbol}.`
  );
}


/* =========================================================
   PUBLIC MARKET WEBSOCKET
   ========================================================= */

function connectPublicMarket() {

  const generation =
    ++state.marketGeneration;


  /* CLOSE OLD SOCKET */

  if (state.marketWS) {

    try {

      state.marketWS.onopen = null;

      state.marketWS.onmessage = null;

      state.marketWS.onerror = null;

      state.marketWS.onclose = null;

      state.marketWS.close();

    } catch (error) {

      console.warn(
        "Error closing old WebSocket:",
        error
      );

    }

    state.marketWS = null;
  }


  /* CANCEL RECONNECT */

  if (
    state.reconnectTimer
  ) {

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


  const symbol =
    state.symbol ||
    "1HZ100V";


  log(
    `Connecting to ${symbol}...`
  );


  /*
    Current Deriv public Options WebSocket.
    No authentication is required for market data.
  */

  const ws =
    new WebSocket(
      "wss://api.derivws.com/trading/v1/options/ws/public"
    );


  state.marketWS =
    ws;


  /* =======================================================
     OPEN
     ======================================================= */

  ws.onopen = () => {

    if (
      generation !==
      state.marketGeneration
    ) {
      return;
    }


    setStatus(
      true,
      "Market online"
    );


    log(
      "Market WebSocket connected."
    );


    /* HISTORY */

    loadHistoricalTicks(
      ws,
      symbol
    );


    /* LIVE TICKS */

    ws.send(
      JSON.stringify({

        ticks: symbol,

        subscribe: 1

      })
    );


    log(
      `Subscribed to ${symbol}.`
    );

  };


  /* =======================================================
     MESSAGE
     ======================================================= */

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


      /* -----------------------------------------------
         ERROR
         ----------------------------------------------- */

      if (
        data.error
      ) {

        log(
          "Deriv market error",
          data.error
        );

        return;
      }


      /* -----------------------------------------------
         HISTORICAL DATA
         ----------------------------------------------- */

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


        /*
          Load history without calling the live
          tick function 100 separate times.
        */

        state.prices =
          prices
            .map(Number)
            .filter(
              Number.isFinite
            )
            .slice(-100);


        state.digits = [];


        state.prices.forEach(
          price => {

            const digit =
              lastDigitFromPrice(
                price
              );

            if (
              digit !== null
            ) {

              state.digits.push(
                digit
              );

            }

          }
        );


        state.digits =
          state.digits.slice(
            -state.bot.window
          );


        if (
          state.prices.length
        ) {

          const latestPrice =
            state.prices[
              state.prices.length - 1
            ];

          const latestTime =
            times[
              times.length - 1
            ];


          updatePriceUI(
            latestPrice,
            latestTime
          );


          const latestDigit =
            lastDigitFromPrice(
              latestPrice
            );


          if (
            latestDigit !== null
          ) {

            setText(
              "lastDigit",
              latestDigit
            );

            setText(
              "botDigit",
              latestDigit
            );

          }

        }


        setText(
          "dataQuality",
          `${state.digits.length} ticks analysed`
        );


        drawChart();

        updatePredictionBot();


        log(
          `Loaded ${state.digits.length} historical ticks.`
        );


        return;
      }


      /* -----------------------------------------------
         LIVE TICK
         ----------------------------------------------- */

      if (
        data.msg_type ===
        "tick" &&
        data.tick
      ) {

        const quote =
          Number(
            data.tick.quote
          );

        const epoch =
          Number(
            data.tick.epoch
          );


        if (
          !Number.isFinite(
            quote
          )
        ) {
          return;
        }


        processMarketTick(
          quote,
          epoch
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


  /* =======================================================
     ERROR
     ======================================================= */

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


  /* =======================================================
     CLOSE
     ======================================================= */

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


    state.reconnectTimer =
      setTimeout(
        () => {

          if (
            generation ===
            state.marketGeneration
          ) {

            log(
              "Reconnecting market..."
            );

            connectPublicMarket();

          }

        },
        5000
      );

  };

}


/* =========================================================
   PREDICTION ENGINE
   ========================================================= */

function setBotText(
  id,
  text
) {

  const element =
    $(id);

  if (element) {
    element.textContent =
      text;
  }

}


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
}


/* =========================================================
   DIGIT STATISTICS
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


  /* =======================================================
     MATCH
     ======================================================= */

  const matchWindow =
    Math.min(
      60,
      digits.length - 1
    );


  let matchWins = 0;

  let matchSamples = 0;


  const matchStart =
    Math.max(
      1,
      digits.length -
      matchWindow
    );


  for (
    let i = matchStart;
    i < digits.length;
    i++
  ) {

    const train =
      digits.slice(
        Math.max(
          0,
          i - matchWindow
        ),
        i
      );


    if (!train.length) {
      continue;
    }


    const counts =
      Array(10).fill(0);


    train.forEach(
      digit => {

        counts[digit]++;

      }
    );


    let prediction = 0;


    for (
      let digit = 1;
      digit < 10;
      digit++
    ) {

      if (
        counts[digit] >
        counts[prediction]
      ) {

        prediction =
          digit;

      }

    }


    if (
      digits[i] ===
      prediction
    ) {

      matchWins++;

    }


    matchSamples++;

  }


  /* Current match prediction */

  const currentTrain =
    digits.slice(
      -matchWindow
    );


  const currentCounts =
    Array(10).fill(0);


  currentTrain.forEach(
    digit => {

      currentCounts[digit]++;

    }
  );


  let currentMatch =
    0;


  for (
    let digit = 1;
    digit < 10;
    digit++
  ) {

    if (
      currentCounts[digit] >
      currentCounts[currentMatch]
    ) {

      currentMatch =
        digit;

    }

  }


  result.match = {

    digit: currentMatch,

    wins: matchWins,

    samples: matchSamples,

    accuracy:
      matchSamples
        ? (
            matchWins /
            matchSamples
          ) * 100
        : 0

  };


  /* =======================================================
     EVEN / ODD
     ======================================================= */

  const parityWindow =
    Math.min(
      60,
      digits.length - 1
    );


  let evenWins = 0;

  let evenSamples = 0;


  const parityStart =
    Math.max(
      1,
      digits.length -
      parityWindow
    );


  for (
    let i = parityStart;
    i < digits.length;
    i++
  ) {

    const train =
      digits.slice(
        Math.max(
          0,
          i - parityWindow
        ),
        i
      );


    let evens = 0;

    let odds = 0;


    train.forEach(
      digit => {

        if (
          digit % 2 === 0
        ) {

          evens++;

        } else {

          odds++;

        }

      }
    );


    const prediction =
      evens >= odds
        ? "EVEN"
        : "ODD";


    const actual =
      digits[i] % 2 === 0
        ? "EVEN"
        : "ODD";


    if (
      prediction ===
      actual
    ) {

      evenWins++;

    }


    evenSamples++;

  }


  let currentEvens = 0;

  let currentOdds = 0;


  digits
    .slice(-parityWindow)
    .forEach(
      digit => {

        if (
          digit % 2 === 0
        ) {

          currentEvens++;

        } else {

          currentOdds++;

        }

      }
    );


  result.even = {

    prediction:
      currentEvens >=
      currentOdds
        ? "EVEN"
        : "ODD",

    wins:
      evenWins,

    samples:
      evenSamples,

    accuracy:
      evenSamples
        ? (
            evenWins /
            evenSamples
          ) * 100
        : 0

  };


  /* =======================================================
     OVER / UNDER
     ======================================================= */

  const threshold =
    Number(
      $("botThreshold")?.value ??
      state.bot.threshold
    );


  state.bot.threshold =
    Number.isFinite(
      threshold
    )
      ? threshold
      : 4;


  const ouWindow =
    Math.min(
      60,
      digits.length - 1
    );


  let ouWins = 0;

  let ouSamples = 0;


  const ouStart =
    Math.max(
      1,
      digits.length -
      ouWindow
    );


  for (
    let i = ouStart;
    i < digits.length;
    i++
  ) {

    const train =
      digits.slice(
        Math.max(
          0,
          i - ouWindow
        ),
        i
      );


    let over = 0;

    let under = 0;


    train.forEach(
      digit => {

        if (
          digit >
          state.bot.threshold
        ) {

          over++;

        } else {

          under++;

        }

      }
    );


    const prediction =
      over >= under
        ? "OVER"
        : "UNDER";


    const actual =
      digits[i] >
      state.bot.threshold
        ? "OVER"
        : "UNDER";


    if (
      prediction ===
      actual
    ) {

      ouWins++;

    }


    ouSamples++;

  }


  let currentOver = 0;

  let currentUnder = 0;


  digits
    .slice(-ouWindow)
    .forEach(
      digit => {

        if (
          digit >
          state.bot.threshold
        ) {

          currentOver++;

        } else {

          currentUnder++;

        }

      }
    );


  result.over = {

    threshold:
      state.bot.threshold,

    prediction:
      currentOver >=
      currentUnder
        ? "OVER"
        : "UNDER",

    wins:
      ouWins,

    samples:
      ouSamples,

    accuracy:
      ouSamples
        ? (
            ouWins /
            ouSamples
          ) * 100
        : 0

  };


  return result;
}


/* =========================================================
   UPDATE PREDICTION UI
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


  /* =======================================================
     MATCH UI
     ======================================================= */

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


  /* =======================================================
     EVEN UI
     ======================================================= */

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


  /* =======================================================
     OVER / UNDER UI
     ======================================================= */

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


  /* =======================================================
     OVERALL FILTER
     ======================================================= */

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
   ACCOUNT / AUTHENTICATION
   ========================================================= */

async function loadAuthAndAccounts() {

  const loginBtn =
    $("loginBtn");

  const logoutBtn =
    $("logoutBtn");

  const accountBadge =
    $("accountBadge");

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


    log(
      "Authentication status",
      auth
    );


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


    /* LOGGED IN */

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

    console.warn(
      "accountSelect not found."
    );

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
      "Could not load Deriv accounts."
    );

  }


  const payload =
    await response.json();


  /*
    Your current backend has returned data as:

    {
      "data": [
        {
          "account_id": "...",
          "balance": "...",
          "currency": "...",
          "account_type": "demo"
        }
      ]
    }

    This parser supports that plus a few common variants.
  */

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


  const accountId =
    selected.value;


  state.account =
    state.accounts.find(
      account => {

        return (
          account.account_id ===
            accountId ||
          account.accountId ===
            accountId ||
          account.loginid ===
            accountId
        );

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

}


/* =========================================================
   LOGIN / LOGOUT
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
          "Prediction bot refreshed."
        );

      };

  }


  const threshold =
    $("botThreshold");


  if (threshold) {

    threshold.addEventListener(
      "change",
      () => {

        state.bot.threshold =
          Number(
            threshold.value
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
    $("symbolSelect");

  const botSymbol =
    $("botSymbol");


  /*
    Keep the two dropdowns synchronized.
  */

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
   ACCOUNT SELECT LISTENER
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
    "TRADERS HUB initialized."
  );


  setupAuthButtons();

  setupBotControls();

  setupMarketControls();

  setupAccountControls();


  updatePredictionBot();


  /*
    Market data does not require login.
  */

  setTimeout(
    () => {

      connectPublicMarket();

    },
    300
  );


  /*
    Authentication/account loading.
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
