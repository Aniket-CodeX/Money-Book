const APPS = [
  "Google Pay","Amazon Pay","Paytm","BHIM",
  "SuperMoney","Navi","PhonePe","Cash","Other"
];

const CATEGORIES = [
  "Food","Shopping","Travel","Bills","Recharge",
  "Transfer","Entertainment","Income","Other"
];

const state = {
  db: null,
  direction: "sent",
  homeFilter: "all",
  transactionFilter: "all",
  search: "",
  category: "",
  app: "",
  minAmount: "",
  maxAmount: "",
  fromDate: "",
  toDate: "",
  sort: "newest"
};

const $ = id => document.getElementById(id);
const money = value => {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  return (n < 0 ? "−" : "") + "₹" + abs.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(Math.round(abs * 100) / 100) ? 0 : 2,
    maximumFractionDigits: 2
  });
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"
  }[char]));
}

function appEmoji(app) {
  return ({
    "Google Pay":"G","Amazon Pay":"A","Paytm":"P","BHIM":"B",
    "SuperMoney":"S","Navi":"N","PhonePe":"P","Cash":"₹","Other":"?"
  })[app] || "₹";
}

function localDateTimeValue(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,16);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("MyMoneyTracker", 2);

    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("transactions")) {
        db.createObjectStore("transactions", { keyPath:"id", autoIncrement:true });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath:"key" });
      }
    };

    request.onsuccess = () => {
      state.db = request.result;
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readonly")
      .objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function addRecord(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readwrite")
      .objectStore(storeName).add(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readwrite")
      .objectStore(storeName).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readwrite")
      .objectStore(storeName).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readwrite")
      .objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getOpeningBalance() {
  const rows = await getAll("settings");
  const setting = rows.find(x => x.key === "openingBalance");
  return Number(setting?.value || 0);
}

async function saveOpeningBalance() {
  const raw = $("openingBalance").value.trim();
  const value = Number(raw);
  if (raw === "" || !Number.isFinite(value) || value < 0) {
    alert("Please enter a valid opening balance of ₹0 or more.");
    return;
  }

  const transactions = await getAll("transactions");
  if (transactions.length && !confirm(
    "Changing the opening balance will recalculate the closing balance of all existing transactions. Continue?"
  )) return;

  try {
    await putRecord("settings", { key:"openingBalance", value:Math.round(value * 100) / 100 });
    await recalculateBalances();
    await renderAll();
  } catch (error) {
    console.error(error);
    alert("Could not save the opening balance. Your existing transactions have not been intentionally changed.");
  }
}

const allTx = () => getAll("transactions");

async function recalculateBalances() {
  const rows = (await getAll("transactions")).sort((a,b) => {
    return new Date(a.date) - new Date(b.date) || Number(a.id) - Number(b.id);
  });

  let balance = await getOpeningBalance();

  rows.forEach(tx => {
    balance += tx.direction === "sent"
      ? -Number(tx.amount || 0)
      : Number(tx.amount || 0);
    balance = Math.round(balance * 100) / 100;   // round every step so float error can't build up
    tx.closing = balance;
  });

  // Write everything in one transaction (faster and all-or-nothing)
  await new Promise((resolve, reject) => {
    const t = state.db.transaction("transactions", "readwrite");
    const store = t.objectStore("transactions");
    rows.forEach(tx => store.put(tx));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function addTransaction(tx) {
  await addRecord("transactions", tx);
  await recalculateBalances();
}

function formatDate(value, full = false) {
  const date = new Date(value);
  return date.toLocaleDateString("en-IN", full
    ? {day:"2-digit",month:"long",year:"numeric"}
    : {day:"2-digit",month:"short",year:"numeric"});
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour:"2-digit", minute:"2-digit"
  });
}

function transactionHtml(tx) {
  return `
    <article class="txn" data-txid="${tx.id}">
      <div class="app-icon">${escapeHtml(appEmoji(tx.upi))}</div>
      <div>
        <div class="txn-title">${escapeHtml(tx.details)}</div>
        <div class="txn-meta">
          ${formatDate(tx.date)} · ${formatTime(tx.date)} ·
          ${escapeHtml(tx.upi)} · ${escapeHtml(tx.category)}
        </div>
      </div>
      <div class="txn-amt ${tx.direction}">
        ${tx.direction === "sent" ? "−" : "+"}${money(Math.abs(tx.amount))}
      </div>
    </article>`;
}

async function renderBalanceBreakdown() {
  const rows = await getAll("transactions");
  const openingBalance = await getOpeningBalance();
  let bankBalance = openingBalance;
  let cashLeft = 0;

  rows.forEach(tx => {
    const amount = Number(tx.amount || 0);
    const delta = tx.direction === "sent" ? -amount : amount;
    if (String(tx.upi || "").trim().toLowerCase() === "cash") {
      cashLeft += delta;
    } else {
      bankBalance += delta;
    }
  });

  bankBalance = Math.round(bankBalance * 100) / 100;
  cashLeft = Math.round(cashLeft * 100) / 100;
  const closingBalance = Math.round((bankBalance + cashLeft) * 100) / 100;
  $("bankBalance").textContent = money(bankBalance);
  $("cashLeft").textContent = money(cashLeft);
  $("combinedBalance").textContent = money(closingBalance);
}

function openBalanceScreen() {
  [$("homeScreen"), $("balanceScreen"), $("transactionsScreen"), $("analysisScreen"), $("settingsScreen")]
    .forEach(screen => screen.classList.toggle("active", screen.id === "balanceScreen"));
  [$("navHome"), $("navTransactions"), $("navAnalysis"), $("navSettings")]
    .forEach((button, index) => button.classList.toggle("active", index === 0));
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderBalanceBreakdown();
}

async function renderHome() {
  const rows = (await getAll("transactions")).sort(
    (a,b) => new Date(b.date) - new Date(a.date) || Number(b.id) - Number(a.id)
  );

  let sent = 0, received = 0;
  rows.forEach(tx => {
    if (tx.direction === "sent") sent += Number(tx.amount || 0);
    else received += Number(tx.amount || 0);
  });

  $("sent").textContent = money(sent);
  $("received").textContent = money(received);
  $("balance").textContent = rows.length
    ? money(rows[0].closing)
    : money(await getOpeningBalance());

  $("monthLabel").textContent = "Last 7 days";

  renderChart(rows);

  const filtered = state.homeFilter === "all"
    ? rows
    : rows.filter(tx => tx.direction === state.homeFilter);

  $("recentTransactions").innerHTML = filtered.length
    ? filtered.slice(0,8).map(transactionHtml).join("")
    : `<div class="empty">No transactions yet.<br>Tap + to add your first one.</div>`;

  bindTransactionClicks($("recentTransactions"));
}

function renderChart(rows) {
  const values = [];
  const labels = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const start = new Date(now);
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - i);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const total = rows
      .filter(tx => tx.direction === "sent" &&
        new Date(tx.date) >= start && new Date(tx.date) < end)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

    values.push(total);
    labels.push(start.toLocaleDateString("en-IN", {weekday:"short"}));
  }

  const max = Math.max(...values, 1);
  $("chart").innerHTML = values.map(value => {
    const height = value > 0 ? Math.max(8, value / max * 100) : 0;
    return `<div class="bar" style="--h:${height}%"></div>`;
  }).join("");

  $("chartLabels").innerHTML = labels.map(label => `<span>${label}</span>`).join("");
}

function bindTransactionClicks(container) {
  container.querySelectorAll("[data-txid]").forEach(element => {
    element.onclick = () => showTransactionDetail(Number(element.dataset.txid));
  });
}

function populateSelects() {
  $("upi").innerHTML = APPS.map(app =>
    `<option value="${escapeHtml(app)}">${escapeHtml(app)}</option>`
  ).join("");

  $("category").innerHTML = CATEGORIES.map(category =>
    `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
  ).join("");

  $("filterCategory").innerHTML =
    `<option value="">All categories</option>` +
    CATEGORIES.map(category =>
      `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
    ).join("");

  $("filterApp").innerHTML =
    `<option value="">All payment methods</option>` +
    APPS.map(app =>
      `<option value="${escapeHtml(app)}">${escapeHtml(app)}</option>`
    ).join("");
}

function getFilteredTransactions(rows) {
  const q = state.search.trim().toLowerCase();

  let result = rows.filter(tx => {
    const searchable = [
      tx.details, tx.upi, tx.category, tx.notes
    ].join(" ").toLowerCase();

    const amount = Number(tx.amount || 0);
    const min = state.minAmount === "" ? null : Number(state.minAmount);
    const max = state.maxAmount === "" ? null : Number(state.maxAmount);
    const when = new Date(tx.date);
    const from = state.fromDate ? new Date(state.fromDate + "T00:00:00") : null;
    const to = state.toDate ? new Date(state.toDate + "T23:59:59.999") : null;

    return (
      (state.transactionFilter === "all" || tx.direction === state.transactionFilter) &&
      (!q || searchable.includes(q)) &&
      (!state.category || tx.category === state.category) &&
      (!state.app || tx.upi === state.app) &&
      (min === null || amount >= min) &&
      (max === null || amount <= max) &&
      (!from || when >= from) &&
      (!to || when <= to)
    );
  });

  result.sort((a,b) => {
    const byId = Number(b.id) - Number(a.id);
    if (state.sort === "oldest") return new Date(a.date) - new Date(b.date) || -byId;
    if (state.sort === "high") return Number(b.amount) - Number(a.amount) || byId;
    if (state.sort === "low") return Number(a.amount) - Number(b.amount) || byId;
    return new Date(b.date) - new Date(a.date) || byId;
  });

  return result;
}

async function renderTransactions() {
  const rows = await getAll("transactions");
  const filtered = getFilteredTransactions(rows);

  $("allTransactions").innerHTML = filtered.length
    ? filtered.map(transactionHtml).join("")
    : `<div class="empty">No transactions match your filters.</div>`;

  $("filterSummary").textContent =
    `${filtered.length} transaction${filtered.length === 1 ? "" : "s"} shown`;

  $("transactionSearch").value = state.search;
  $("filterCategory").value = state.category;
  $("filterApp").value = state.app;
  $("minAmount").value = state.minAmount;
  $("maxAmount").value = state.maxAmount;
  $("fromDate").value = state.fromDate;
  $("toDate").value = state.toDate;
  $("sortTransactions").value = state.sort;
  document.querySelectorAll("[data-direction-filter]").forEach(item =>
    item.classList.toggle("active", item.dataset.directionFilter === state.transactionFilter)
  );
  bindTransactionClicks($("allTransactions"));
}


function resetFilters() {
  state.transactionFilter = "all";
  state.search = "";
  state.category = "";
  state.app = "";
  state.minAmount = "";
  state.maxAmount = "";
  state.fromDate = "";
  state.toDate = "";
}

async function renderAnalysis() {
  const rows = await getAll("transactions");
  let sent = 0, received = 0;
  const categoryTotals = {};
  const appTotals = {};
  const people = {};
  const monthly = {};
  const monthLabels = {};
  let largestSent = 0;
  let sentCount = 0;

  rows.forEach(tx => {
    const amount = Number(tx.amount || 0);

    if (tx.direction === "sent") {
      sent += amount;
      sentCount++;
      largestSent = Math.max(largestSent, amount);

      categoryTotals[tx.category] =
        (categoryTotals[tx.category] || 0) + amount;

      appTotals[tx.upi] =
        (appTotals[tx.upi] || 0) + amount;

      const person = String(tx.details || "").trim();
      if (person) {
        if (!people[person]) people[person] = {count:0,total:0};
        people[person].count++;
        people[person].total += amount;
      }

      const d = new Date(tx.date);
      const monthKey = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      monthLabels[monthKey] = d.toLocaleDateString("en-IN", {
        month:"short", year:"numeric"
      });
      monthly[monthKey] = (monthly[monthKey] || 0) + amount;
    } else {
      received += amount;
    }
  });

  $("analysisSent").textContent = money(sent);
  $("analysisReceived").textContent = money(received);
  $("analysisNet").textContent = money(received - sent);
  $("analysisCount").textContent = rows.length;
  $("analysisAverage").textContent = money(sentCount ? sent / sentCount : 0);
  $("analysisLargest").textContent = money(largestSent);

  const topCategory = Object.entries(categoryTotals)
    .sort((a,b) => b[1] - a[1])[0];

  const topPerson = Object.entries(people)
    .sort((a,b) => b[1].total - a[1].total)[0];

  const topApp = Object.entries(appTotals)
    .sort((a,b) => b[1] - a[1])[0];

  $("moneyInsights").innerHTML = `
    <div class="setting-row">
      <strong>Where was most money spent?</strong>
      <span>${topCategory
        ? `${escapeHtml(topCategory[0])} · ${money(topCategory[1])}`
        : "No spending data yet"}</span>
    </div>
    <div class="setting-row">
      <strong>To whom / what did I send the most?</strong>
      <span>${topPerson
        ? `${escapeHtml(topPerson[0])} · ${topPerson[1].count} transactions · ${money(topPerson[1].total)}`
        : "No sent transactions yet"}</span>
    </div>
    <div class="setting-row">
      <strong>Which payment method did I spend the most through?</strong>
      <span>${topApp
        ? `${escapeHtml(topApp[0])} · ${money(topApp[1])}`
        : "No spending data yet"}</span>
    </div>`;

  const categoryEntries = Object.entries(categoryTotals)
    .sort((a,b) => b[1] - a[1]);

  $("categoryAnalysis").innerHTML = categoryEntries.length
    ? categoryEntries.map(([category,total]) => `
      <button class="setting-row category-button" data-category="${escapeHtml(category)}">
        <strong>${escapeHtml(category)}</strong>
        <span>${money(total)} · Tap to view transactions</span>
      </button>`).join("")
    : `<div class="empty">Add sent transactions to see category spending.</div>`;

  $("categoryAnalysis").querySelectorAll("[data-category]").forEach(button => {
    button.onclick = () => {
      resetFilters();
      state.category = button.dataset.category;
      $("advancedFilters").classList.remove("hidden");
      navigate(1);
    };
  });

  const appEntries = Object.entries(appTotals).sort((a,b) => b[1] - a[1]);
  $("appAnalysis").innerHTML = appEntries.length
    ? appEntries.map(([app,total]) => `
      <button class="setting-row category-button" data-app="${escapeHtml(app)}">
        <strong>${escapeHtml(app)}</strong>
        <span>${money(total)} · Tap to filter transactions</span>
      </button>`).join("")
    : `<div class="empty">Add sent transactions to see payment method spending.</div>`;

  $("appAnalysis").querySelectorAll("[data-app]").forEach(button => {
    button.onclick = () => {
      resetFilters();
      state.app = button.dataset.app;
      $("advancedFilters").classList.remove("hidden");
      navigate(1);
    };
  });

  const monthEntries = Object.entries(monthly)
    .sort((a,b) => b[0].localeCompare(a[0]))
    .map(([key,total]) => [monthLabels[key], total]);

  $("monthlyAnalysis").innerHTML = monthEntries.length
    ? monthEntries.map(([month,total]) => `
      <div class="setting-row">
        <strong>${escapeHtml(month)}</strong>
        <span>${money(total)} sent</span>
      </div>`).join("")
    : `<div class="empty">Add sent transactions to see monthly trends.</div>`;
}

async function showTransactionDetail(id) {
  const rows = await getAll("transactions");
  const tx = rows.find(item => Number(item.id) === Number(id));
  if (!tx) return;

  $("detailContent").innerHTML = `
    <div class="detail-list">
      <div class="detail-item">
        <span>Amount</span>
        <strong class="detail-amount ${tx.direction}">
          ${tx.direction === "sent" ? "−" : "+"}${money(Math.abs(tx.amount))}
        </strong>
      </div>
      <div class="detail-item">
        <span>Date & time</span>
        <strong>${formatDate(tx.date,true)} · ${formatTime(tx.date)}</strong>
      </div>
      <div class="detail-item">
        <span>Transaction details</span>
        <strong>${escapeHtml(tx.details)}</strong>
      </div>
      <div class="detail-item">
        <span>Payment method</span>
        <strong>${escapeHtml(tx.upi)}</strong>
      </div>
      <div class="detail-item">
        <span>Category</span>
        <strong>${escapeHtml(tx.category)}</strong>
      </div>
      <div class="detail-item">
        <span>Payment</span>
        <strong>${tx.direction === "sent" ? "Payment sent" : "Payment received"}</strong>
      </div>
      <div class="detail-item">
        <span>Closing balance</span>
        <strong>${money(tx.closing)}</strong>
      </div>
      <div class="detail-item">
        <span>Notes</span>
        <strong>${tx.notes ? escapeHtml(tx.notes) : "No notes"}</strong>
      </div>
    </div>
    <div class="detail-actions">
      <button type="button" class="save" id="editTransactionButton">Edit transaction</button>
    </div>`;
  $("editTransactionButton").onclick = () => showEditTransactionForm(tx);
  $("detailModal").classList.add("open");
}

function showEditTransactionForm(tx) {
  const appOptions = APPS.map(app =>
    `<option value="${escapeHtml(app)}" ${tx.upi === app ? "selected" : ""}>${escapeHtml(app)}</option>`
  ).join("");
  const categoryOptions = CATEGORIES.map(category =>
    `<option value="${escapeHtml(category)}" ${tx.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`
  ).join("");

  $("detailContent").innerHTML = `
    <form class="form" id="editTransactionForm">
      <div class="field"><label for="editDate">Date & time</label><input id="editDate" type="datetime-local" value="${escapeHtml(localDateTimeValue(tx.date))}" required></div>
      <div class="field"><label for="editDetails">Transaction details</label><input id="editDetails" value="${escapeHtml(tx.details)}" required></div>
      <div class="field"><label for="editPaymentMethod">Payment Method</label><select id="editPaymentMethod">${appOptions}</select></div>
      <div class="field"><label for="editCategory">Category</label><select id="editCategory">${categoryOptions}</select></div>
      <div class="field"><label for="editDirection">Payment direction</label><select id="editDirection"><option value="sent" ${tx.direction === "sent" ? "selected" : ""}>Payment sent</option><option value="received" ${tx.direction === "received" ? "selected" : ""}>Payment received</option></select></div>
      <div class="field"><label for="editAmount">Amount (₹)</label><input id="editAmount" type="number" min="0.01" step="0.01" value="${Number(tx.amount)}" required></div>
      <div class="field"><label for="editNotes">Notes (optional)</label><textarea id="editNotes">${escapeHtml(tx.notes || "")}</textarea></div>
      <div class="edit-actions"><button class="save" type="submit">Save changes</button><button class="small-button edit-cancel" type="button" id="cancelEditTransaction">Cancel</button><button class="small-button delete-transaction" type="button" id="deleteEditTransaction">Delete transaction</button></div>
    </form>`;

  $("cancelEditTransaction").onclick = () => showTransactionDetail(tx.id);
  $("deleteEditTransaction").onclick = async () => {
    const confirmed = confirm(`Delete this transaction?\n\n${tx.details} — ${money(tx.amount)}\n\nThis action cannot be undone.`);
    if (!confirmed) return;
    try {
      await deleteRecord("transactions", tx.id);
      await recalculateBalances();
      $("detailModal").classList.remove("open");
      await renderAll();
    } catch (error) {
      console.error(error);
      alert("Could not delete the transaction. Please try again.");
    }
  };
  $("editTransactionForm").onsubmit = async event => {
    event.preventDefault();
    const details = $("editDetails").value.trim();
    const amount = Number($("editAmount").value);
    if (!details) return alert("Please enter transaction details.");
    if (!(amount > 0) || !Number.isFinite(amount)) return alert("Please enter a valid amount.");

    const updated = {
      ...tx,
      date: $("editDate").value,
      details,
      upi: $("editPaymentMethod").value,
      category: $("editCategory").value,
      direction: $("editDirection").value,
      amount,
      notes: $("editNotes").value.trim(),
      updatedAt: Date.now()
    };
    if (!updated.date || Number.isNaN(new Date(updated.date).getTime())) {
      return alert("Please enter a valid date and time.");
    }

    try {
      await putRecord("transactions", updated);
      await recalculateBalances();
      await renderAll();
      await showTransactionDetail(updated.id);
    } catch (error) {
      console.error(error);
      alert("Could not save the transaction changes. Please try again.");
    }
  };
}

function navigate(index) {
  // Main-tab navigation always closes the balance breakdown and activates
  // exactly one main screen, preventing the breakdown from leaking into tabs.
  const screens = [
    $("homeScreen"), $("transactionsScreen"),
    $("analysisScreen"), $("settingsScreen"), $("balanceScreen")
  ];

  const buttons = [
    $("navHome"), $("navTransactions"),
    $("navAnalysis"), $("navSettings")
  ];

  buttons.forEach((button,i) => button.classList.toggle("active", i === index));
  screens.forEach((screen,i) => screen.classList.toggle("active", i === index));

  window.scrollTo({top:0, behavior:"smooth"});

  if (index === 0) renderHome();
  if (index === 1) renderTransactions();
  if (index === 2) renderAnalysis();
  if (index === 3) loadSettings();
}

function openTransactionModal() {
  $("date").value = localDateTimeValue();
  $("details").value = "";
  $("amount").value = "";
  $("notes").value = "";
  $("closing").value = "Auto-calculated";
  state.direction = "sent";
  $("category").value = "Food";

  document.querySelectorAll("[data-direction]").forEach((button,i) => {
    button.classList.toggle("active", i === 0);
  });

  $("transactionModal").classList.add("open");
}

function closeTransactionModal() {
  $("transactionModal").classList.remove("open");
}

function loadSettings() {
  getOpeningBalance().then(value => {
    $("openingBalance").value = value;
  });
}

async function renderAll() {
  await renderHome();
  if ($("balanceScreen").classList.contains("active")) await renderBalanceBreakdown();
  await renderTransactions();
  await renderAnalysis();
  await loadSettings();
}

function wireEvents() {
  $("addButton").onclick = openTransactionModal;
  $("closeTransaction").onclick = closeTransactionModal;

  $("transactionModal").onclick = event => {
    if (event.target === $("transactionModal")) closeTransactionModal();
  };

  $("detailClose").onclick = () => $("detailModal").classList.remove("open");
  $("detailModal").onclick = event => {
    if (event.target === $("detailModal")) {
      $("detailModal").classList.remove("open");
    }
  };

  $("viewAll").onclick = () => navigate(1);
  $("balanceCard").onclick = openBalanceScreen;
  $("balanceCard").onkeydown = event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openBalanceScreen();
    }
  };
  $("backToHome").onclick = () => navigate(0);

  $("navHome").onclick = () => navigate(0);
  $("navTransactions").onclick = () => navigate(1);
  $("navAnalysis").onclick = () => navigate(2);
  $("navSettings").onclick = () => navigate(3);

  document.querySelectorAll("[data-home-filter]").forEach(button => {
    button.onclick = () => {
      state.homeFilter = button.dataset.homeFilter;
      document.querySelectorAll("[data-home-filter]").forEach(item =>
        item.classList.toggle("active", item === button)
      );
      renderHome();
    };
  });

  document.querySelectorAll("[data-direction-filter]").forEach(button => {
    button.onclick = () => {
      state.transactionFilter = button.dataset.directionFilter;
      document.querySelectorAll("[data-direction-filter]").forEach(item =>
        item.classList.toggle("active", item === button)
      );
      renderTransactions();
    };
  });

  document.querySelectorAll("[data-direction]").forEach(button => {
    button.onclick = () => {
      state.direction = button.dataset.direction;
      $("category").value = state.direction === "received" ? "Income" : "Food";
      document.querySelectorAll("[data-direction]").forEach(item =>
        item.classList.toggle("active", item === button)
      );
    };
  });

  $("toggleAdvanced").onclick = () => {
    $("advancedFilters").classList.toggle("hidden");
  };

  $("transactionSearch").oninput = event => {
    state.search = event.target.value;
    renderTransactions();
  };

  $("filterCategory").onchange = event => {
    state.category = event.target.value;
    renderTransactions();
  };

  $("filterApp").onchange = event => {
    state.app = event.target.value;
    renderTransactions();
  };

  $("minAmount").oninput = event => {
    state.minAmount = event.target.value;
    renderTransactions();
  };

  $("maxAmount").oninput = event => {
    state.maxAmount = event.target.value;
    renderTransactions();
  };

  $("fromDate").onchange = event => {
    state.fromDate = event.target.value;
    renderTransactions();
  };

  $("toDate").onchange = event => {
    state.toDate = event.target.value;
    renderTransactions();
  };

  $("sortTransactions").onchange = event => {
    state.sort = event.target.value;
    renderTransactions();
  };

  $("saveOpeningBalance").onclick = saveOpeningBalance;
  $("restorePdfFile").onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const choice = prompt(
        "How should this PDF be restored?\n\n1 = Replace all current data with the PDF data\n2 = Combine PDF transactions with current data\n\nEnter 1 or 2. Cancel to do nothing.",
        "2"
      );
      if (choice === null) return;
      if (!["1", "2"].includes(choice.trim())) {
        alert("Please enter 1 to replace or 2 to combine.");
        return;
      }
      if (choice.trim() === "1" && !confirm("This will remove all current transactions and replace them with transactions read from this PDF. Continue?")) return;
      await restorePdf(file, choice.trim() === "1" ? "replace" : "combine");
    } catch (error) {
      alert("Could not restore the PDF: " + error.message);
    } finally {
      event.target.value = "";
    }
  };

  $("transactionForm").onsubmit = async event => {
    event.preventDefault();

    const details = $("details").value.trim();
    const amount = Number($("amount").value);

    if (!details) {
      alert("Please enter transaction details.");
      return;
    }

    if (!(amount > 0)) {
      alert("Please enter a valid amount.");
      return;
    }

    if (!$("date").value || Number.isNaN(new Date($("date").value).getTime())) {
      alert("Please enter a valid date and time.");
      return;
    }

    try {
      await addTransaction({
        date: $("date").value,
        details,
        upi: $("upi").value,
        category: $("category").value,
        direction: state.direction,
        amount,
        closing: 0,
        notes: $("notes").value.trim(),
        createdAt: Date.now()
      });
    } catch (error) {
      console.error(error);
      alert("Could not save the transaction. Please try again.");
      return;
    }

    closeTransactionModal();
    await renderAll();
    navigate(0);
  };
}

