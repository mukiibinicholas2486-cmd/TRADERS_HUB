const $ = id => document.getElementById(id);

const state = {
  publicWs: null,
  authWs: null,
  authReconnectTimer: null,
  authConnecting: false,
  symbol: "1HZ100V",
  prices: [],
  digits: [],
  previous: null,
  proposal: null,
  contractId: null,
  account: null,
  accounts: [],
  prediction: null,
  reconnectAttempt: 0
};

function log(message, data) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  $("log").textContent = `${line}${data ? "\n" + JSON.stringify(data, null, 2) : ""}\n` + $("log").textContent;
}

function money(v, c = "") {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return `${c ? c + " " : ""}${Number(v).toFixed(2)}`;
}

function setStatus(online, text) {
  $("connectionDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("connectionText").textContent = text;
}

function lastDigitOf(price) {
  const m = String(price).match(/(\d)$/);
  return m ? Number(m[1]) : null;
}

function rebuildDigits() {
  state.digits = state.prices.map(lastDigitOf).filter(d => d !== null);
  $("lastDigit").textContent = state.digits.length ? state.digits.at(-1) : "—";
}

function predictionFrom(history, threshold = 4) {
  if (history.length < 60) return null;

  const counts = Array(10).fill(0);
  history.forEach(d => counts[d]++);
  const total = history.length;
  const target = counts.indexOf(Math.max(...counts));
  const matchProb = counts[target] / total;

  const overCount = history.filter(d => d > threshold).length;
  const underCount = total - overCount;
  const ouTarget = overCount >= underCount ? "over" : "under";
  const ouProb = Math.max(overCount, underCount) / total;

  const candidates = [
    { type: "DIGITMATCH", label: `MATCH ${target}`, barrier: target, probability: matchProb },
    { type: ouTarget === "over" ? "DIGITOVER" : "DIGITUNDER", label: `${ouTarget.toUpperCase()} ${threshold}`, barrier: threshold, probability: ouProb }
  ];

  candidates.sort((a, b) => b.probability - a.probability);
  const best = candidates[0];

  return {
    ...best,
    sampleCount: total,
    confidence: best.probability,
    threshold
  };
}

function walkForwardAccuracy(history, type, threshold = 4) {
  if (history.length < 70) return null;

  const warm = 30;
  const start = Math.max(warm, history.length - 80);
  let wins = 0;
  let samples = 0;

  for (let i = start; i < history.length; i++) {
    const h = history.slice(0, i);
    const counts = Array(10).fill(0);
    h.forEach(d => counts[d]++);

    if (type === "DIGITMATCH") {
      const target = counts.indexOf(Math.max(...counts));
      wins += history[i] === target ? 1 : 0;
    } else {
      const over = h.filter(d => d > threshold).length;
      const under = h.length - over;
      const target = over >= under ? "over" : "under";
      wins += target === "over" ? (history[i] > threshold ? 1 : 0) : (history[i] <= threshold ? 1 : 0);
    }
    samples++;
  }

  return samples ? { wins, samples, accuracy: wins / samples } : null;
}

function updatePredictor() {
  rebuildDigits();
  const n = state.digits.length;
  $("dataQuality").textContent = n >= 60 ? `${n} digits ready` : `${n}/60 digits`;

  const threshold = Number($("botThreshold").value) || 4;
  const p = predictionFrom(state.digits.slice(-100), threshold);

  if (!p) {
    state.prediction = null;
    $("prediction").textContent = "WAITING FOR DATA";
    $("predictionMeta").textContent = "Need at least 60 digits.";
    $("filterStatus").textContent = "Waiting for enough ticks.";
    updateBarrierUI();
    return;
  }

  const bt = walkForwardAccuracy(state.digits.slice(-100), p.type, threshold);
  state.prediction = bt && bt.samples >= 30 && bt.accuracy >= 0.80 ? { ...p, ...bt } : null;

  $("prediction").textContent = p.label;
  $("predictionMeta").textContent = bt
    ? `${(p.confidence * 100).toFixed(1)}% frequency • ${(bt.accuracy * 100).toFixed(1)}% walk-forward accuracy • ${bt.samples} samples`
    : `${(p.confidence * 100).toFixed(1)}% frequency`;

  $("filterStatus").textContent = state.prediction
    ? `VALIDATED • ${state.prediction.type} • barrier ${state.prediction.barrier}`
    : "NO VALIDATED PREDICTION — 80% historical filter not met.";

  updateBarrierUI();
}

function drawChart() {
  const canvas = $("chart");
  const rect = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = 260 * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = 260;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#202735";
  for (let i = 1; i < 5; i++) {
    const y = h / 5 * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  if (state.prices.length < 2) return;
  const min = Math.min(...state.prices), max = Math.max(...state.prices), range = max - min || 1;
  ctx.strokeStyle = "#ff3d69"; ctx.lineWidth = 2; ctx.beginPath();
  state.prices.forEach((p, i) => {
    const x = i / (state.prices.length - 1) * w;
    const y = h - ((p - min) / range) * (h - 24) - 12;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

function connectPublicMarket() {
  if (state.publicWs) try { state.publicWs.close(); } catch {}
  setStatus(false, "Connecting market…");
  const ws = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
  state.publicWs = ws;

  ws.onopen = () => {
    setStatus(true, "Market live");
    log("Public market connected.");
    ws.send(JSON.stringify({ ticks_history: state.symbol, end: "latest", count: 100, style: "ticks", subscribe: 0, req_id: 1 }));
    ws.send(JSON.stringify({ ticks: state.symbol, subscribe: 1, req_id: 2 }));
  };

  ws.onmessage = e => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.error) return log("Market error", d.error);
    if (d.msg_type === "history" && d.history?.prices) {
      state.prices = d.history.prices.map(Number).slice(-100);
      updatePredictor(); drawChart();
    }
    if (d.msg_type === "tick" && d.tick) {
      const q = Number(d.tick.quote);
      state.previous = state.prices.at(-1) ?? q;
      state.prices.push(q); state.prices = state.prices.slice(-100);
      $("price").textContent = q;
      $("lastTick").textContent = new Date(Number(d.tick.epoch) * 1000).toLocaleTimeString();
      const diff = q - state.previous;
      const change = $("priceChange");
      change.className = `change ${diff > 0 ? "up" : diff < 0 ? "down" : "neutral"}`;
      change.textContent = diff > 0 ? "UP" : diff < 0 ? "DOWN" : "FLAT";
      updatePredictor(); drawChart();
    }
  };
  ws.onerror = () => setStatus(false, "Market connection error");
  ws.onclose = () => { setStatus(false, "Market disconnected"); setTimeout(connectPublicMarket, 3000); };
}

async function getAuthStatus() {
  const r = await fetch("/api/auth/status");
  if (!r.ok) throw new Error("Could not check login status.");
  return r.json();
}

async function loadAccounts() {
  const r = await fetch("/api/accounts");
  const d = await r.json();
  if (!r.ok) throw new Error(d?.errors?.[0]?.message || d.error || "Could not load accounts.");
  state.accounts = Array.isArray(d.data) ? d.data : [];
  const s = $("accountSelect"); s.innerHTML = "";
  if (!state.accounts.length) { s.innerHTML = "<option>No Options account found</option>"; enableTrading(false); return; }
  state.accounts.forEach(a => {
    const o = document.createElement("option");
    o.value = a.account_id;
    o.textContent = `${a.account_id} • ${a.account_type || "account"} • ${a.currency || "USD"}`;
    s.appendChild(o);
  });
  s.disabled = false;
  state.account = state.accounts[0];
  s.value = state.account.account_id;
  updateAccountUI();
  await connectAuthenticated();
}

function updateAccountUI() {
  if (!state.account) return;
  const demo = state.account.account_type === "demo";
  $("accountBadge").textContent = demo ? "DEMO" : "REAL";
  $("accountBadge").className = `badge ${demo ? "good" : ""}`;
  $("balance").textContent = money(state.account.balance, state.account.currency);
  $("currency").textContent = state.account.currency || "—";
}

function enableTrading(enabled) {
  $("quoteBtn").disabled = !enabled;
  $("refreshBtn").disabled = !enabled;
  if (!enabled) $("buyBtn").disabled = true;
}

function scheduleAuthReconnect() {
  if (!state.account || state.authReconnectTimer) return;
  const delay = Math.min(30000, 2000 * Math.pow(2, state.reconnectAttempt));
  state.reconnectAttempt++;
  log(`Trading reconnect scheduled in ${Math.round(delay / 1000)}s.`);
  state.authReconnectTimer = setTimeout(async () => {
    state.authReconnectTimer = null;
    try { await connectAuthenticated(); }
    catch (err) { log(`Trading reconnect failed: ${err.message}`); scheduleAuthReconnect(); }
  }, delay);
}

async function connectAuthenticated() {
  if (!state.account || state.authConnecting) return;
  state.authConnecting = true;
  enableTrading(false);
  if (state.authWs) { try { state.authWs.onclose = null; state.authWs.close(); } catch {} state.authWs = null; }
  log("Connecting trading WebSocket…");

  try {
    const r = await fetch("/api/ws-url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: state.account.account_id })
    });
    const d = await r.json();
    if (!r.ok || !d.url) throw new Error(d?.errors?.[0]?.message || d.error || "Could not authenticate trading WebSocket.");

    const ws = new WebSocket(d.url);
    state.authWs = ws;
    ws.onopen = () => {
      state.authConnecting = false; state.reconnectAttempt = 0;
      log(`Authenticated ${state.account.account_type} WebSocket connected.`);
      enableTrading(true);
      ws.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: 100 }));
      ws.send(JSON.stringify({ portfolio: 1, req_id: 101 }));
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.error) { log("Trading API error", m.error); return; }
      if (m.msg_type === "balance" && m.balance) {
        $("balance").textContent = money(m.balance.balance, m.balance.currency);
        state.account.balance = m.balance.balance; state.account.currency = m.balance.currency;
      }
      if (m.msg_type === "proposal" && m.proposal) {
        state.proposal = m.proposal;
        $("proposalId").textContent = m.proposal.id || "—";
        $("askPrice").textContent = money(m.proposal.ask_price, state.account?.currency);
        $("payout").textContent = money(m.proposal.payout, state.account?.currency);
        $("buyBtn").disabled = !m.proposal.id;
        log("Live proposal received.", m.proposal);
      }
      if (m.msg_type === "buy" && m.buy) {
        state.contractId = m.buy.contract_id;
        $("contractId").textContent = state.contractId || "—";
        $("contractBuyPrice").textContent = money(m.buy.buy_price, state.account?.currency);
        $("positionEmpty").classList.add("hidden"); $("position").classList.remove("hidden"); $("sellBtn").disabled = false;
        log("Contract purchased.", m.buy);
        ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: state.contractId, subscribe: 1, req_id: 300 }));
      }
      if (m.msg_type === "proposal_open_contract" && m.proposal_open_contract) {
        const c = m.proposal_open_contract;
        $("contractStatus").textContent = c.status || (c.is_sold ? "sold" : "open");
        $("contractProfit").textContent = money(c.profit, state.account?.currency);
        if (c.is_sold) $("sellBtn").disabled = true;
      }
      if (m.msg_type === "sell" && m.sell) { $("sellBtn").disabled = true; log("Contract sold.", m.sell); }
    };
    ws.onerror = () => log("Authenticated WebSocket error.");
    ws.onclose = () => {
      state.authConnecting = false; if (state.authWs === ws) state.authWs = null;
      enableTrading(false); log("Authenticated WebSocket closed."); scheduleAuthReconnect();
    };
  } catch (err) {
    state.authConnecting = false; enableTrading(false); throw err;
  }
}

