const $ = (id) => document.getElementById(id);

const state = {
  publicWs: null,
  authWs: null,
  symbol: "1HZ100V",
  prices: [],
  previous: null,
  proposal: null,
  contractId: null,
  account: null,
  accounts: []
};

function log(message, data) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  $("log").textContent = `${line}${data ? "\n" + JSON.stringify(data, null, 2) : ""}\n` + $("log").textContent;
}

function setStatus(online, text) {
  $("connectionDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("connectionText").textContent = text;
}

function money(value, currency = "") {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "—";
  return `${currency ? currency + " " : ""}${Number(value).toFixed(2)}`;
}

function drawChart() {
  const canvas = $("chart");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(260 * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const w = rect.width, h = 260;

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#202735";
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const y = (h / 5) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (state.prices.length < 2) return;
  const min = Math.min(...state.prices), max = Math.max(...state.prices);
  const range = max - min || 1;
  ctx.strokeStyle = "#ff3d69";
  ctx.lineWidth = 2;
  ctx.beginPath();

  state.prices.forEach((p, i) => {
    const x = (i / (state.prices.length - 1)) * w;
    const y = h - ((p - min) / range) * (h - 24) - 12;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function connectPublicMarket() {
  if (state.publicWs) {
    try { state.publicWs.close(); } catch {}
  }

  setStatus(false, "Connecting market…");
  const ws = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
  state.publicWs = ws;

  ws.onopen = () => {
    setStatus(true, "Market live");
    log("Public market connected.");
    ws.send(JSON.stringify({
      ticks_history: state.symbol,
      end: "latest",
      count: 80,
      style: "ticks",
      subscribe: 0,
      req_id: 1
    }));
    ws.send(JSON.stringify({
      ticks: state.symbol,
      subscribe: 1,
      req_id: 2
    }));
  };

  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.error) {
      log("Market error", data.error);
      return;
    }

    if (data.msg_type === "history" && data.history?.prices) {
      state.prices = data.history.prices.map(Number).slice(-100);
      drawChart();
    }

    if (data.msg_type === "tick" && data.tick) {
      const quote = Number(data.tick.quote);
      state.previous = state.prices.length ? state.prices[state.prices.length - 1] : quote;
      state.prices.push(quote);
      state.prices = state.prices.slice(-100);

      $("price").textContent = quote;
      $("lastTick").textContent = new Date(Number(data.tick.epoch) * 1000).toLocaleTimeString();
      const diff = quote - state.previous;
      const change = $("priceChange");
      change.className = `change ${diff > 0 ? "up" : diff < 0 ? "down" : "neutral"}`;
      change.textContent = diff > 0 ? "UP" : diff < 0 ? "DOWN" : "FLAT";
      drawChart();
    }
  };

  ws.onerror = () => {
    setStatus(false, "Market connection error");
  };

  ws.onclose = () => {
    setStatus(false, "Market disconnected");
    setTimeout(() => connectPublicMarket(), 3000);
  };
}

async function getAuthStatus() {
  const r = await fetch("/api/auth/status");
  return r.json();
}

async function loadAccounts() {
  const response = await fetch("/api/accounts");
  const data = await response.json();

  if (!response.ok) throw new Error(data?.errors?.[0]?.message || data.error || "Could not load accounts.");

  state.accounts = Array.isArray(data.data) ? data.data : [];
  const select = $("accountSelect");
  select.innerHTML = "";

  if (!state.accounts.length) {
    select.innerHTML = "<option>No Options account found</option>";
    return;
  }

  state.accounts.forEach((a) => {
    const option = document.createElement("option");
    option.value = a.account_id;
    option.textContent = `${a.account_id} • ${a.account_type || "account"} • ${a.currency || "USD"}`;
    select.appendChild(option);
  });

  select.disabled = false;
  state.account = state.accounts[0];
  updateAccountUI();
  await connectAuthenticated();
}

function updateAccountUI() {
  if (!state.account) return;
  $("accountBadge").textContent = state.account.account_type === "demo" ? "DEMO" : "REAL";
  $("accountBadge").className = `badge ${state.account.account_type === "demo" ? "good" : ""}`;
  $("balance").textContent = money(state.account.balance, state.account.currency);
  $("currency").textContent = state.account.currency || "—";
}

async function connectAuthenticated() {
  if (!state.account) return;

  if (state.authWs) {
    try { state.authWs.close(); } catch {}
  }

  const response = await fetch("/api/ws-url", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({accountId: state.account.account_id})
  });
  const data = await response.json();

  if (!response.ok || !data.url) {
    throw new Error(data?.errors?.[0]?.message || data.error || "Could not authenticate trading WebSocket.");
  }

  const ws = new WebSocket(data.url);
  state.authWs = ws;

  ws.onopen = () => {
    log(`Authenticated ${state.account.account_type} WebSocket connected.`);
    enableTrading(true);
    ws.send(JSON.stringify({balance: 1, subscribe: 1, req_id: 100}));
    ws.send(JSON.stringify({portfolio: 1, req_id: 101}));
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.error) {
      log("Trading API error", msg.error);
      return;
    }

    if (msg.msg_type === "balance" && msg.balance) {
      $("balance").textContent = money(msg.balance.balance, msg.balance.currency);
      if (state.account) {
        state.account.balance = msg.balance.balance;
        state.account.currency = msg.balance.currency;
      }
    }

    if (msg.msg_type === "proposal" && msg.proposal) {
      state.proposal = msg.proposal;
      $("proposalId").textContent = msg.proposal.id || "—";
      $("askPrice").textContent = money(msg.proposal.ask_price, state.account?.currency);
      $("payout").textContent = money(msg.proposal.payout, state.account?.currency);
      $("buyBtn").disabled = !msg.proposal.id;
      log("Live proposal received.", {
        id: msg.proposal.id,
        ask_price: msg.proposal.ask_price,
        payout: msg.proposal.payout
      });
    }

    if (msg.msg_type === "buy" && msg.buy) {
      state.contractId = msg.buy.contract_id;
      $("contractId").textContent = state.contractId;
      $("contractBuyPrice").textContent = money(msg.buy.buy_price, state.account?.currency);
      $("positionEmpty").classList.add("hidden");
      $("position").classList.remove("hidden");
      $("sellBtn").disabled = false;
      log("Contract purchased.", msg.buy);
      ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: state.contractId,
        subscribe: 1,
        req_id: 300
      }));
    }

    if (msg.msg_type === "proposal_open_contract" && msg.proposal_open_contract) {
      const c = msg.proposal_open_contract;
      $("contractStatus").textContent = c.status || (c.is_sold ? "sold" : "open");
      $("contractProfit").textContent = money(c.profit, state.account?.currency);
      if (c.is_sold) {
        $("sellBtn").disabled = true;
        log("Contract closed.", c);
      }
    }

    if (msg.msg_type === "portfolio" && msg.portfolio) {
      const contracts = msg.portfolio.contracts || [];
      if (contracts.length && !state.contractId) {
        state.contractId = contracts[0].contract_id;
        $("contractId").textContent = state.contractId;
      }
    }
  };

  ws.onerror = () => log("Authenticated WebSocket error.");
  ws.onclose = () => {
    enableTrading(false);
    log("Authenticated WebSocket closed.");
  };
}