async function migrateLegacyPaymentMethods() {
  // Keep older local records usable without retaining a discontinued method in the UI.
  const rows = await getAll("transactions");
  const legacyRows = rows.filter(tx => String(tx.upi || "").trim().toLowerCase() === "fampay");
  if (!legacyRows.length) return;
  await new Promise((resolve, reject) => {
    const transaction = state.db.transaction("transactions", "readwrite");
    const store = transaction.objectStore("transactions");
    legacyRows.forEach(tx => store.put({ ...tx, upi: "Other" }));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function init() {
  try {
    populateSelects();
    wireEvents();
    setupExports();
    await openDB();
    await migrateLegacyPaymentMethods();
    await renderAll();
  } catch (error) {
    console.error(error);
    alert("My Money Tracker could not open its local database.");
  }
}

document.addEventListener("DOMContentLoaded", init);


/* PDF statement export and restore */
/* Embedded subsets (only the rupee glyph U+20B9, from DejaVu Sans / Sans Bold) so the PDF shows a real ₹ */
const RUPEE_FONT_HEX = {
  regular: "00010000000f00800003007047444546000f0002000002c80000001447504f5344764c75000002dc000000204753554227a43fc3000002fc000000964d415448093f338400000394000000f64f532f328a938fc40000017800000056636d6170000c210c000001d8000000346761737000070007000002bc0000000c676c7966a5ae1e65000002140000007e686561642c50802e000000fc00000036686865610c88039f0000013400000024686d747809e400d0000001d0000000086c6f6361003f00000000020c000000066d6178700004002800000158000000206e616d65000600000000029400000006706f7374ffdb005a0000029c000000200001000000025eb849ccaeac5f0f3cf5001f080000000000e0fad13900000000e709056b006a000004af05d500000008000200000000000000010000076dfe1d00000517006a006804af00010000000000000000000000000000000200010000000200270001000000000001000000000000000000000000000000000001040e019000050000053305990000011e05330599000003d7006602120000020b06030308040202040000000000000002000000000000000050664564004020b920b90614fe14019a076d01e30000000100000000000004cd00660517006a0000000200000003000000140003000100000014000400200000000400040001000020b9ffff000020b9ffffdf4800010000000000000000003f00000001006a000004af05d5002600001337210721161721072306070607161716171323032627262323353332373637213721262726236a37040e37fe9e4f15013537f6053d417d413d3b41cdd9bf4b444678dcfe924a4406fdbe370200122d4a92055a7b7b4e817b7e555d2416484482fe68017f973031a6433e727b433458000000000000000600000003000000000000ffd8005a00000000000000000000000000000000000000000000000200080002ffff000300010000000c000000000000000100010001000100010000000a001c001e000144464c540008000400000000ffff00000000000000010000000a00920094001444464c54007a61726162008461726d6e008462726169008463616e7300846368657200846379726c008467656f7200846772656b008468616e6900846865627200846b616e6100846c616f2000846c61746e00846d61746800846e6b6f2000846f67616d008472756e72008474666e670084746861690084000400000000ffff00000000000000000000000000010000000a00e000e80050003c0c0007dd00000000028200000460000005d50000000000000460000000000000000000000000000004600000000000000168000004600000005500000000000000000000000000000000000000000000000000000000000000000000010e0000027600000000000000000000000000000000000000000000000000000000000000000000005a0000010e0000005a0000005a0000010e00000000000000000000010e0000005a0000005a0000010e0000005a0000005a0000005a000001720000005a0000005a000002380000fb8f0000003c00000000000000000028000a000a00000000000100000000",
  bold: "00010000000e00800003006047444546000f0002000002b80000001447504f5344764c75000002cc000000204753554227a43fc3000002ec000000964f532f328bbd922b0000016800000056636d6170000c210c000001c8000000346761737000070007000002ac0000000c676c7966452f3718000002040000007e686561642ccc802e000000ec00000036686865610d0304150000012400000024686d74780a5e00cd000001c0000000086c6f6361003f0000000001fc000000066d6178700004002700000148000000206e616d65000600000000028400000006706f7374ffdb005a0000028c000000200001000000025eb86555385e5f0f3cf5001f080000000000e0fad13900000000e709056b00670000052d05d500010008000200000000000000010000076dfe1d0000059100670064052d00010000000000000000000000000000000200010000000200260001000000000001000000000000000000000000000000000001049502bc00050000053305990000011e05330599000003d7006602120000020b08030306040202040000000000000002000000000000000050664564002020b920b90614fe14019a076d01e30000000100000000000004cd0066059100670000000200000003000000140003000100000014000400200000000400040001000020b9ffff000020b9ffffdf4800010000000000000000003f0000000100670000052d05d50025000013372107211617210721060706071617161713210326262323113332373637213721262726236758046e56fec4200c016656feeb112b48904f3f3f3fd1fe66b637715e96cb79351a0dfe2858017d0d1735790512c3c3384ac34d3a5f2d12404080fe5801737052010a43212ac3251d40000000000000000600000003000000000000ffd8005a00000000000000000000000000000000000000000000000200080002ffff000300010000000c000000000000000100010001000100010000000a001c001e000144464c540008000400000000ffff00000000000000010000000a00920094001444464c54007a61726162008461726d6e008462726169008463616e7300846368657200846379726c008467656f7200846772656b008468616e6900846865627200846b616e6100846c616f2000846c61746e00846d61746800846e6b6f2000846f67616d008472756e72008474666e670084746861690084000400000000ffff000000000000000000000000"
};
const RUPEE_ADVANCE_EM = { regular: 1303 / 2048, bold: 1425 / 2048 };

function pdfSafe(value) {
  // Output is pure ASCII: printable chars as-is (with PDF escaping), Latin-1 as octal escapes
  const clean = String(value ?? "")
    .replace(/[\u202F\u2009\u200A\u2007\u00A0]/g, " ")   // narrow/no-break spaces from toLocale*String
    .replace(/\u20B9/g, "Rs ")                               // rupee sign is not in the PDF font
    .replace(/[\u2012-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\r\n\t]+/g, " ");
  return Array.from(clean).map(ch => {
    const code = ch.charCodeAt(0);
    if (ch === "\\" || ch === "(" || ch === ")") return "\\" + ch;
    if (code >= 0x20 && code <= 0x7E) return ch;
    if (code >= 0xA0 && code <= 0xFF) return "\\" + code.toString(8).padStart(3, "0");
    return "?";
  }).join("");
}

function pdfText(value, max = 42) {
  // Truncate first so an escape sequence is never cut in half
  const text = String(value ?? "");
  const cut = text.length > max ? text.slice(0, Math.max(0, max - 3)) + "..." : text;
  return pdfSafe(cut);
}

function pdfDate(value) {
  const d = new Date(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function pdfMoney(value) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/* UPI app icons: trimmed to squares, 192px JPEG (base64). Rounded corners are applied in the PDF with a clipping path. */
const PDF_APP_ICONS = {
  "SuperMoney": "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",
  "Navi": "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",
  "Amazon Pay": "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",
  "Paytm": "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0L+WUZbHYq4Qzxzt5mFd9ERR62EREREREREREREXHZdG+X626ZtFXdLvX01sttIwy1FXVytiiiaO5c5xAA+KrW4tPaazX+Kr0ps7PNR0Lsx1OrXNLJZW4wW0jHDLB/OuAd9Fo6OUhR0M9c/liGW52C15p44G8zytpcePHjFtbT123u3tcyfWsrTFcbrC4OZZ2kdWtPY1BB6D+T7nrgKqN73Svc97nPe9xc573FznEnJJJ6kkkkk98o97pHue9znve4uc97i5znE5JJPUknqSe64XUaGhioIuzj13PX/uip9VVPqXXOQ2CIiKSWkiIiIiIiIiIiIiIiInYrZmynEduFw/XI1GjNQTUVI+T3lRaake+oKg/nwk4BP0mcrvVazRY5I2StLJBcHYrIyR8TuZhsVapsx7V3RWpIKei3Gs9To65fNa+40TXVdvefF3Qe9iHoWux9IqYeg92NGboUIq9J6otOoYcBzvwdWMlczPYPaDzNPo4Ar56AcFedLNJQ1kVXTSPpquJ3PHUQPMcjHebXtwQfUFVeo4dp5TeFxZ4j18VMxYs9uUjbr6P+YDucfFMhUKaX4sN5NGxRQ2rczUkdPEctgqa35Uz4ETB5I9MrYFN7R3iBpmBp1rSTgeM1kpXH7+UKFfw3Ug+69p+o+xUg3FIDrcK6vITmB7HPwVKlV7R3iBqWFo1rSQDzhslK0/fyla/wBUcWG8msopobruZqSSnlOXQU1b8lZ8AIQwgemUZw3Uk+89o+p+wR2KQDS5V4GvN2NGbX0Jq9WaotOnocFzfwjWMic/HcMaTzOPo0EqHu83tXdFabhqKLbmz1Osrj85rLjWtdR0DD4O6j3sg9A1oP0gqramaStrJaupkfU1crueSoneZJHu83Pdkk+pK8CclTVPw7Txm8zi/wAB6+Kj5cVe7KNtlsveriO3C4gbkKjWeoJq6kjk95T2mnHuaGnP5kIOCR9J/M717rWncoitEcbImhkYsBsFDPkfK7meblERFkWNERERERERERERERERERERERERERERERERERERERERERERERERERERERERf//Z",
  "PhonePe": "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",
  "BHIM": "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",
  "Google Pay": "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",
  "Cash": "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"
};

// Helvetica's widths (1/1000 em) for the few characters that can precede a rupee sign.
function pdfSignWidth(sign, bold, size) {
  return (sign === "+" ? 584 : sign === "-" ? 333 : 0) * size / 1000;
}

function makePdf(rows, openingBalance = 0) {
  const W = 842, H = 595, margin = 24, rowH = 22, headerH = 25;
  const cols = [
    { n: "Date / Time", w: 82 }, { n: "Details", w: 125 },
    { n: "Method", w: 48 }, { n: "Category", w: 72 },
    { n: "Amount", w: 76 }, { n: "Bank Balance", w: 91 },
    { n: "Cash Left", w: 76 }, { n: "Total Balance", w: 92 },
    { n: "Notes", w: 125 }
  ];
  const totalWidth = cols.reduce((sum, col) => sum + col.w, 0);
  const chronological = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date) || Number(a.id) - Number(b.id));
  let bankBalance = Number(openingBalance) || 0;
  let cashLeft = 0;
  const balances = new Map();
  chronological.forEach(row => {
    const amount = Number(row.amount) || 0;
    const delta = row.direction === "sent" ? -amount : amount;
    if (String(row.upi || "").trim().toLowerCase() === "cash") cashLeft += delta;
    else bankBalance += delta;
    bankBalance = Math.round(bankBalance * 100) / 100;
    cashLeft = Math.round(cashLeft * 100) / 100;
    balances.set(row, { total: Math.round((bankBalance + cashLeft) * 100) / 100, bank: bankBalance, cash: cashLeft });
  });

  const monthName = value => new Date(value).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const appStyle = app => ({
    "Google Pay": { letter: "G", color: "0.13 0.40 0.82" },
    "Amazon Pay": { letter: "a", color: "0.93 0.48 0.10" },
    "Paytm": { letter: "P", color: "0.00 0.43 0.78" },
    "BHIM": { letter: "B", color: "0.10 0.48 0.30" },
    "SuperMoney": { letter: "S", color: "0.28 0.35 0.80" },
    "Navi": { letter: "N", color: "0.12 0.48 0.42" },
    "PhonePe": { letter: "P", color: "0.40 0.20 0.65" },
    "Cash": { letter: "C", color: "0.08 0.52 0.31" },
    "Other": { letter: "?", color: "0.35 0.39 0.45" }
  })[app] || { letter: "•", color: "0.35 0.39 0.45" };

  // Every month starts on a fresh page; long months continue on further pages.
  const grouped = new Map();
  [...chronological].reverse().forEach(row => {
    const d = new Date(row.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!grouped.has(key)) grouped.set(key, { label: monthName(row.date), rows: [] });
    grouped.get(key).rows.push(row);
  });
  const pages = [];
  const rowsPerPage = Math.floor((H - 188) / rowH);
  for (const month of grouped.values()) {
    const monthRows = month.rows;
    for (let i = 0; i < monthRows.length; i += rowsPerPage) {
      pages.push({ month: month.label, continued: i > 0, rows: monthRows.slice(i, i + rowsPerPage) });
    }
  }
  if (!pages.length) pages.push({ month: "No transactions", continued: false, rows: [] });

  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const boldFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  // Embedded rupee fonts (Type0 / Identity-H; the subset has .notdef = gid 0 and the rupee sign = gid 1).
  const addRupeeFont = (hex, advanceEm, baseName) => {
    const fileId = add(`<< /Length ${hex.length + 1} /Length1 ${hex.length / 2} /Filter /ASCIIHexDecode >>\nstream\n${hex}>\nendstream`);
    const descId = add(`<< /Type /FontDescriptor /FontName /${baseName} /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 930 /Descent -236 /CapHeight 729 /StemV 80 /FontFile2 ${fileId} 0 R >>`);
    const cidId = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /CIDToGIDMap /Identity /DW 600 /W [1 [${Math.round(advanceEm * 1000)}]] >>`);
    return add(`<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] >>`);
  };
  const rupeeFontId = addRupeeFont(RUPEE_FONT_HEX.regular, RUPEE_ADVANCE_EM.regular, "MMTRupee");
  const rupeeBoldFontId = addRupeeFont(RUPEE_FONT_HEX.bold, RUPEE_ADVANCE_EM.bold, "MMTRupeeBold");
  // One image object per app icon (JPEG, hex-encoded so the PDF text stays plain ASCII).
  const iconRefs = {};
  Object.entries(PDF_APP_ICONS).forEach(([app, b64], n) => {
    const bin = atob(b64);
    let hex = "";
    for (let k = 0; k < bin.length; k++) hex += bin.charCodeAt(k).toString(16).padStart(2, "0");
    const id = add(`<< /Type /XObject /Subtype /Image /Width 192 /Height 192 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${hex.length + 1} >>\nstream\n${hex}>\nendstream`);
    iconRefs[app] = { name: `Im${n + 1}`, id };
  });
  const pagesId = add(null);
  const pageIds = [], contentIds = [];

  const drawPage = (page, pageNo) => {
    let y = H - 28;
    // Clean dark title band with a subtle accent and a compact report subtitle.
    let content = `0.09 0.15 0.25 rg ${margin} ${H - 75} ${totalWidth} 50 re f\n`;
    content += `0.22 0.68 0.62 rg ${margin} ${H - 75} 5 50 re f\n`;
    content += `1 1 1 rg BT /F2 17 Tf ${margin + 16} ${H - 47} Td (My Money Tracker) Tj ET\n`;
    content += `0.86 0.90 0.95 rg BT /F1 8 Tf ${margin + 16} ${H - 63} Td (TRANSACTION STATEMENT  |  Generated ${pdfSafe(new Date().toLocaleDateString("en-IN"))}) Tj ET 0 g\n`;
    y = H - 99;

    // Month heading deliberately appears before the table's column headings.
    content += `0.91 0.95 0.97 rg ${margin} ${y - 25} ${totalWidth} 27 re f\n`;
    content += `0.08 0.22 0.34 rg BT /F2 12 Tf ${margin + 9} ${y - 17} Td (${pdfText(page.month + (page.continued ? " - continued" : ""), 45)}) Tj ET 0 g\n`;
    y -= 34;

    // Table header: softly tinted with a strong lower rule.
    content += `0.91 0.93 0.96 rg ${margin} ${y - headerH + 4} ${totalWidth} ${headerH} re f\n`;
    content += `0.25 0.32 0.42 RG 0.8 w ${margin} ${y - headerH + 4} m ${margin + totalWidth} ${y - headerH + 4} l S 0 G\n`;
    let x = margin;
    cols.forEach(col => {
      content += `0.20 0.27 0.36 rg BT /F2 7 Tf ${x + 3} ${y - 13} Td (${pdfText(col.n, 32)}) Tj ET\n`;
      x += col.w;
    });
    y -= headerH;

    page.rows.forEach((row, rowIndex) => {
      const rowTop = y;
      if (rowIndex % 2 === 0) content += `0.975 0.982 0.99 rg ${margin} ${y - rowH + 2} ${totalWidth} ${rowH} re f\n`;
      content += `0.86 0.89 0.92 RG 0.45 w ${margin} ${y - rowH + 2} m ${margin + totalWidth} ${y - rowH + 2} l S 0 G\n0.12 0.16 0.22 rg\n`;
      const rowBalances = balances.get(row) || { total: Number(row.closing) || 0, bank: 0, cash: 0 };
      const values = [
        pdfDate(row.date), row.details, "", row.category,
        pdfMoney(row.amount), pdfMoney(rowBalances.bank), pdfMoney(rowBalances.cash), pdfMoney(rowBalances.total), row.notes || ""
      ];
      x = margin;
      values.forEach((value, i) => {
        if (i === 2) {
          const app = String(row.upi || "");
          const style = appStyle(app);
          const cx = x + 20, cy = rowTop - 9, half = 8, rad = 3.6, k = rad * 0.5523;
          const ix = cx - half, iy = cy - half, iw = half * 2;
          const roundedRect = `${ix + rad} ${iy} m ${ix + iw - rad} ${iy} l ${ix + iw - rad + k} ${iy} ${ix + iw} ${iy + rad - k} ${ix + iw} ${iy + rad} c ` +
            `${ix + iw} ${iy + iw - rad} l ${ix + iw} ${iy + iw - rad + k} ${ix + iw - rad + k} ${iy + iw} ${ix + iw - rad} ${iy + iw} c ` +
            `${ix + rad} ${iy + iw} l ${ix + rad - k} ${iy + iw} ${ix} ${iy + iw - rad + k} ${ix} ${iy + iw - rad} c ` +
            `${ix} ${iy + rad} l ${ix} ${iy + rad - k} ${ix + rad - k} ${iy} ${ix + rad} ${iy} c h`;
          const icon = iconRefs[app];
          if (icon) {
            // Square icon, clipped to rounded corners, with a hairline edge so white icons stay visible.
            content += `q ${roundedRect} W n ${iw} 0 0 ${iw} ${ix} ${iy} cm /${icon.name} Do Q\n`;
            content += `0.82 0.85 0.88 RG 0.4 w ${roundedRect} S 0 G\n`;
          } else {
            content += `${style.color} rg ${roundedRect} f\n`;
            content += `1 1 1 rg BT /F2 8 Tf ${cx - 4} ${cy - 3} Td (${pdfText(style.letter, 2)}) Tj ET 0 g\n`;
          }
          // Invisible text preserves the exact method for compatible PDF text extraction/restore.
          content += `BT /F1 1 Tf 3 Tr ${x + 3} ${rowTop - 13} Td (${pdfText(app, 24)}) Tj ET 0 Tr\n`;
        } else {
          if (i >= 4 && i <= 7) {
            const isAmount = i === 4;
            const raw = [row.amount, rowBalances.bank, rowBalances.cash, rowBalances.total][i - 4];
            // Amount: +₹ for money received, -₹ for money sent. Balances: ₹ (or -₹ when negative).
            const sign = isAmount ? (row.direction === "sent" ? "-" : "+") : (Number(raw) < 0 ? "-" : "");
            const shown = pdfMoney(Math.abs(Number(raw) || 0));
            const color = isAmount ? (sign === "-" ? "0.78 0.16 0.20" : "0.08 0.52 0.31") : "0.12 0.16 0.22";
            const size = 7, textFont = isAmount ? "/F2" : "/F1", rupeeFont = isAmount ? "/F4" : "/F3";
            const advance = (isAmount ? RUPEE_ADVANCE_EM.bold : RUPEE_ADVANCE_EM.regular) * size;
            const rupeeX = x + 3 + pdfSignWidth(sign, isAmount, size);
            const numberX = (rupeeX + advance + 0.4).toFixed(2);
            const maxChars = Math.max(4, Math.floor((cols[i].w - (numberX - x) - 2) / 3.3));
            content += `${color} rg\n`;
            // Invisible plain-text copy at the original column coordinate for the PDF restore fallback parser.
            content += `BT /F1 1 Tf 3 Tr ${x + 3} ${rowTop - 13} Td (${pdfText(sign + shown, 30)}) Tj ET 0 Tr\n`;
            if (sign) content += `BT ${textFont} ${size} Tf ${x + 3} ${rowTop - 13} Td (${sign}) Tj ET\n`;
            content += `BT ${rupeeFont} ${size} Tf ${rupeeX.toFixed(2)} ${rowTop - 13} Td <0001> Tj ET\n`;
            content += `BT ${textFont} ${size} Tf ${numberX} ${rowTop - 13} Td (${pdfText(shown, maxChars)}) Tj ET\n0 g\n`;
          } else {
            content += `BT /F1 7 Tf ${x + 3} ${rowTop - 13} Td (${pdfText(value, Math.floor((cols[i].w - 5) / 3.1))}) Tj ET\n`;
          }
        }
        x += cols[i].w;
      });
      y -= rowH;
    });

    // Footer with page count and report context.
    content += `0.48 0.53 0.60 rg BT /F1 7 Tf ${margin} 18 Td (Private statement  |  ${page.rows.length} transaction${page.rows.length === 1 ? "" : "s"} on this page) Tj ET\n`;
    content += `BT /F2 7 Tf ${W - margin - 55} 18 Td (Page ${pageNo} of ${pages.length}) Tj ET 0 g\n`;
    return content;
  };

  pages.forEach((page, index) => {
    const stream = drawPage(page, index + 1);
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    contentIds.push(contentId);
    pageIds.push(add(null));
  });
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  pageIds.forEach((pageId, index) => {
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R /F3 ${rupeeFontId} 0 R /F4 ${rupeeBoldFontId} 0 R >> /XObject << ${Object.values(iconRefs).map(r => `/${r.name} ${r.id} 0 R`).join(" ")} >> >> /Contents ${contentIds[index]} 0 R >>`;
  });
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const exportPayload = {
    app: "My Money Tracker", version: 1, openingBalance: Number(openingBalance) || 0,
    transactions: rows.map(tx => ({ date: tx.date, details: tx.details, upi: tx.upi, category: tx.category,
      direction: tx.direction, amount: tx.amount, notes: tx.notes || "",
      createdAt: Number(tx.createdAt) || new Date(tx.date).getTime() }))
  };
  let output = "%PDF-1.4\n%MMT-DATA:" + encodeURIComponent(JSON.stringify(exportPayload)) + "\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = output.length; output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([output], { type: "application/pdf" });
}
function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadPdfStatement() {
  const rows = await allTx();
  if (!rows.length) {
    alert("No transactions to export yet.");
    return false;
  }
  const filename = `my-money-statement-${new Date().toISOString().slice(0, 10)}.pdf`;
  const openingBalance = await getOpeningBalance();
  downloadBlob(makePdf(rows, openingBalance), filename);
  return true;
}

function decodePdfLiteral(value) {
  return value.replace(/\\([\\()])/g, "$1").replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
}

function parsePdfDate(value) {
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[4]);
  const meridiem = (match[6] || "").toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), hour, Number(match[5]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parsePdfMoney(value) {
  const cleaned = String(value || "").replace(/^INR\s*/i, "").replace(/,/g, "").trim();
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN;
}

async function readTransactionsFromPdf(file) {
  if (file.type && file.type !== "application/pdf") throw new Error("Please select a PDF file.");
  const source = await file.text();
  if (!source.startsWith("%PDF-")) throw new Error("This file is not a valid PDF.");
  const embedded = source.match(/^%MMT-DATA:([^\r\n]+)/m);
  if (embedded) {
    let payload;
    try { payload = JSON.parse(decodeURIComponent(embedded[1])); }
    catch { throw new Error("The My Money Tracker PDF data is damaged."); }
    if (payload?.app === "My Money Tracker" && Array.isArray(payload.transactions)) {
      const transactions = payload.transactions.map((tx, i) => {
        const date = new Date(tx.date);
        const amount = Number(tx.amount);
        if (!Number.isFinite(date.getTime()) || !(amount > 0) || !["sent", "received"].includes(tx.direction)) {
          throw new Error(`Transaction #${i + 1} in this PDF is invalid.`);
        }
        return {date: date.toISOString(), details: String(tx.details || "").trim(), upi: (String(tx.upi || "Other").trim().toLowerCase() === "fampay" ? "Other" : String(tx.upi || "Other")), category: String(tx.category || "Other"), direction: tx.direction, amount: Math.round(amount * 100) / 100, notes: String(tx.notes || ""), createdAt: Number(tx.createdAt) || date.getTime()};
      });
      return {transactions, openingBalance: Number(payload.openingBalance) || 0};
    }
  }
  // Fallback: parse the visible table from this app's uncompressed PDF format.
  const streams = [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => m[1]);
  if (!streams.length) throw new Error("No readable transaction table was found. Use a PDF exported by My Money Tracker.");
  const records = [];
  // Column text positions for the current statement layout. The payment-method label
  // is intentionally invisible in the PDF but retained for reliable restore fallback.
  const expectedX = [27, 109, 234, 282, 354, 430, 521, 597, 689];
  for (const stream of streams) {
    const byY = new Map();
    const re = /BT\s+\/F[12]\s+\d+\s+Tf\s+(?:3\s+Tr\s+)?(-?\d+)\s+(-?\d+)\s+Td\s+\(((?:\\.|[^\\)])*)\)\s+Tj\s+ET/g;
    for (const m of stream.matchAll(re)) {
      const x = Number(m[1]), y = Number(m[2]), value = decodePdfLiteral(m[3]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({x, value});
    }
    for (const cells of byY.values()) {
      const row = expectedX.map(x => cells.find(c => c.x === x)?.value ?? "");
      if (!/^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}/.test(row[0])) continue;
      const date = parsePdfDate(row[0]);
      const signedAmount = String(row[4] || "").trim();
      const direction = signedAmount.startsWith("-") ? "sent" : signedAmount.startsWith("+") ? "received" : null;
      const amount = parsePdfMoney(signedAmount.replace(/^[+-]/, ""));
      if (!date || !(amount > 0) || !direction || !row[1].trim() || !row[2].trim()) continue;
      const pdfClosing = parsePdfMoney(row[7]);
      records.push({date, details: row[1].trim(), upi: row[2].trim(), category: row[3].trim() || "Other", direction, amount, pdfClosing: Number.isFinite(pdfClosing) ? pdfClosing : null, notes: row[8].trim(), createdAt: new Date(date).getTime()});
    }
  }
  if (!records.length) throw new Error("No transactions could be read. Please select a PDF statement exported by My Money Tracker.");
  return {transactions: records, openingBalance: null};
}