function updateBarrierUI() {
  const type = $("contractType").value;
  const digit = ["DIGITMATCH", "DIGITOVER", "DIGITUNDER"].includes(type);
  $("barrierRow").classList.toggle("hidden", !digit);
  $("tradeBarrier").disabled = !digit;
  if (digit && state.prediction) {
    if (state.prediction.type === type) $("tradeBarrier").value = state.prediction.barrier;
    $("barrierPrediction").textContent = state.prediction.type === type ? `${state.prediction.label} ✓` : `Predictor: ${state.prediction.label}`;
  } else {
    $("barrierPrediction").textContent = state.prediction ? state.prediction.label : "WAITING";
  }
}

function requestProposal() {
  if (!state.authWs || state.authWs.readyState !== WebSocket.OPEN) return alert("Trading connection is not ready. Please wait for reconnection.");
  const amount = Number($("stake").value), duration = Number($("duration").value), unit = $("durationUnit").value, type = $("contractType").value;
  if (!amount || amount <= 0 || !duration || duration <= 0) return alert("Enter a valid stake and duration.");

  const digit = ["DIGITMATCH", "DIGITOVER", "DIGITUNDER"].includes(type);
  let barrier = null;
  if (digit) {
    if (!state.prediction) return alert("No validated prediction/barrier yet. Wait for more ticks and a passing historical filter.");
    if (state.prediction.type !== type) return alert(`The validated predictor currently recommends ${state.prediction.type}. Select that contract type first.`);
    barrier = Number($("tradeBarrier").value);
    if (!Number.isInteger(barrier) || barrier < 0 || barrier > 9) return alert("Barrier/digit must be 0–9.");
    if (barrier !== state.prediction.barrier) return alert("Barrier does not match the validated prediction.");
  }

  state.proposal = null; $("proposalId").textContent = "REQUESTING…"; $("askPrice").textContent = "—"; $("payout").textContent = "—"; $("buyBtn").disabled = true;
  const req = { proposal: 1, amount, basis: "stake", contract_type: type, currency: state.account.currency, duration_unit: unit, duration, underlying_symbol: state.symbol, subscribe: 0, req_id: 200 };
  if (digit) req.barrier = String(barrier);
  log("Requesting live proposal.", req);
  state.authWs.send(JSON.stringify(req));
}