function enableTrading(enabled) {
  $("quoteBtn").disabled = !enabled;
  $("refreshBtn").disabled = !enabled;
}

function requestProposal() {
  if (!state.authWs || state.authWs.readyState !== WebSocket.OPEN) {
    alert("Login and select an account first.");
    return;
  }

  const amount = Number($("stake").value);
  const duration = Number($("duration").value);
  const durationUnit = $("durationUnit").value;
  const contractType = $("contractType").value;

  if (!amount || amount <= 0 || !duration || duration <= 0) {
    alert("Enter a valid stake and duration.");
    return;
  }

  state.proposal = null;
  $("proposalId").textContent = "REQUESTING…";
  $("askPrice").textContent = "—";
  $("payout").textContent = "—";
  $("buyBtn").disabled = true;

  state.authWs.send(JSON.stringify({
    proposal: 1,
    amount,
    basis: "stake",
    contract_type: contractType,
    currency: state.account.currency,
    duration_unit: durationUnit,
    duration,
    underlying_symbol: state.symbol,
    subscribe: 0,
    req_id: 200
  }));
}

function buyProposal() {
  if (!state.proposal?.id || !state.authWs || state.authWs.readyState !== WebSocket.OPEN) return;

  const price = Number(state.proposal.ask_price);
  if (!price || price <= 0) return;

  if (state.account?.account_type !== "demo") {
    const ok = confirm("This is NOT a demo account. Buying can place a real-money trade. Continue?");
    if (!ok) return;
  }

  state.authWs.send(JSON.stringify({
    buy: String(state.proposal.id),
    price,
    req_id: 250
  }));
  $("buyBtn").disabled = true;
}

function sellOpen() {
  if (!state.contractId || !state.authWs || state.authWs.readyState !== WebSocket.OPEN) return;
  const ok = confirm("Sell the open contract at market price?");
  if (!ok) return;
  state.authWs.send(JSON.stringify({
    sell: Number(state.contractId),
    price: 0,
    req_id: 400
  }));
}

async function initAuthUI() {
  const status = await getAuthStatus();
  if (status.authenticated) {
    $("loginBtn").classList.add("hidden");
    $("logoutBtn").classList.remove("hidden");
    try {
      await loadAccounts();
      log("Deriv login session is active.");
    } catch (err) {
      log("Could not load accounts: " + err.message);
    }
  } else {
    $("loginBtn").classList.remove("hidden");
    $("logoutBtn").classList.add("hidden");
    enableTrading(false);
  }
}

$("loginBtn").onclick = () => {
  window.location.href = "/auth/login";
};

$("logoutBtn").onclick = async () => {
  await fetch("/auth/logout", {method: "POST"});
  location.reload();
};

$("accountSelect").onchange = async (e) => {
  state.account = state.accounts.find(a => a.account_id === e.target.value);
  state.contractId = null;
  $("position").classList.add("hidden");
  $("positionEmpty").classList.remove("hidden");
  $("sellBtn").disabled = true;
  updateAccountUI();
  try {
    await connectAuthenticated();
  } catch (err) {
    log("Account connection failed: " + err.message);
  }
};

$("symbolSelect").onchange = (e) => {
  state.symbol = e.target.value;
  $("symbolCode").textContent = state.symbol;
  $("symbolName").textContent = e.target.options[e.target.selectedIndex].textContent;
  state.prices = [];
  state.previous = null;
  connectPublicMarket();
};

$("quoteBtn").onclick = requestProposal;
$("buyBtn").onclick = buyProposal;
$("sellBtn").onclick = sellOpen;

$("refreshBtn").onclick = async () => {
  if (state.account) await connectAuthenticated();
};

document.querySelectorAll("[data-step]").forEach((button) => {
  button.onclick = () => {
    const input = $("stake");
    const next = Math.max(0.35, Number(input.value) + Number(button.dataset.step) * 0.5);
    input.value = next.toFixed(2);
  };
});

$("clearLog").onclick = () => $("log").textContent = "";

window.addEventListener("resize", drawChart);

connectPublicMarket();
initAuthUI();