function duplicateKey(tx) {
  return [String(tx.details || "").trim().toLocaleLowerCase(), Number(tx.amount).toFixed(2), String(tx.upi || "").trim().toLocaleLowerCase()].join("\\u001f");
}

async function restorePdf(file, mode) {
  const pdfData = await readTransactionsFromPdf(file);
  const imported = pdfData.transactions;
  const existing = await allTx();
  let chosen;
  if (mode === "replace") {
    chosen = imported;
  } else {
    const seen = new Set(existing.map(duplicateKey));
    const additions = imported.filter(tx => {
      const key = duplicateKey(tx);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    chosen = [...existing.map(tx => ({...tx})), ...additions];
  }

  // Keep the existing opening balance for combine. For replace, infer the
  // starting balance from the earliest row when the PDF includes its balance.
  let openingBalance = mode === "combine" ? await getOpeningBalance() : (pdfData.openingBalance ?? 0);
  chosen.sort((a, b) => new Date(a.date) - new Date(b.date) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
  if (mode === "replace" && pdfData.openingBalance === null) {
    const earliest = chosen[0];
    const effect = earliest?.direction === "sent" ? -Number(earliest.amount) : Number(earliest?.amount || 0);
    openingBalance = earliest && Number.isFinite(earliest.pdfClosing) ? Math.round((earliest.pdfClosing - effect) * 100) / 100 : 0;
  }
  let balance = Math.round(Number(openingBalance || 0) * 100) / 100;
  chosen = chosen.map(tx => {
    balance += tx.direction === "sent" ? -Number(tx.amount) : Number(tx.amount);
    const clean = {...tx, amount: Math.round(Number(tx.amount) * 100) / 100, closing: Math.round(balance * 100) / 100, createdAt: Number(tx.createdAt) || new Date(tx.date).getTime()};
    delete clean.pdfClosing;
    return clean;
  });

  await new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = state.db.transaction(["transactions", "settings"], "readwrite");
      const store = transaction.objectStore("transactions");
      const settings = transaction.objectStore("settings");
      store.clear();
      if (mode === "replace") {
        settings.clear();
        settings.put({key:"openingBalance", value:openingBalance});
      }
      chosen.forEach(tx => {
        const clean = {...tx};
        delete clean.id;
        store.add(clean);
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("PDF restore failed."));
      transaction.onabort = () => reject(transaction.error || new Error("PDF restore was cancelled; existing data was preserved."));
    } catch (error) {
      try { transaction?.abort(); } catch {}
      reject(error);
    }
  });
  await renderAll();
}

function setupExports() {
  $("downloadPdf").onclick = () => downloadPdfStatement().catch(error => alert(`PDF export failed: ${error.message}`));
}