function buyProposal() {
  if (!state.proposal?.id || !state.authWs || state.authWs.readyState !== WebSocket.OPEN) return alert("No valid live proposal is available.");
  const price = Number(state.proposal.ask_price);
  if (!price) return alert("Proposal price is not valid.");
  if (state.account?.account_type !== "demo" && !confirm("This is NOT a demo account. Continue?")) return;
  state.authWs.send(JSON.stringify({ buy: String(state.proposal.id), price, req_id: 250 }));
  $("buyBtn").disabled = true;
}

function sellOpen() {
  if (!state.contractId || !state.authWs || state.authWs.readyState !== WebSocket.OPEN) return;
  if (!confirm("Sell the open contract at market price?")) return;
  state.authWs.send(JSON.stringify({ sell: Number(state.contractId), price: 0, req_id: 400 }));
}

async function initAuthUI() {
  try {
    const s = await getAuthStatus();
    if (s.authenticated) {
      $("loginBtn").classList.add("hidden"); $("logoutBtn").classList.remove("hidden");
      try { await loadAccounts(); log("Deriv login session is active."); }
      catch (e) { log("Could not load accounts: " + e.message); }
    } else enableTrading(false);
  } catch (e) { log("Authentication status check failed: " + e.message); enableTrading(false); }
}

