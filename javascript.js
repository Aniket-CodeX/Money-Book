const APPS = [
  "Google Pay","Amazon Pay","Paytm","BHIM",
  "SuperMoney","Navi","FamPay","PhonePe"
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
  sort: "newest"
};

const $ = id => document.getElementById(id);
const money = value => "₹" + Number(value || 0).toLocaleString("en-IN", {
  maximumFractionDigits: 2
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"
  }[char]));
}

function appEmoji(app) {
  return ({
    "Google Pay":"G","Amazon Pay":"A","Paytm":"P","BHIM":"B",
    "SuperMoney":"S","Navi":"N","FamPay":"F","PhonePe":"P"
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

async function recalculateBalances() {
  const rows = (await getAll("transactions")).sort((a,b) => {
    return new Date(a.date) - new Date(b.date) || Number(a.id) - Number(b.id);
  });

  let balance = await getOpeningBalance();

  for (const tx of rows) {
    balance += tx.direction === "sent"
      ? -Number(tx.amount || 0)
      : Number(tx.amount || 0);

    tx.closing = balance;
    await putRecord("transactions", tx);
  }
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
        ${tx.direction === "sent" ? "−" : "+"}${money(tx.amount).slice(1)}
      </div>
    </article>`;
}

async function renderHome() {
  const rows = (await getAll("transactions")).sort(
    (a,b) => new Date(b.date) - new Date(a.date)
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

  $("monthLabel").textContent = new Date().toLocaleDateString("en-IN", {
    month:"long", year:"numeric"
  });

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
    const height = Math.max(8, value / max * 100);
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
    `<option value="">All UPI apps</option>` +
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

    return (
      (state.transactionFilter === "all" || tx.direction === state.transactionFilter) &&
      (!q || searchable.includes(q)) &&
      (!state.category || tx.category === state.category) &&
      (!state.app || tx.upi === state.app) &&
      (min === null || amount >= min) &&
      (max === null || amount <= max)
    );
  });

  result.sort((a,b) => {
    if (state.sort === "oldest") return new Date(a.date) - new Date(b.date);
    if (state.sort === "high") return Number(b.amount) - Number(a.amount);
    if (state.sort === "low") return Number(a.amount) - Number(b.amount);
    return new Date(b.date) - new Date(a.date);
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

  $("filterCategory").value = state.category;
  $("filterApp").value = state.app;
  $("minAmount").value = state.minAmount;
  $("maxAmount").value = state.maxAmount;
  $("sortTransactions").value = state.sort;

  bindTransactionClicks($("allTransactions"));
}

async function renderAnalysis() {
  const rows = await getAll("transactions");
  let sent = 0, received = 0;
  const categoryTotals = {};
  const appTotals = {};
  const people = {};
  const monthly = {};
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

      const month = new Date(tx.date).toLocaleDateString("en-IN", {
        month:"short", year:"numeric"
      });
      monthly[month] = (monthly[month] || 0) + amount;
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
      <strong>Which UPI app did I spend the most through?</strong>
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
      state.category = button.dataset.category;
      state.transactionFilter = "all";
      state.search = "";
      state.app = "";
      state.minAmount = "";
      state.maxAmount = "";
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
    : `<div class="empty">Add sent transactions to see UPI app spending.</div>`;

  $("appAnalysis").querySelectorAll("[data-app]").forEach(button => {
    button.onclick = () => {
      state.app = button.dataset.app;
      state.category = "";
      navigate(1);
    };
  });

  const monthEntries = Object.entries(monthly);
  monthEntries.reverse();

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
          ${tx.direction === "sent" ? "−" : "+"}${money(tx.amount).slice(1)}
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
        <span>UPI app</span>
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
    </div>`;
  $("detailModal").classList.add("open");
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

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function restoreData(file) {
  const data = JSON.parse(await file.text());

  if (!Array.isArray(data.transactions)) {
    throw new Error("Invalid backup file.");
  }

  await clearStore("transactions");
  await clearStore("settings");

  await putRecord("settings", {
    key:"openingBalance",
    value:Number(data.openingBalance || 0)
  });

  for (const tx of data.transactions) {
    const copy = {...tx};
    delete copy.id;
    await addRecord("transactions", copy);
  }

  await recalculateBalances();
  await renderAll();
  alert("Backup restored successfully.");
}

async function exportCSV() {
  const rows = await getAll("transactions");
  const headers = [
    "Date & Time","Transaction Details","UPI App",
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
  ].map(row => row.map(value =>
    `"${String(value ?? "").replace(/"/g,'""')}"`
  ).join(",")).join("\n");

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

    closeTransactionModal();
    await renderAll();
    navigate(0);
  };
}

async function init() {
  try {
    populateSelects();
    wireEvents();
    await openDB();
    await renderAll();
  } catch (error) {
    console.error(error);
    alert("My Money Tracker could not open its local database.");
  }
}

document.addEventListener("DOMContentLoaded", init);
