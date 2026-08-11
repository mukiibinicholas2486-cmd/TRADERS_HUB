/* =========================================================
   TRADERS HUB - PUBLIC MARKET WEBSOCKET FIX
   ========================================================= */

(function () {
  "use strict";

  const DERIV_WS_URL =
    "wss://ws.derivws.com/websockets/v3?app_id=1089";

  let marketWS = null;
  let reconnectTimer = null;
  let manuallyClosed = false;

  function getSymbol() {
    if (window.state && window.state.symbol) {
      return window.state.symbol;
    }

    const botSymbol = document.getElementById("botSymbol");
    if (botSymbol && botSymbol.value) {
      return botSymbol.value;
    }

    const symbolSelect = document.getElementById("symbolSelect");
    if (symbolSelect && symbolSelect.value) {
      return symbolSelect.value;
    }

    return "1HZ100V";
  }

  function updateStatus(online, message) {
    try {
      if (typeof window.setStatus === "function") {
        window.setStatus(online, message);
        return;
      }
    } catch (e) {}

    const status =
      document.getElementById("marketStatus") ||
      document.querySelector(".status-dot");

    if (status) {
      status.textContent = message || (online ? "Market online" : "Market offline");
    }
  }

  function sendQuoteToApp(quote) {
    if (quote === undefined || quote === null) return;

    try {
      if (typeof window.processBotMarketTick === "function") {
        window.processBotMarketTick(quote);
      }
    } catch (e) {
      console.warn("processBotMarketTick error:", e);
    }

    try {
      if (typeof window.addMarketTick === "function") {
        window.addMarketTick(quote);
      }
    } catch (e) {}

    try {
      if (window.state) {
        if (!Array.isArray(window.state.prices)) {
          window.state.prices = [];
        }

        window.state.prices.push(Number(quote));

        if (window.state.prices.length > 200) {
          window.state.prices.shift();
        }
      }
    } catch (e) {}

    const priceElements = [
      document.getElementById("marketPrice"),
      document.getElementById("botPrice"),
      document.getElementById("price"),
      document.querySelector(".market-price")
    ];

    for (const element of priceElements) {
      if (element) {
        element.textContent = quote;
      }
    }
  }

  function connectPublicMarket() {
    manuallyClosed = false;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (marketWS) {
      try {
        marketWS.onopen = null;
        marketWS.onmessage = null;
        marketWS.onerror = null;
        marketWS.onclose = null;
        marketWS.close();
      } catch (e) {}

      marketWS = null;
    }

    const symbol = getSymbol();

    updateStatus(false, "Connecting...");

    console.log("Connecting to Deriv public market:", symbol);

    try {
      marketWS = new WebSocket(DERIV_WS_URL);

      marketWS.onopen = function () {
        console.log("Deriv public WebSocket connected:", symbol);

        updateStatus(true, "Market online");

        marketWS.send(
          JSON.stringify({
            ticks: symbol,
            subscribe: 1
          })
        );
      };

      marketWS.onmessage = function (event) {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            console.error("Deriv WebSocket error:", data.error);
            updateStatus(false, "Market error");
            return;
          }

          if (data.tick && data.tick.quote !== undefined) {
            const quote = Number(data.tick.quote);

            if (!Number.isNaN(quote)) {
              sendQuoteToApp(quote);
            }
          }
        } catch (error) {
          console.error("Market message error:", error);
        }
      };

      marketWS.onerror = function (error) {
        console.error("Deriv public WebSocket error:", error);
        updateStatus(false, "Market offline");
      };

      marketWS.onclose = function () {
        marketWS = null;

        if (manuallyClosed) {
          return;
        }

        updateStatus(false, "Market disconnected. Reconnecting...");

        if (!reconnectTimer) {
          reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connectPublicMarket();
          }, 5000);
        }
      };
    } catch (error) {
      console.error("Could not create market WebSocket:", error);

      updateStatus(false, "Market offline");

      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        connectPublicMarket();
      }, 5000);
    }
  }

  function changeMarketSymbol(symbol) {
    if (!symbol) return;

    if (window.state) {
      window.state.symbol = symbol;
      window.state.prices = [];
      window.state.digits = [];
    }

    console.log("Market changed to:", symbol);

    connectPublicMarket();
  }

  /* Replace the old global connection function */
  window.connectPublicMarket = connectPublicMarket;

  /* Keep symbol selector working */
  document.addEventListener("change", function (event) {
    const target = event.target;

    if (!target) return;

    if (
      target.id === "botSymbol" ||
      target.id === "symbolSelect"
    ) {
      changeMarketSymbol(target.value);
    }
  });

  /* Start after this script has loaded */
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        setTimeout(connectPublicMarket, 300);
      }
    );
  } else {
    setTimeout(connectPublicMarket, 300);
  }

  /* Allow other code to access the connection */
  window.marketWS = marketWS;
})();
