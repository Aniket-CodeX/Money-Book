const APPS = [
  "Google Pay","Amazon Pay","Paytm","BHIM",
  "SuperMoney","Navi","FamPay","PhonePe","Cash"
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
    "SuperMoney":"S","Navi":"N","FamPay":"F","PhonePe":"P","Cash":"₹"
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
  const value = Math.max(0, Number($("openingBalance").value || 0));
  await putRecord("settings", { key:"openingBalance", value });
  await recalculateBalances();
  await renderAll();
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
  const screens = [
    $("homeScreen"), $("transactionsScreen"),
    $("analysisScreen"), $("settingsScreen")
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

async function backupData() {
  const data = {
    app: "My Money Tracker",
    version: 1,
    exportedAt: new Date().toISOString(),
    openingBalance: await getOpeningBalance(),
    transactions: await getAll("transactions")
  };

  downloadBlob(
    JSON.stringify(data, null, 2),
    `my-money-tracker-backup-${new Date().toISOString().slice(0,10)}.json`,
    "application/json"
  );
}

async function restoreData(file) {
  const data = JSON.parse(await file.text());

  if (!data || !Array.isArray(data.transactions)) {
    throw new Error("Invalid backup file.");
  }

  const clean = data.transactions.map((tx, i) => {
    const amount = Number(tx?.amount);
    if (!tx || !tx.date || Number.isNaN(new Date(tx.date).getTime()) ||
        !(amount > 0) || !["sent","received"].includes(tx.direction)) {
      throw new Error(`Transaction #${i + 1} in the backup is missing a valid date, amount or direction.`);
    }
    return {
      ...tx,
      amount,
      details: String(tx.details ?? ""),
      upi: tx.upi ?? "",
      category: tx.category ?? "Other",
      notes: tx.notes ?? ""
    };
  });

  await clearStore("transactions");
  await clearStore("settings");

  await putRecord("settings", {
    key:"openingBalance",
    value:Math.max(0, Number(data.openingBalance) || 0)
  });

  for (const tx of clean) {
    const copy = {...tx};
    delete copy.id;
    await addRecord("transactions", copy);
  }

  await recalculateBalances();
  await renderAll();
  alert("Backup restored successfully.");
}

function csvCell(value) {
  let text = String(value ?? "");
  // Stop spreadsheet apps from running text such as "=SUM(...)" as a formula
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportCSV() {
  const rows = await getAll("transactions");
  const headers = [
    "Date & Time","Transaction Details","Payment Method",
    "Category","Payment","Amount","Closing Balance","Notes"
  ];

  const csv = [
    headers,
    ...rows.sort((a,b) => new Date(a.date) - new Date(b.date)).map(tx => [
      tx.date,
      tx.details,
      tx.upi,
      tx.category,
      tx.direction === "sent" ? "Payment sent" : "Payment received",
      tx.amount,
      tx.closing,
      tx.notes || ""
    ])
  ].map(row => row.map(csvCell).join(",")).join("\n");

  downloadBlob("\ufeff" + csv, "my-money-tracker.csv", "text/csv;charset=utf-8");
}

async function renderAll() {
  await renderHome();
  await renderTransactions();
  await renderAnalysis();
  await loadSettings();
}

function wireEvents() {
  $("addButton").onclick = openTransactionModal;
  $("addFromTransactions").onclick = openTransactionModal;
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
  $("settingsButton").onclick = () => navigate(3);

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
  $("backupButton").onclick = backupData;
  $("csvButton").onclick = exportCSV;

  $("restoreFile").onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (!confirm("Restore this backup? Current local transactions will be replaced.")) {
        event.target.value = "";
        return;
      }
      await restoreData(file);
    } catch (error) {
      alert("Could not restore the backup: " + error.message);
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

async function init() {
  try {
    populateSelects();
    wireEvents();
    setupExports();
    await openDB();
    await renderAll();
    runDueAutoPdf();
  } catch (error) {
    console.error(error);
    alert("My Money Tracker could not open its local database.");
  }
}

document.addEventListener("DOMContentLoaded", init);


/* PDF statement export + offline recurring statements */
const AUTO_PDF_KEY = "myMoneyTrackerAutoPdf";

function readAutoPdfConfig() {
  try {
    return JSON.parse(localStorage.getItem(AUTO_PDF_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeAutoPdfConfig(config) {
  try {
    localStorage.setItem(AUTO_PDF_KEY, JSON.stringify(config));
  } catch (error) {
    console.error(error);
  }
}

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
  return "INR " + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function makePdf(rows) {
  const W = 842, H = 595, margin = 24, rowH = 20, headerH = 28;
  const cols = [
    { n: "Date / Time", w: 100 }, { n: "Details", w: 145 }, { n: "Payment Method", w: 80 },
    { n: "Category", w: 82 }, { n: "Type", w: 58 }, { n: "Amount", w: 75 },
    { n: "Balance", w: 82 }, { n: "Notes", w: 140 }
  ];
  const pageRows = Math.max(1, Math.floor((H - 38 - 35 - headerH - 40) / rowH));
  const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date) || Number(a.id) - Number(b.id));
  const pages = [];
  for (let i = 0; i < sorted.length || i === 0; i += pageRows) pages.push(sorted.slice(i, i + pageRows));

  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pagesId = add(null);
  const pageIds = [];
  const contentIds = [];

  const drawPage = (page, pageNo) => {
    let y = H - 38;
    let content = `BT /F1 15 Tf ${margin} ${y} Td (My Money Tracker - Transaction Statement) Tj ET\n`;
    content += `BT /F1 8 Tf ${margin} ${y - 16} Td (Generated offline on ${pdfSafe(new Date().toLocaleString("en-IN"))}) Tj ET\n`;
    y -= 35;
    let x = margin;
    const totalWidth = cols.reduce((sum, col) => sum + col.w, 0);
    content += `0.88 g ${x} ${y - headerH + 5} ${totalWidth} ${headerH} re f 0 g\n`;
    cols.forEach(col => {
      content += `BT /F1 8 Tf ${x} ${y - 17} Td (${pdfText(col.n, 40)}) Tj ET\n`;
      x += col.w;
    });
    y -= headerH;

    page.forEach(row => {
      x = margin;
      content += `${x} ${y} m ${margin + totalWidth} ${y} l S\n`;
      const values = [
        pdfDate(row.date), row.details, row.upi, row.category,
        row.direction === "sent" ? "Sent" : "Received", pdfMoney(row.amount),
        pdfMoney(row.closing), row.notes || ""
      ];
      values.forEach((value, i) => {
        content += `BT /F1 7 Tf ${x} ${y - 14} Td (${pdfText(value, Math.floor(cols[i].w / 3.8))}) Tj ET\n`;
        x += cols[i].w;
      });
      y -= rowH;
    });
    content += `BT /F1 7 Tf ${margin} 18 Td (Page ${pageNo} of ${pages.length}) Tj ET\n`;
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
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`;
  });

  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = output.length;
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
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

async function downloadPdfStatement(reason = "manual") {
  const rows = await allTx();
  if (!rows.length) {
    if (reason === "manual") alert("No transactions to export yet.");
    return false;
  }
  const filename = `my-money-statement-${new Date().toISOString().slice(0, 10)}.pdf`;
  downloadBlob(makePdf(rows), filename);

  const existing = readAutoPdfConfig();
  writeAutoPdfConfig({
    enabled: !!existing.enabled,
    interval: existing.interval || "daily",
    last: Date.now()
  });
  return true;
}

async function downloadCsvStatement() {
  const rows = (await allTx()).sort((a, b) => new Date(a.date) - new Date(b.date));
  const escapeCsv = csvCell;
  const data = [
    ["Date & Time", "Transaction Details", "Payment Method", "Category", "Type", "Amount", "Closing Balance", "Notes"],
    ...rows.map(row => [
      new Date(row.date).toLocaleString("en-IN"), row.details, row.upi, row.category,
      row.direction === "sent" ? "Sent" : "Received", row.amount, row.closing, row.notes
    ])
  ];
  const csv = data.map(row => row.map(escapeCsv).join(",")).join("\n");
  downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `my-money-statement-${new Date().toISOString().slice(0, 10)}.csv`);
}

function dueAutoPdf(config) {
  if (!config.enabled) return false;
  const elapsed = Date.now() - Number(config.last || 0);
  if (config.interval === "daily") return elapsed >= 86400000;
  if (config.interval === "weekly") return elapsed >= 604800000;
  if (config.interval === "monthly") return elapsed >= 2592000000;
  return false;
}

function autoPdfStatusText(config) {
  return config.enabled
    ? `Automatic PDF: ${config.interval} (page must stay open).`
    : "Automatic PDF is off.";
}

function setupAutoPdf() {
  const checkbox = $("autoPdfEnabled");
  const interval = $("autoPdfInterval");
  const status = $("autoPdfStatus");
  if (!checkbox || !interval || !status) return;

  const config = readAutoPdfConfig();
  config.interval = config.interval || "daily";
  checkbox.checked = !!config.enabled;
  interval.value = config.interval;
  status.textContent = autoPdfStatusText(config);

  const save = () => {
    // Re-read so a download made since page load keeps its `last` timestamp
    const current = readAutoPdfConfig();
    const next = { enabled: checkbox.checked, interval: interval.value, last: current.last || 0 };
    writeAutoPdfConfig(next);
    status.textContent = autoPdfStatusText(next);
    return next;
  };

  checkbox.onchange = () => {
    save();
    if (checkbox.checked) {
      downloadPdfStatement("auto").then(done => {
        if (done) status.textContent = autoPdfStatusText(readAutoPdfConfig());
      }).catch(console.error);
    }
  };
  interval.onchange = save;
}

function runDueAutoPdf() {
  const config = readAutoPdfConfig();
  if (!dueAutoPdf(config)) return;
  downloadPdfStatement("auto").then(done => {
    const status = $("autoPdfStatus");
    if (done && status) status.textContent = `Automatic PDF downloaded. Next: ${config.interval}.`;
  }).catch(console.error);
}

function setupExports() {
  $("downloadPdf").onclick = () => downloadPdfStatement().catch(error => alert(`PDF export failed: ${error.message}`));
  $("downloadCsv").onclick = () => downloadCsvStatement().catch(error => alert(`CSV export failed: ${error.message}`));
  setupAutoPdf();
}