$("loginBtn").onclick = () => location.href = "/auth/login";
$("logoutBtn").onclick = async () => { await fetch("/auth/logout", { method: "POST" }); location.reload(); };
$("accountSelect").onchange = async e => {
  state.account = state.accounts.find(a => a.account_id === e.target.value); state.contractId = null; state.proposal = null;
  $("position").classList.add("hidden"); $("positionEmpty").classList.remove("hidden"); $("sellBtn").disabled = true; updateAccountUI();
  try { state.reconnectAttempt = 0; await connectAuthenticated(); } catch (err) { log("Account connection failed: " + err.message); scheduleAuthReconnect(); }
};
$("symbolSelect").onchange = e => {
  state.symbol = e.target.value; $("symbolCode").textContent = state.symbol; $("symbolName").textContent = e.target.options[e.target.selectedIndex].textContent;
  state.prices = []; state.digits = []; state.previous = null; state.prediction = null; connectPublicMarket();
};
$("botThreshold").onchange = updatePredictor;
$("contractType").onchange = updateBarrierUI;
$("tradeBarrier").oninput = () => { if (state.prediction) $("barrierPrediction").textContent = `Validated: ${state.prediction.barrier}`; };
$("quoteBtn").onclick = requestProposal; $("buyBtn").onclick = buyProposal; $("sellBtn").onclick = sellOpen;
$("refreshBtn").onclick = async () => { if (!state.account) return; state.reconnectAttempt = 0; try { await connectAuthenticated(); } catch (err) { log("Refresh connection failed: " + err.message); scheduleAuthReconnect(); } };
document.querySelectorAll("[data-step]").forEach(b => b.onclick = () => { $("stake").value = Math.max(.35, Number($("stake").value) + Number(b.dataset.step) * .5).toFixed(2); });
$("clearLog").onclick = () => $("log").textContent = "";
addEventListener("resize", drawChart);
$("tradeBarrier").disabled = true;
connectPublicMarket();
initAuthUI();
