"use strict";

/*
  TRADERS HUB trading compatibility layer.

  Loaded after app.js. It corrects the UI/trading contract set without
  replacing the hardened market/authentication engine.

  Contracts:
    DIGITMATCH
    DIGITEVEN
    DIGITODD
    DIGITOVER
    DIGITUNDER

  Duration units exposed:
    ticks
    seconds

  Rise/Fall and minutes are intentionally removed.
*/

(function () {
  const CONTRACTS = [
    ["DIGITMATCH", "Digit Match"],
    ["DIGITEVEN", "Even"],
    ["DIGITODD", "Odd"],
    ["DIGITOVER", "Digit Over"],
    ["DIGITUNDER", "Digit Under"]
  ];

  const FALLBACK_MARKETS = [
    ["1HZ5V", "Volatility 5 (1s)"],
    ["1HZ10V", "Volatility 10 (1s)"],
    ["1HZ15V", "Volatility 15 (1s)"],
    ["1HZ25V", "Volatility 25 (1s)"],
    ["1HZ30V", "Volatility 30 (1s)"],
    ["1HZ50V", "Volatility 50 (1s)"],
    ["1HZ75V", "Volatility 75 (1s)"],
    ["1HZ90V", "Volatility 90 (1s)"],
    ["1HZ100V", "Volatility 100 (1s)"],
    ["1HZ150V", "Volatility 150 (1s)"],
    ["1HZ250V", "Volatility 250 (1s)"],
    ["R_5", "Volatility 5"],
    ["R_10", "Volatility 10"],
    ["R_15", "Volatility 15"],
    ["R_25", "Volatility 25"],
    ["R_30", "Volatility 30"],
    ["R_50", "Volatility 50"],
    ["R_75", "Volatility 75"],
    ["R_90", "Volatility 90"],
    ["R_100", "Volatility 100"],
    ["R_250", "Volatility 250"]
  ];

  function writeLog(message, data) {
    try {
      if (typeof log === "function") log(message, data ?? null);
      else console.log("TRADERS HUB FIX:", message, data ?? "");
    } catch (_) {}
  }

  function rebuildSelect(select, items, selectedValue) {
    if (!select) return;
    select.innerHTML = "";
    items.forEach(function (item) {
      const option = document.createElement("option");
      option.value = item[0];
      option.textContent = item[1];
      select.appendChild(option);
    });
    if (selectedValue && items.some(x => x[0] === selectedValue)) {
      select.value = selectedValue;
    } else if (items.length) {
      select.value = items[0][0];
    }
  }

  function updateBarrierVisibility() {
    const type = document.getElementById("contractType")?.value;
    const barrier = document.getElementById("barrier");
    if (!barrier) return;
    const needsBarrier =
      type === "DIGITMATCH" ||
      type === "DIGITOVER" ||
      type === "DIGITUNDER";
    barrier.disabled = !needsBarrier;
  }

  function setupContractUI() {
    const select = document.getElementById("contractType");
    if (select) {
      const current = select.value;
      rebuildSelect(
        select,
        CONTRACTS,
        CONTRACTS.some(x => x[0] === current) ? current : "DIGITMATCH"
      );
    }

    const durationUnit = document.getElementById("durationUnit");
    if (durationUnit) {
      rebuildSelect(
        durationUnit,
        [["t", "ticks"], ["s", "sec"]],
        durationUnit.value === "s" ? "s" : "t"
      );
    }

    const duration = document.getElementById("duration");
    if (duration) {
      duration.min = "1";
      duration.step = "1";
      if (!Number.isFinite(Number(duration.value)) || Number(duration.value) <= 0) {
        duration.value = "5";
      }
    }

    const barrier = document.getElementById("barrier");
    if (barrier) {
      barrier.min = "0";
      barrier.max = "9";
      barrier.step = "1";
      if (!Number.isFinite(Number(barrier.value))) barrier.value = "5";
    }

    updateBarrierVisibility();
  }

  function sortMarkets(items) {
    return items.sort(function (a, b) {
      const an = Number((a[1].match(/\d+/) || ["0"])[0]);
      const bn = Number((b[1].match(/\d+/) || ["0"])[0]);
      if (an !== bn) return an - bn;
      const ah = /High Frequency/i.test(a[1]);
      const bh = /High Frequency/i.test(b[1]);
      if (ah !== bh) return ah ? 1 : -1;
      return a[1].localeCompare(b[1]);
    });
  }

  function populateFallbackMarkets() {
    const select = document.getElementById("symbolSelect");
    if (!select) return;
    const current =
      (typeof state !== "undefined" && state.symbol) ||
      select.value ||
      "1HZ100V";
    rebuildSelect(select, FALLBACK_MARKETS.slice(), current);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function loadAllVolatilityMarkets() {
    const select = document.getElementById("symbolSelect");
    if (!select) return;

    const current = select.value || "1HZ100V";
    let finished = false;

    const ws = new WebSocket(
      "wss://api.derivws.com/trading/v1/options/ws/public"
    );

    const finishFallback = function (message, data) {
      if (finished) return;
      finished = true;
      try { clearTimeout(timeout); } catch (_) {}
      try { ws.close(); } catch (_) {}
      populateFallbackMarkets();
      writeLog(message, data);
    };

    const timeout = setTimeout(function () {
      finishFallback(
        "Volatility market discovery timed out; fallback list loaded."
      );
    }, 8000);

    ws.onopen = function () {
      try {
        ws.send(JSON.stringify({
          active_symbols: "brief",
          req_id: 900001
        }));
      } catch (error) {
        finishFallback(
          "Could not request volatility markets; fallback list loaded.",
          error.message
        );
      }
    };

    ws.onmessage = function (event) {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (data.error) {
        finishFallback(
          "Volatility market discovery failed; fallback list loaded.",
          data.error
        );
        return;
      }

      if (data.msg_type !== "active_symbols" ||
          !Array.isArray(data.active_symbols)) {
        return;
      }

      finished = true;
      clearTimeout(timeout);

      const markets = data.active_symbols
        .map(function (item) {
          return [
            item.symbol || item.underlying_symbol || "",
            item.display_name || item.name || item.symbol || ""
          ];
        })
        .filter(function (item) {
          const name = item[1];
          return (
            item[0] &&
            item[1] &&
            /volatility/i.test(name) &&
            !/volatility\s+switch/i.test(name)
          );
        });

      const unique = Array.from(
        new Map(markets.map(x => [x[0], x])).values()
      );

      if (!unique.length) {
        populateFallbackMarkets();
        writeLog("No volatility symbols returned; fallback list loaded.");
      } else {
        sortMarkets(unique);
        rebuildSelect(select, unique, current);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        writeLog(`Loaded ${unique.length} volatility market(s).`);
      }

      try { ws.close(); } catch (_) {}
    };

    ws.onerror = function () {
      finishFallback(
        "Volatility market discovery WebSocket failed; fallback list loaded."
      );
    };
  }

  function getParams() {
    const currency =
      state.account?.currency ||
      state.account?.currency_code ||
      document.getElementById("currency")?.textContent ||
      "USD";

    const amount = Number(document.getElementById("stake")?.value || 1);
    const duration = Number(document.getElementById("duration")?.value || 5);
    const unit =
      document.getElementById("durationUnit")?.value === "s" ? "s" : "t";
    const type =
      document.getElementById("contractType")?.value || "DIGITMATCH";
    const barrier = document.getElementById("barrier")?.value;

    return {
      currency,
      amount: Number.isFinite(amount) ? amount : 1,
      duration: Number.isFinite(duration) ? duration : 5,
      durationUnit: unit,
      contractType: type,
      barrier
    };
  }

  function validate(params) {
    if (!state.tradingReady || !state.account) {
      return "Trading account is not ready.";
    }
    if (!params.currency || params.currency === "—") {
      return "Account currency is not available.";
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return "Stake must be greater than zero.";
    }
    if (params.amount > state.risk.maxStake) {
      return `Stake exceeds the ${state.risk.maxStake} session safety ceiling.`;
    }
    if (!Number.isFinite(params.duration) || params.duration <= 0) {
      return "Duration must be greater than zero.";
    }
    if (params.durationUnit !== "t" && params.durationUnit !== "s") {
      return "Duration must be ticks or seconds.";
    }
    if (!CONTRACTS.some(x => x[0] === params.contractType)) {
      return "Unsupported digit contract.";
    }
    return null;
  }

  function patchedUpdateProposal() {
    const params = getParams();
    const error = validate(params);

    if (error) {
      writeLog(error);
      return;
    }

    if (state.proposalSubscriptionId) {
      forgetTradingSubscription(state.proposalSubscriptionId);
      state.proposalSubscriptionId = null;
    }

    state.proposal = null;
    state.proposalRequestId = null;

    setText("proposalId", "REQUESTING...");
    setText("askPrice", "—");
    setText("payout", "—");

    const request = {
      proposal: 1,
      amount: params.amount,
      basis: "stake",
      contract_type: params.contractType,
      currency: params.currency,
      underlying_symbol: state.symbol,
      duration: params.duration,
      duration_unit: params.durationUnit,
      subscribe: 1,
      req_id: nextRequestId()
    };

    if (params.contractType === "DIGITMATCH") {
      let digit = Number(params.barrier);
      const prediction = state.bot?.lastStats?.match;
      if (prediction?.highConfidence && Number.isInteger(prediction.prediction)) {
        digit = prediction.prediction;
      }
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
        setText("proposalId", "INVALID DIGIT");
        writeLog("Digit Match requires a digit from 0 to 9.");
        return;
      }
      request.barrier = String(digit);
    }

    if (params.contractType === "DIGITOVER") {
      let threshold = Number(params.barrier);
      const prediction = state.bot?.lastStats?.over;
      if (prediction?.highConfidence && Number.isInteger(prediction.threshold)) {
        threshold = prediction.threshold;
      }
      if (!Number.isInteger(threshold) || threshold < 0 || threshold > 8) {
        setText("proposalId", "INVALID BARRIER");
        writeLog("Digit Over requires a barrier from 0 to 8.");
        return;
      }
      request.barrier = String(threshold);
    }

    if (params.contractType === "DIGITUNDER") {
      let threshold = Number(params.barrier);
      const prediction = state.bot?.lastStats?.over;
      if (prediction?.highConfidence && Number.isInteger(prediction.threshold)) {
        threshold = prediction.threshold;
      }
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 9) {
        setText("proposalId", "INVALID BARRIER");
        writeLog("Digit Under requires a barrier from 1 to 9.");
        return;
      }
      request.barrier = String(threshold);
    }

    try {
      state.proposalRequestId = request.req_id;
      sendTrading(request);
      writeLog("Requested live proposal.", request);
    } catch (error) {
      setText("proposalId", "REQUEST FAILED");
      writeLog("Proposal request failed: " + error.message);
    }
  }

  function renderPosition(contract) {
    const empty = document.getElementById("positionEmpty");
    const position = document.getElementById("position");
    if (!empty || !position) return;

    if (!contract) {
      empty.style.display = "block";
      position.style.display = "none";
      return;
    }

    empty.style.display = "none";
    position.style.display = "grid";

    setText("contractId", contract.contract_id ?? "—");
    setText(
      "contractStatus",
      contract.status ?? contract.contract_status ?? "OPEN"
    );
    setText(
      "contractProfit",
      contract.profit ?? contract.sell_price ?? "—"
    );
    setText("contractBuyPrice", contract.buy_price ?? "—");

    state.contractId = contract.contract_id || state.contractId;
    if (typeof setTradingButtons === "function") {
      setTradingButtons(state.tradingReady);
    }
  }

  let lastPortfolioGeneration = -1;

  function requestPortfolio() {
    if (!state.tradingReady ||
        !state.tradingWS ||
        state.tradingWS.readyState !== WebSocket.OPEN) {
      return;
    }

    if (lastPortfolioGeneration === state.tradingGeneration) return;
    lastPortfolioGeneration = state.tradingGeneration;

    try {
      sendTrading({
        portfolio: 1,
        req_id: nextRequestId()
      });
      writeLog("Checking open positions.");
    } catch (error) {
      writeLog("Portfolio request failed: " + error.message);
    }
  }

  function patchTradingMessages() {
    if (window.__tradersHubPortfolioPatch) return;
    window.__tradersHubPortfolioPatch = true;

    const originalHandler = handleTradingMessage;

    handleTradingMessage = function (data) {
      originalHandler(data);

      if (data?.msg_type === "portfolio" && data.portfolio) {
        const contracts = Array.isArray(data.portfolio.contracts)
          ? data.portfolio.contracts
          : [];
        renderPosition(contracts[0] || null);
      }
    };
  }

  function bindControls() {
    const quote = document.getElementById("quoteBtn");
    const contract = document.getElementById("contractType");
    const duration = document.getElementById("duration");
    const durationUnit = document.getElementById("durationUnit");
    const barrier = document.getElementById("barrier");
    const refresh = document.getElementById("refreshBtn");

    if (quote) quote.onclick = patchedUpdateProposal;

    [contract, duration, durationUnit, barrier].forEach(function (element) {
      if (!element || element.dataset.tradersHubFixInput === "1") return;
      element.dataset.tradersHubFixInput = "1";
      element.addEventListener("change", function () {
        invalidateProposal();
        updateBarrierVisibility();
      });
    });

    if (refresh && refresh.dataset.tradersHubFixBound !== "1") {
      refresh.dataset.tradersHubFixBound = "1";
      refresh.onclick = function () {
        lastPortfolioGeneration = -1;
        requestPortfolio();
      };
    }
  }

  function start() {
    setupContractUI();
    bindControls();
    patchTradingMessages();

    setInterval(function () {
      try {
        if (
          state.digits &&
          state.digits.length >= state.bot.minimumSamples &&
          !state.bot.lastStats
        ) {
          updatePredictionBot();
        }
      } catch (_) {}
    }, 2000);

    setInterval(function () {
      try {
        if (
          state.tradingReady &&
          lastPortfolioGeneration !== state.tradingGeneration
        ) {
          requestPortfolio();
        }
      } catch (_) {}
    }, 1000);

    loadAllVolatilityMarkets();

    writeLog(
      "Trading fixes loaded: all discovered Volatility markets + Match/Even/Odd/Over/Under + ticks/seconds."
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
