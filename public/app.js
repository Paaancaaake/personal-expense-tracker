"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  user: null,
  authMode: "login",
  page: "overview",
  month: localMonth(),
  categories: { expense: [], income: [] },
  transactions: [],
  dashboard: null,
  editingId: null,
  deleteId: null,
  toastTimer: null
};
const COLORS = ["#F59E0B", "#4ADE80", "#A78BFA", "#FB7185", "#38BDF8", "#F97316", "#2DD4BF", "#E879F9", "#A3E635", "#94A3B8"];

function localMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
}
function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function monthLabel(value) {
  if (!value) return "Selected month";
  const date = new Date(`${value}-01T12:00:00`);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(date);
}
async function api(url, options = {}) {
  const config = { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } };
  const response = await fetch(url, config);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.fields = data?.fields || {};
    throw error;
  }
  return data;
}
function showToast(message, type = "success") {
  const region = $("#toast-region");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}
function setMessage(element, message, type = "") {
  element.textContent = message || "";
  element.classList.toggle("success", type === "success");
}
function clearFieldErrors(form) {
  $$(".field-error", form).forEach(el => { el.textContent = ""; });
  $$("[aria-invalid='true']", form).forEach(el => el.removeAttribute("aria-invalid"));
}
function showFieldErrors(form, errors) {
  const fieldErrorIds = {
    name: "auth-name-error",
    email: "auth-email-error",
    password: "auth-password-error",
    amount: form.id === "budget-form" ? "budget-amount-error" : "transaction-amount-error",
    month: "budget-month-error",
    category: "transaction-category-error",
    transaction_date: "transaction-date-error",
    description: "transaction-description-error"
  };
  Object.entries(errors || {}).forEach(([name, message]) => {
    const input = form.elements.namedItem(name);
    const error = fieldErrorIds[name] ? document.getElementById(fieldErrorIds[name]) :
      $(`#${CSS.escape(name)}-error`, form);
    if (input && typeof input.setAttribute === "function") input.setAttribute("aria-invalid", "true");
    if (input && typeof input.length === "number") {
      [...input].forEach(item => item.setAttribute("aria-invalid", "true"));
    }
    if (error) error.textContent = message;
  });
}
function showAuthView() {
  $("#auth-view").classList.remove("hidden");
  $("#app-view").classList.add("hidden");
  $("#auth-email").focus();
}
function showAppView() {
  $("#auth-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  const firstName = (state.user.name || "there").trim().split(/\s+/)[0];
  $("#greeting-name").textContent = firstName;
  $("#sidebar-user-name").textContent = state.user.name;
  $("#sidebar-user-email").textContent = state.user.email;
  $("#user-avatar").textContent = (state.user.name || "U").trim().charAt(0).toUpperCase();
  $("#global-month").value = state.month;
  $("#budget-month").value = state.month;
  navigate(state.page, false);
  refreshData().catch(handleError);
}
function handleError(error) {
  if (error.status === 401) {
    state.user = null;
    showAuthView();
    setMessage($("#auth-message"), "Your session has ended. Please sign in again.");
    return;
  }
  showToast(error.message || "Something went wrong.", "error");
}
function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  $$("[data-auth-mode]").forEach(button => {
    const active = button.dataset.authMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $("#register-name-field").classList.toggle("hidden", !isRegister);
  $("#auth-title").innerHTML = isRegister ? "Start with a<br><span>clearer picture.</span>" : "Make room for<br><span>better decisions.</span>";
  $("#auth-password").autocomplete = isRegister ? "new-password" : "current-password";
  $("#auth-password-hint").textContent = isRegister ? "Use at least 8 characters." : "Use your account password.";
  $("#auth-submit").innerHTML = isRegister ? "Create account <span aria-hidden=\"true\">→</span>" : "Sign in <span aria-hidden=\"true\">→</span>";
  $("#auth-name").required = isRegister;
  clearFieldErrors($("#auth-form"));
  setMessage($("#auth-message"), "");
}
async function submitAuth(event) {
  event.preventDefault();
  const form = $("#auth-form");
  clearFieldErrors(form);
  setMessage($("#auth-message"), "");
  const name = $("#auth-name").value.trim();
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const errors = {};
  if (state.authMode === "register" && (name.length < 2 || name.length > 100)) errors.name = "Enter a name between 2 and 100 characters.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  if (password.length < (state.authMode === "register" ? 8 : 1) || password.length > 72) errors.password = state.authMode === "register" ? "Password must be 8–72 characters." : "Enter your password.";
  if (Object.keys(errors).length) {
    showFieldErrors(form, errors);
    const first = Object.keys(errors)[0];
    form.elements.namedItem(first)?.focus();
    return;
  }
  const button = $("#auth-submit");
  button.disabled = true;
  button.textContent = state.authMode === "register" ? "Creating account…" : "Signing in…";
  try {
    const data = await api(`/api/auth/${state.authMode === "register" ? "register" : "login"}`, {
      method: "POST", body: JSON.stringify({ name, email, password })
    });
    state.user = data.user;
    state.page = "overview";
    showAppView();
  } catch (error) {
    showFieldErrors(form, error.fields);
    setMessage($("#auth-message"), error.message);
    if (error.status >= 500) setMessage($("#auth-message"), `${error.message} Confirm MySQL is running and configured.`);
  } finally {
    button.disabled = false;
    button.innerHTML = state.authMode === "register" ? "Create account <span aria-hidden=\"true\">→</span>" : "Sign in <span aria-hidden=\"true\">→</span>";
  }
}
function navigate(page, updateHash = true) {
  const validPages = ["overview", "transactions", "budget", "analytics", "goals", "recurring", "calendar", "groups", "settings"];
  state.page = validPages.includes(page) ? page : "overview";
  $$(".page-section").forEach(section => section.classList.add("hidden"));
  $(`#${state.page}-page`).classList.remove("hidden");
  $$("[data-page]").forEach(link => {
    const active = link.dataset.page === state.page;
    link.classList.toggle("is-current", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $("#breadcrumb-current").textContent = ({ overview: "Overview", transactions: "Transactions", budget: "Budgets", analytics: "Analytics & reports", goals: "Savings goals", recurring: "Recurring", calendar: "Calendar", groups: "Group splits", settings: "Settings" })[state.page];
  $("#sidebar").classList.remove("is-open");
  $("#mobile-menu-button").setAttribute("aria-expanded", "false");
  if (updateHash && location.hash !== `#${state.page}`) history.pushState({ page: state.page }, "", `#${state.page}`);
  if (state.user) {
    if (state.page === "transactions") loadTransactions().catch(handleError);
    if (state.page === "budget") { loadDashboard().then(loadCategoryBudgets).catch(handleError); }
    if (state.page === "analytics") loadAnalytics().catch(handleError);
    if (state.page === "goals") loadGoals().catch(handleError);
    if (state.page === "recurring") loadRecurring().catch(handleError);
    if (state.page === "calendar") loadCalendar().catch(handleError);
    if (state.page === "groups") loadGroups().catch(handleError);
    if (state.page === "settings") loadSettings();
  }
}
async function refreshData() {
  await Promise.all([loadDashboard(), loadTransactions()]);
}
async function loadDashboard() {
  const data = await api(`/api/dashboard?month=${encodeURIComponent(state.month)}`);
  state.dashboard = data;
  renderDashboard(data);
  renderBudget(data);
}
async function loadTransactions() {
  const params = new URLSearchParams();
  const type = $("#transaction-type-filter").value;
  const search = $("#transaction-search").value.trim();
  const startDate = $("#transaction-start-date").value;
  const endDate = $("#transaction-end-date").value;
  const sort = $("#transaction-sort").value;
  if (!startDate && !endDate && $("#global-month").value) params.set("month", $("#global-month").value);
  if (type) params.set("type", type);
  if (search) params.set("search", search);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (sort) params.set("sort", sort);
  const data = await api(`/api/transactions?${params.toString()}`);
  state.transactions = data.transactions;
  renderTransactions(data.transactions);
}
function renderDashboard(data) {
  const summary = data.summary;
  $("#balance-value").textContent = money(summary.balance);
  $("#income-value").textContent = money(summary.income);
  $("#expenses-value").textContent = money(summary.expenses);
  $("#expense-count").textContent = `${Number(summary.transaction_count)} transaction${Number(summary.transaction_count) === 1 ? "" : "s"} this month`;
  $("#breakdown-month").textContent = monthLabel(data.month);
  renderCategoryChart(data.categories, summary.expenses);
  renderTrendChart(data.trend || []);
  renderRecent(data.recent || []);
}
function renderCategoryChart(categories, total) {
  const chart = $("#category-chart");
  const legend = $("#category-legend");
  if (!categories.length || Number(total) <= 0) {
    chart.innerHTML = '<div class="empty-chart"><span aria-hidden="true">◌</span><p>No expenses to break down yet.</p><span>Add an expense to see your spending by category.</span></div>';
    chart.setAttribute("aria-label", "No expenses recorded for the selected month.");
    legend.innerHTML = "";
    return;
  }
  let cumulative = 0;
  const segments = categories.map((item, index) => {
    const start = cumulative;
    cumulative += Number(item.total) / Number(total) * 100;
    return `${COLORS[index % COLORS.length]} ${start}% ${cumulative}%`;
  });
  chart.innerHTML = `<div class="donut-chart" style="background: conic-gradient(${segments.join(",")})"><div class="donut-center"><strong>${money(total)}</strong><span>total spent</span></div></div>`;
  chart.setAttribute("aria-label", `Expense category breakdown. Total expenses ${money(total)} across ${categories.length} categories.`);
  legend.innerHTML = categories.map((item, index) => {
    const percentage = Number(total) > 0 ? Math.round(Number(item.total) / Number(total) * 100) : 0;
    return `<li class="legend-item"><span class="legend-swatch" style="background:${COLORS[index % COLORS.length]}" aria-hidden="true"></span><span class="legend-name">${escapeHtml(item.category)} · ${percentage}%</span><strong class="legend-value">${money(item.total)}</strong></li>`;
  }).join("");
}
function renderTrendChart(trend) {
  const chart = $("#trend-chart");
  if (!trend.length || trend.every(item => Number(item.income) === 0 && Number(item.expenses) === 0)) {
    chart.innerHTML = '<div class="empty-chart"><span aria-hidden="true">⌁</span><p>Your cash flow starts here.</p><span>Add transactions to build your history.</span></div>';
    chart.setAttribute("aria-label", "No income or expense history for the selected period.");
    return;
  }
  const months = [];
  const [year, month] = state.month.split("-").map(Number);
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(year, month - 1 - offset, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  const byMonth = new Map(trend.map(item => [item.month, item]));
  const rows = months.map(key => ({ month: key, income: Number(byMonth.get(key)?.income || 0), expenses: Number(byMonth.get(key)?.expenses || 0) }));
  const maxValue = Math.max(1, ...rows.flatMap(item => [item.income, item.expenses]));
  const width = 520, height = 220, left = 12, right = 12, top = 12, bottom = 35;
  const plotH = height - top - bottom, plotW = width - left - right, groupW = plotW / rows.length, barW = Math.min(20, groupW * .28);
  const grid = [0, .25, .5, .75, 1].map(f => {
    const y = top + plotH * f;
    return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="rgba(255,255,255,.08)" stroke-width="1"/>`;
  }).join("");
  const bars = rows.map((row, index) => {
    const xCenter = left + groupW * (index + .5);
    const incomeH = row.income / maxValue * plotH;
    const expenseH = row.expenses / maxValue * plotH;
    const incomeY = top + plotH - incomeH;
    const expenseY = top + plotH - expenseH;
    const labelDate = new Date(`${row.month}-01T12:00:00`);
    const label = new Intl.DateTimeFormat("en-IN", { month: "short" }).format(labelDate);
    return `<g><rect x="${xCenter-barW-2}" y="${incomeY}" width="${barW}" height="${Math.max(0,incomeH)}" rx="3" fill="#4ADE80"><title>${escapeHtml(label)} income: ${money(row.income)}</title></rect><rect x="${xCenter+2}" y="${expenseY}" width="${barW}" height="${Math.max(0,expenseH)}" rx="3" fill="#F59E0B"><title>${escapeHtml(label)} expenses: ${money(row.expenses)}</title></rect><text x="${xCenter}" y="${height-10}" text-anchor="middle" fill="#A1A1AA" font-size="11" font-family="Inter, sans-serif">${escapeHtml(label)}</text></g>`;
  }).join("");
  chart.innerHTML = `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Income and expense bar chart for the last six months. Green bars show income and amber bars show expenses." xmlns="http://www.w3.org/2000/svg">${grid}${bars}</svg>`;
  chart.setAttribute("aria-label", `Cash flow chart showing income and expenses for ${rows.length} months.`);
}
function transactionMarkup(transaction, withActions = false) {
  const type = transaction.type === "income" ? "income" : "expense";
  const symbol = type === "income" ? "↗" : "↘";
  const amountPrefix = type === "income" ? "+" : "−";
  const actions = withActions ? `<td><div class="row-actions"><button class="row-action" type="button" data-edit-id="${Number(transaction.id)}" aria-label="Edit ${escapeHtml(transaction.description)}">Edit</button><button class="row-action delete" type="button" data-delete-id="${Number(transaction.id)}" aria-label="Delete ${escapeHtml(transaction.description)}">Delete</button></div></td>` : "";
  return `<tr><td><div class="transaction-cell"><span class="transaction-symbol ${type}" aria-hidden="true">${symbol}</span><span class="transaction-info"><strong>${escapeHtml(transaction.description)}</strong><span>${type === "income" ? "Income" : "Expense"}</span></span></div></td><td><span class="category-pill">${escapeHtml(transaction.category)}</span></td><td>${escapeHtml(formatDate(transaction.transaction_date))}</td><td class="align-right"><span class="amount-cell ${type}">${amountPrefix}${money(transaction.amount)}</span></td>${actions}</tr>`;
}
function renderRecent(transactions) {
  const body = $("#recent-table-body");
  body.innerHTML = transactions.length ? transactions.map(item => transactionMarkup(item)).join("") : '<tr><td colspan="4" class="table-empty">No transactions for your account yet. Add your first transaction to get started.</td></tr>';
}
function renderTransactions(transactions) {
  const body = $("#transactions-table-body");
  body.innerHTML = transactions.length ? transactions.map(item => transactionMarkup(item, true)).join("") : '<tr><td colspan="5" class="table-empty">No matching transactions. Try changing your filters or add a transaction.</td></tr>';
  $("#transaction-result-count").textContent = `Showing ${transactions.length} transaction${transactions.length === 1 ? "" : "s"}${transactions.length === 500 ? " (maximum 500 shown)" : ""}`;
}
function renderBudget(data) {
  const summary = data.summary;
  const budget = Number(summary.budget) || 0;
  const expenses = Number(summary.expenses) || 0;
  const remaining = budget - expenses;
  const percent = budget > 0 ? expenses / budget * 100 : 0;
  const clamped = Math.min(100, Math.max(0, percent));
  $("#budget-month-label").textContent = `Budget progress for ${monthLabel(data.month)}`;
  $("#budget-spent-value").textContent = money(expenses);
  $("#budget-of-label").textContent = budget > 0 ? `of ${money(budget)} budgeted` : "No monthly limit set yet";
  $("#budget-progress-fill").style.width = `${clamped}%`;
  $("#budget-progress-fill").classList.toggle("over-budget", budget > 0 && expenses > budget);
  $("#budget-progress-track").setAttribute("aria-valuenow", String(Math.round(clamped)));
  $("#budget-progress-track").setAttribute("aria-valuetext", budget > 0 ? `${Math.round(percent)} percent of budget used` : "No budget set");
  $("#budget-percent-label").textContent = budget > 0 ? `${Math.round(percent)}% used` : "Set a budget to begin tracking.";
  $("#budget-remaining-label").textContent = budget > 0 ? `${money(Math.abs(remaining))} ${remaining >= 0 ? "remaining" : "over budget"}` : "Budget not set";
  const status = $("#budget-status-message");
  status.classList.toggle("over-budget", budget > 0 && expenses > budget);
  if (budget <= 0) status.textContent = "Set a monthly limit to see how your spending compares with your plan.";
  else if (expenses > budget) status.textContent = `You’re ${money(expenses - budget)} over your budget. Review your spending and adjust your plan if needed.`;
  else if (percent >= 80) status.textContent = `You’ve used ${Math.round(percent)}% of your budget. You’re getting close to your limit.`;
  else status.textContent = `You have ${money(remaining)} left for this month. Keep going at your own pace.`;
  $("#budget-amount").value = budget > 0 ? budget.toFixed(2) : "";
  $("#budget-month").value = data.month;
}
function renderCategoryOptions(type, selected = "") {
  const options = state.categories[type] || [];
  $("#transaction-category").innerHTML = '<option value="">Choose category</option>' + options.map(category => `<option value="${escapeHtml(category)}"${category === selected ? " selected" : ""}>${escapeHtml(category)}</option>`).join("");
}
async function openTransactionDialog(transaction = null) {
  const dialog = $("#transaction-dialog");
  const form = $("#transaction-form");
  form.reset();
  clearFieldErrors(form);
  setMessage($("#transaction-form-message"), "");
  state.editingId = transaction ? Number(transaction.id) : null;
  $("#transaction-id").value = state.editingId || "";
  $("#transaction-dialog-title").textContent = transaction ? "Edit transaction" : "Add transaction";
  $("#save-transaction").textContent = transaction ? "Save changes" : "Save transaction";
  const type = transaction?.type || "expense";
  const typeRadio = $(`input[name="type"][value="${type}"]`);
  if (typeRadio) typeRadio.checked = true;
  renderCategoryOptions(type, transaction?.category || "");
  $("#transaction-amount").value = transaction ? Number(transaction.amount).toFixed(2) : "";
  $("#transaction-date").value = transaction?.transaction_date ? String(transaction.transaction_date).slice(0, 10) : localDate();
  $("#transaction-description").value = transaction?.description || "";
  $("#transaction-payment").value = transaction?.payment_method || "Other";
  if (!dialog.open) dialog.showModal();
  $("#transaction-amount").focus();
}
function closeTransactionDialog() {
  if ($("#transaction-dialog").open) $("#transaction-dialog").close();
}
async function submitTransaction(event) {
  event.preventDefault();
  const form = $("#transaction-form");
  clearFieldErrors(form);
  setMessage($("#transaction-form-message"), "");
  const type = $('input[name="type"]:checked', form)?.value || "";
  const amount = $("#transaction-amount").value;
  const category = $("#transaction-category").value;
  const transactionDate = $("#transaction-date").value;
  const description = $("#transaction-description").value.trim();
  const payment_method = $("#transaction-payment").value;
  const errors = {};
  if (!["income", "expense"].includes(type)) errors.type = "Choose income or expense.";
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) errors.amount = "Enter an amount greater than zero.";
  if (!category) errors.category = "Choose a category.";
  if (!transactionDate) errors.transaction_date = "Choose a date.";
  if (!description || description.length > 180) errors.description = "Enter a description (maximum 180 characters).";
  if (Object.keys(errors).length) {
    showFieldErrors(form, errors);
    if (errors.type) $("#transaction-type-error").textContent = errors.type;
    const focusTarget = ({ amount: $("#transaction-amount"), category: $("#transaction-category"), transaction_date: $("#transaction-date"), description: $("#transaction-description") })[Object.keys(errors)[0]];
    focusTarget?.focus();
    return;
  }
  const button = $("#save-transaction");
  button.disabled = true;
  button.textContent = "Saving…";
  const payload = { type, amount: Number(amount), category, transaction_date: transactionDate, description, payment_method };
  try {
    if (state.editingId) {
      await api(`/api/transactions/${state.editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Transaction updated.");
    } else {
      await api("/api/transactions", { method: "POST", body: JSON.stringify(payload) });
      showToast("Transaction saved.");
    }
    closeTransactionDialog();
    await refreshData();
  } catch (error) {
    showFieldErrors(form, error.fields);
    setMessage($("#transaction-form-message"), error.message);
  } finally {
    button.disabled = false;
    button.textContent = state.editingId ? "Save changes" : "Save transaction";
  }
}
function openDeleteDialog(id) {
  state.deleteId = Number(id);
  const transaction = state.transactions.find(item => Number(item.id) === state.deleteId);
  $("#confirm-description").textContent = transaction ? `Delete “${transaction.description}”? This action cannot be undone.` : "This action cannot be undone.";
  $("#confirm-dialog").showModal();
  $("#confirm-delete").focus();
}
async function confirmDelete() {
  if (!state.deleteId) return;
  const button = $("#confirm-delete");
  button.disabled = true;
  try {
    await api(`/api/transactions/${state.deleteId}`, { method: "DELETE" });
    $("#confirm-dialog").close();
    showToast("Transaction deleted.");
    state.deleteId = null;
    await refreshData();
  } catch (error) {
    handleError(error);
  } finally {
    button.disabled = false;
  }
}
async function saveBudget(event) {
  event.preventDefault();
  const form = $("#budget-form");
  clearFieldErrors(form);
  setMessage($("#budget-message"), "");
  const month = $("#budget-month").value;
  const amount = $("#budget-amount").value;
  const errors = {};
  if (!month) errors.month = "Choose a month.";
  if (amount === "" || !Number.isFinite(Number(amount)) || Number(amount) < 0) errors.amount = "Enter a budget of zero or greater.";
  if (Object.keys(errors).length) {
    showFieldErrors(form, errors);
    form.elements.namedItem(Object.keys(errors)[0])?.focus();
    return;
  }
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    await api("/api/budget", { method: "PUT", body: JSON.stringify({ month, amount: Number(amount) }) });
    state.month = month;
    $("#global-month").value = month;
    await refreshData();
    setMessage($("#budget-message"), "Your monthly budget has been saved.", "success");
    showToast("Monthly budget saved.");
  } catch (error) {
    showFieldErrors(form, error.fields);
    setMessage($("#budget-message"), error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save monthly budget";
  }
}
async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch (error) { /* Clear local view even if the network is interrupted. */ }
  state.user = null;
  state.transactions = [];
  state.dashboard = null;
  state.page = "overview";
  $("#auth-form").reset();
  setAuthMode("login");
  showAuthView();
}

function fillFeatureSelects() {
  const expenseOptions = (state.categories.expense || []).map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  ["#category-budget-category", "#recurring-category"].forEach(sel=>{ if($(sel)) $(sel).innerHTML=expenseOptions; });
  if($("#recurring-date") && !$("#recurring-date").value) $("#recurring-date").value=localDate();
}
async function loadCategoryBudgets() {
  fillFeatureSelects();
  const data=await api(`/api/category-budgets?month=${encodeURIComponent(state.month)}`);
  const host=$("#category-budgets-list");
  if(!data.budgets.length){host.innerHTML='<p class="muted-copy">No category limits set for this month.</p>';return;}
  host.innerHTML=data.budgets.map(b=>{const amount=Number(b.amount),spent=Number(b.spent),pct=amount?spent/amount*100:0;return `<article class="feature-row"><div class="feature-row-main"><strong>${escapeHtml(b.category)}</strong><span>${money(spent)} spent of ${money(amount)} · ${Math.round(pct)}%</span><div class="mini-progress"><span style="width:${Math.min(100,pct)}%;${pct>100?'background:var(--red)':''}"></span></div></div><button class="row-action delete" data-delete-category-budget="${Number(b.id)}" type="button">Remove</button></article>`;}).join("");
}
async function loadAnalytics() {
  const [year, monthNumber] = state.month.split('-').map(Number);
  const previousDate = new Date(year, monthNumber - 2, 1);
  const previousMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth()+1).padStart(2,'0')}`;
  const [data, transactionsData, budgetData, previousData]=await Promise.all([
    api(`/api/dashboard?month=${encodeURIComponent(state.month)}`),
    api(`/api/transactions?month=${encodeURIComponent(state.month)}`),
    api(`/api/category-budgets?month=${encodeURIComponent(state.month)}`),
    api(`/api/dashboard?month=${encodeURIComponent(previousMonth)}`)
  ]);
  const transactions=transactionsData.transactions, income=Number(data.summary.income), expenses=Number(data.summary.expenses);
  $("#analytics-income").textContent=money(income); $("#analytics-expenses").textContent=money(expenses); $("#analytics-savings-rate").textContent=`${income>0?Math.round((income-expenses)/income*100):0}%`;
  const categories=data.categories||[];
  $("#analytics-categories").innerHTML=categories.length?categories.map((c,i)=>`<article class="feature-row"><div class="feature-row-main"><strong><span class="legend-swatch" style="background:${COLORS[i%COLORS.length]}"></span> ${escapeHtml(c.category)}</strong><span>${money(c.total)} · ${expenses?Math.round(Number(c.total)/expenses*100):0}% of expenses</span><div class="mini-progress"><span style="width:${expenses?Math.min(100,Number(c.total)/expenses*100):0}%;background:${COLORS[i%COLORS.length]}"></span></div></div></article>`).join(""):'<p class="muted-copy">No expenses in this month yet.</p>';
  const methods=new Map(); transactions.forEach(t=>{if(t.type==='expense'){const k=t.payment_method||'Other';methods.set(k,(methods.get(k)||0)+Number(t.amount));}});
  $("#payment-breakdown").innerHTML=methods.size?[...methods.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<article class="feature-row"><strong>${escapeHtml(k)}</strong><strong>${money(v)}</strong></article>`).join(""):'<p class="muted-copy">Payment method totals will appear after expenses are recorded.</p>';
  const insights=[];
  if(!transactions.length) insights.push(["Start your history","Add income and expenses to unlock personalized insights."]);
  else {
    if(income>0) insights.push([income>=expenses?"Positive cash flow":"Expenses exceed income",income>=expenses?`You kept ${money(income-expenses)} after this month's recorded spending.`:`Recorded expenses are ${money(expenses-income)} higher than income this month.`]);
    const priorExpenses=Number(previousData.summary.expenses), delta=expenses-priorExpenses;
    if(priorExpenses>0 || expenses>0) insights.push([delta>0?"Spending increased vs last month":delta<0?"Spending decreased vs last month":"Spending unchanged vs last month",`${delta===0?'Your expenses match the previous month.':`${money(Math.abs(delta))} ${delta>0?'more':'less'} spent than ${monthLabel(previousMonth)}.`} Previous month: ${money(priorExpenses)}.`]);
    if(categories[0]) insights.push(["Largest spending category",`${categories[0].category} is your highest expense category at ${money(categories[0].total)}.`]);
    const over=budgetData.budgets.filter(b=>Number(b.spent)>=Number(b.amount));
    if(over.length) insights.push(["Category limit reached",`${over.map(b=>b.category).join(", ")} ${over.length===1?"has":"have"} reached or exceeded the set limit.`]);
    if(transactions.length>=10) insights.push(["Good tracking habit",`You've recorded ${transactions.length} transactions this month. Regular tracking makes trends easier to spot.`]);
  }
  $("#insights-list").innerHTML=insights.map(([title,body])=>`<article class="insight-card"><span class="tip-icon">✳</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></div></article>`).join("");
}
async function loadGoals(){const data=await api('/api/goals');const host=$("#goals-list");if(!data.goals.length){host.innerHTML='<p class="muted-copy">No savings goals yet. Create your first goal above.</p>';return;}host.innerHTML=data.goals.map(g=>{const target=Number(g.target_amount),saved=Number(g.saved_amount),pct=Math.min(100,target?saved/target*100:0);return `<article class="goal-card glass-card"><div class="goal-card-top"><span class="summary-icon balance-icon">◇</span><button class="row-action delete" type="button" data-delete-goal="${Number(g.id)}">Delete</button></div><h2>${escapeHtml(g.name)}</h2><p class="goal-amount">${money(saved)} <span>of ${money(target)}</span></p><div class="mini-progress"><span style="width:${pct}%"></span></div><div class="goal-meta"><span>${Math.round(pct)}% saved</span><span>${g.target_date?`Target ${formatDate(g.target_date)}`:'No target date'}</span></div><form class="goal-contribution-form" data-goal-id="${Number(g.id)}"><label for="goal-contribution-${Number(g.id)}">Update saved amount (₹)</label><div class="inline-control"><input id="goal-contribution-${Number(g.id)}" name="saved_amount" type="number" min="0" step="0.01" value="${saved.toFixed(2)}" required><button class="button button-secondary" type="submit">Update</button></div></form></article>`;}).join("");}
async function loadRecurring(){const data=await api('/api/recurring');const host=$("#recurring-list");if(!data.recurring.length){host.innerHTML='<p class="muted-copy">No recurring items yet.</p>';return;}host.innerHTML=data.recurring.map(r=>`<article class="feature-row"><div class="feature-row-main"><strong>${escapeHtml(r.description)} <span class="category-pill">${escapeHtml(r.frequency)}</span></strong><span>${money(r.amount)} · ${escapeHtml(r.category)} · ${escapeHtml(r.payment_method||'Other')}</span><span>Next due ${formatDate(r.next_date)} · ${r.active?'Active':'Paused'}</span></div><div class="feature-actions">${r.active?`<button class="button button-primary button-small" type="button" data-generate-recurring="${Number(r.id)}">Record due item</button>`:''}<button class="button button-secondary button-small" type="button" data-toggle-recurring="${Number(r.id)}" data-active="${Number(r.active)}">${r.active?'Pause':'Resume'}</button><button class="row-action delete" type="button" data-delete-recurring="${Number(r.id)}">Delete</button></div></article>`).join("");}
let calendarMonth=localMonth();
async function loadCalendar(){const data=await api(`/api/transactions?month=${encodeURIComponent(calendarMonth)}`);const [y,m]=calendarMonth.split('-').map(Number);$("#calendar-month-label").textContent=monthLabel(calendarMonth);const first=new Date(y,m-1,1),days=new Date(y,m,0).getDate(),offset=(first.getDay()+6)%7;const byDay=new Map();data.transactions.forEach(t=>{const day=Number(String(t.transaction_date).slice(8,10));if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(t);});const labels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];let html=labels.map(l=>`<div class="calendar-weekday">${l}</div>`).join('');for(let i=0;i<offset;i++)html+='<div class="calendar-cell calendar-blank"></div>';for(let day=1;day<=days;day++){const items=byDay.get(day)||[],total=items.reduce((a,t)=>a+(t.type==='expense'?-1:1)*Number(t.amount),0);html+=`<button class="calendar-cell ${items.length?'has-transactions':''}" type="button" data-calendar-day="${day}"><span class="calendar-day-number">${day}</span>${items.length?`<span class="calendar-count">${items.length} item${items.length===1?'':'s'}</span><span class="calendar-net ${total<0?'negative':'positive'}">${total<0?'−':'+'}${money(Math.abs(total))}</span>`:''}</button>`;}$ ("#calendar-grid").innerHTML=html;renderCalendarDay(null, data.transactions);}
function renderCalendarDay(day, transactions){const host=$("#calendar-day-transactions");if(day===null){host.innerHTML='<p class="muted-copy">Choose a day in the calendar to see its transactions.</p>';$("#calendar-day-title").textContent='Daily transactions';return;}const items=transactions.filter(t=>Number(String(t.transaction_date).slice(8,10))===day);$("#calendar-day-title").textContent=`${day} ${monthLabel(calendarMonth)}`;host.innerHTML=items.length?items.map(t=>`<article class="feature-row"><div class="feature-row-main"><strong>${escapeHtml(t.description)}</strong><span>${escapeHtml(t.category)} · ${escapeHtml(t.payment_method||'Other')}</span></div><strong class="amount-cell ${t.type}">${t.type==='income'?'+':'−'}${money(t.amount)}</strong></article>`).join(''):'<p class="muted-copy">No transactions recorded on this date.</p>';}
async function loadGroups(){const data=await api('/api/groups');const host=$("#groups-list");if(!data.groups.length){host.innerHTML='<p class="muted-copy">No group events yet. Create an event and invite Ledger members.</p>';return;}host.innerHTML=data.groups.map(g=>`<button class="group-list-item ${Number(g.id)===Number(activeGroupId)?'is-selected':''}" type="button" data-open-group="${Number(g.id)}"><span><strong>${escapeHtml(g.name)}</strong><small>${Number(g.member_count)} members · ${money(g.total_expenses)} shared expenses</small></span><span aria-hidden="true">→</span></button>`).join('');if(activeGroupId) await loadGroupDetail(activeGroupId);}
let activeGroupId=null;
function refreshGroupCustomShares() {
  const form = $("#group-expense-form"); if (!form) return;
  const selected = $$('input[name="group-participant"]:checked', form).map(input => ({id:Number(input.value),name:input.closest('label').querySelector('span').textContent}));
  const type = $("#group-expense-split-type", form).value;
  const host = $("#group-custom-shares", form);
  host.classList.toggle('hidden', type !== 'custom');
  if (type === 'custom') host.innerHTML = selected.length ? `<span class="field-label">Amount owed by each selected person (₹)</span>${selected.map(m=>`<div class="custom-share-row"><label for="group-share-${m.id}">${escapeHtml(m.name)}</label><input id="group-share-${m.id}" type="number" min="0" step="0.01" data-custom-share-user="${m.id}" value="0.00" required></div>`).join('')}` : '<p class="field-hint">Select at least one participant first.</p>';
  const hint = $("#group-split-total-hint", form);
  hint.textContent = selected.length ? (type === 'custom' ? 'Enter amounts for each selected participant. Their total must exactly match the expense total.' : `This expense will be split equally between ${selected.length} selected participant${selected.length===1?'':'s'}.`) : 'Select at least one participant.';
}
async function loadGroupDetail(id){activeGroupId=Number(id);const data=await api(`/api/groups/${activeGroupId}`);const g=data.group;const host=$("#group-detail");host.innerHTML=`<div class="group-detail-heading"><div><p class="eyebrow">SHARED EVENT</p><h2>${escapeHtml(g.name)}</h2><p class="panel-subtitle">${escapeHtml(g.description||'Shared costs, clearly settled.')}</p></div><span class="mini-badge">${data.members.length} members</span></div><section class="group-subsection"><h3>Members</h3><div class="member-chips">${data.members.map(m=>`<span class="member-chip"><span class="avatar-mini">${escapeHtml(m.name.slice(0,1).toUpperCase())}</span>${escapeHtml(m.name)}</span>`).join('')}</div><form id="add-group-member-form" class="inline-form compact-form"><div class="field"><label for="add-group-member-email">Add existing Ledger member by email</label><input id="add-group-member-email" type="email" required placeholder="friend@example.com"></div><button class="button button-secondary" type="submit">Add member</button></form></section><section class="group-subsection"><h3>Add shared expense</h3><form id="group-expense-form" class="inline-form compact-form"><div class="field"><label for="group-expense-description">Expense</label><input id="group-expense-description" required maxlength="180" placeholder="e.g. Hotel booking"></div><div class="field"><label for="group-expense-amount">Total amount (₹)</label><input id="group-expense-amount" type="number" min="0.01" step="0.01" required placeholder="12000"></div><div class="field"><label for="group-expense-payer">Paid by</label><select id="group-expense-payer">${data.members.map(m=>`<option value="${Number(m.id)}" ${Number(m.id)===Number(state.user.id)?'selected':''}>${escapeHtml(m.name)}</option>`).join('')}</select></div><div class="field"><label for="group-expense-date">Date</label><input id="group-expense-date" type="date" value="${localDate()}" required></div><fieldset class="field group-participant-field"><legend>Who shares this expense?</legend><div class="participant-checkboxes">${data.members.map(m=>`<label class="participant-checkbox"><input type="checkbox" name="group-participant" value="${Number(m.id)}" checked><span>${escapeHtml(m.name)}</span></label>`).join('')}</div><small class="field-hint">Uncheck anyone who should not be included in this expense.</small></fieldset><div class="field"><label for="group-expense-split-type">Split method</label><select id="group-expense-split-type"><option value="equal">Split equally between selected people</option><option value="custom">Enter each person's amount manually</option></select></div><div id="group-custom-shares" class="field group-custom-shares hidden"></div><p id="group-split-total-hint" class="field-hint group-split-total-hint">Choose the participants. The total will be split equally among them.</p><button class="button button-primary" type="submit">Add expense</button></form></section><section class="group-subsection"><h3>Shared expenses</h3><div class="feature-list">${data.expenses.length?data.expenses.map(e=>`<article class="feature-row"><div class="feature-row-main"><strong>${escapeHtml(e.description)}</strong><span>Paid by ${escapeHtml(e.payer_name)} · ${formatDate(e.expense_date)}</span><span>Split between ${(e.shares||[]).map(sh=>`${escapeHtml(sh.name)} (${money(sh.share_amount)})`).join(', ')}</span></div><strong>${money(e.amount)}</strong></article>`).join(''):'<p class="muted-copy">No shared expenses recorded yet.</p>'}</div></section><section class="group-subsection"><h3>Member balances</h3><div class="feature-list">${data.balances.map(b=>`<article class="feature-row"><strong>${escapeHtml(b.name)}</strong><strong class="${b.net>0.005?'positive-text':b.net< -0.005?'negative-text':''}">${Math.abs(Number(b.net))<0.005?'Settled':b.net>0?`Gets back ${money(b.net)}`:`Owes ${money(-b.net)}`}</strong></article>`).join('')}</div></section><section class="group-subsection"><h3>Final reimbursement transactions</h3><p class="panel-subtitle">Ledger minimizes the number of transfers needed to settle the event.</p><div class="feature-list">${data.settlements.length?data.settlements.map(t=>`<article class="settlement-row"><div><strong>${escapeHtml(t.from_name)}</strong><span> pays </span><strong>${escapeHtml(t.to_name)}</strong><p>${money(t.amount)}</p></div><button class="button button-secondary button-small" type="button" data-settle-from="${Number(t.from_user_id)}" data-settle-to="${Number(t.to_user_id)}" data-settle-amount="${Number(t.amount)}">Mark as reimbursed</button></article>`).join(''):'<p class="success-copy">All balances are settled. No reimbursement is currently required.</p>'}</div></section><section class="group-subsection"><h3>Completed reimbursements</h3><div id="group-settlement-history" class="feature-list"><p class="muted-copy">Loading reimbursement history…</p></div></section>`;
  refreshGroupCustomShares();
  const history=await api(`/api/groups/${activeGroupId}/settlements/history`);$("#group-settlement-history").innerHTML=history.settlements.length?history.settlements.map(t=>`<article class="feature-row"><div class="feature-row-main"><strong>${escapeHtml(t.from_name)} → ${escapeHtml(t.to_name)}</strong><span>Completed ${formatDate(t.settled_at)}</span></div><strong>${money(t.amount)}</strong></article>`).join(''):'<p class="muted-copy">No completed reimbursements yet.</p>';
  await loadGroupsListOnly();
}
async function loadGroupsListOnly(){const data=await api('/api/groups');const host=$("#groups-list");host.innerHTML=data.groups.length?data.groups.map(g=>`<button class="group-list-item ${Number(g.id)===Number(activeGroupId)?'is-selected':''}" type="button" data-open-group="${Number(g.id)}"><span><strong>${escapeHtml(g.name)}</strong><small>${Number(g.member_count)} members · ${money(g.total_expenses)} shared expenses</small></span><span aria-hidden="true">→</span></button>`).join(''):'<p class="muted-copy">No group events yet.</p>';}
function loadSettings(){if(!state.user)return;$("#profile-name").value=state.user.name;$("#profile-email").value=state.user.email;const light=document.body.classList.contains('light-theme');$("#theme-toggle").textContent=light?'Enable dark theme':'Enable light theme';}
async function exportCsv(buttonId='export-button'){const response=await fetch('/api/export.csv',{credentials:'same-origin'});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Could not export transactions.');}const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ledger-transactions.csv';document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);showToast('CSV export downloaded.');}

async function initialize() {
  $("#global-month").value = state.month;
  $("#budget-month").value = state.month;
  try {
    state.categories = await api("/api/categories");
    fillFeatureSelects();
    if (localStorage.getItem('ledger-theme') === 'light') document.body.classList.add('light-theme');
    const session = await api("/api/auth/me");
    if (session.user) {
      state.user = session.user;
      showAppView();
    } else {
      showAuthView();
    }
  } catch (error) {
    showAuthView();
    setMessage($("#auth-message"), `${error.message} Check that the server and MySQL are running.`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $$("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  $("#auth-form").addEventListener("submit", submitAuth);
  $("#logout-button").addEventListener("click", logout);
  $("#mobile-menu-button").addEventListener("click", () => {
    const sidebar = $("#sidebar");
    const isOpen = sidebar.classList.toggle("is-open");
    $("#mobile-menu-button").setAttribute("aria-expanded", String(isOpen));
    $("#mobile-menu-button").setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });
  $$("[data-page]").forEach(link => link.addEventListener("click", event => {
    event.preventDefault();
    navigate(link.dataset.page);
  }));
  window.addEventListener("popstate", () => navigate(location.hash.slice(1) || "overview", false));
  $("#global-month").addEventListener("change", async event => {
    if (!event.target.value) return;
    state.month = event.target.value;
    $("#budget-month").value = state.month;
    try { await refreshData(); if(state.page==='budget') await loadCategoryBudgets(); if(state.page==='analytics') await loadAnalytics(); } catch (error) { handleError(error); }
  });
  ["#overview-add-button"].forEach(selector => $(selector).addEventListener("click", () => openTransactionDialog()));
  $$("[data-open-transaction]").forEach(button => button.addEventListener("click", () => openTransactionDialog()));
  $("#close-transaction-dialog").addEventListener("click", closeTransactionDialog);
  $("#cancel-transaction").addEventListener("click", closeTransactionDialog);
  $("#transaction-form").addEventListener("submit", submitTransaction);
  $$('input[name="type"]').forEach(radio => radio.addEventListener("change", () => renderCategoryOptions(radio.value)));
  $("#transaction-dialog").addEventListener("click", event => {
    if (event.target === $("#transaction-dialog")) closeTransactionDialog();
  });
  $("#transactions-table-body").addEventListener("click", event => {
    const editButton = event.target.closest("[data-edit-id]");
    const deleteButton = event.target.closest("[data-delete-id]");
    if (editButton) {
      const transaction = state.transactions.find(item => Number(item.id) === Number(editButton.dataset.editId));
      if (transaction) openTransactionDialog(transaction);
    }
    if (deleteButton) openDeleteDialog(deleteButton.dataset.deleteId);
  });
  $("#cancel-delete").addEventListener("click", () => $("#confirm-dialog").close());
  $("#confirm-delete").addEventListener("click", confirmDelete);
  $("#budget-form").addEventListener("submit", saveBudget);
  $("#transaction-search").addEventListener("input", debounce(() => loadTransactions().catch(handleError), 250));
  $("#transaction-type-filter").addEventListener("change", () => loadTransactions().catch(handleError));
  ["#transaction-start-date", "#transaction-end-date", "#transaction-sort"].forEach(selector => $(selector).addEventListener("change", () => loadTransactions().catch(handleError)));
  $("#clear-filters").addEventListener("click", () => {
    $("#transaction-search").value = "";
    $("#transaction-type-filter").value = "";
    $("#transaction-start-date").value = "";
    $("#transaction-end-date").value = "";
    $("#transaction-sort").value = "newest";
    loadTransactions().catch(handleError);
  });
  $("#export-button").addEventListener("click", () => exportCsv().catch(handleError));
  $("#report-export-button").addEventListener("click", () => exportCsv().catch(handleError));
  $("#report-print-button").addEventListener("click", () => window.print());
  $("#settings-export-button").addEventListener("click", () => exportCsv().catch(handleError));
  $("#category-budget-form").addEventListener("submit", async event=>{event.preventDefault();try{await api('/api/category-budgets',{method:'PUT',body:JSON.stringify({month:state.month,category:$("#category-budget-category").value,amount:Number($("#category-budget-amount").value)})});$("#category-budget-amount").value='';await loadCategoryBudgets();showToast('Category budget saved.');}catch(e){handleError(e);}});
  $("#category-budgets-list").addEventListener('click',async event=>{const b=event.target.closest('[data-delete-category-budget]');if(!b)return;try{await api(`/api/category-budgets/${b.dataset.deleteCategoryBudget}`,{method:'DELETE'});await loadCategoryBudgets();showToast('Category budget removed.');}catch(e){handleError(e);}});
  $("#goal-form").addEventListener('submit',async event=>{event.preventDefault();try{await api('/api/goals',{method:'POST',body:JSON.stringify({name:$("#goal-name").value.trim(),target_amount:Number($("#goal-target").value),saved_amount:Number($("#goal-saved").value||0),target_date:$("#goal-date").value||null})});event.target.reset();$("#goal-saved").value='0';await loadGoals();showToast('Savings goal created.');}catch(e){handleError(e);}});
  $("#goals-list").addEventListener('submit',async event=>{if(!event.target.matches('.goal-contribution-form'))return;event.preventDefault();try{await api(`/api/goals/${event.target.dataset.goalId}`,{method:'PUT',body:JSON.stringify({saved_amount:Number(event.target.elements.saved_amount.value)})});await loadGoals();showToast('Savings progress updated.');}catch(e){handleError(e);}});
  $("#goals-list").addEventListener('click',async event=>{const b=event.target.closest('[data-delete-goal]');if(!b)return;if(!confirm('Delete this savings goal?'))return;try{await api(`/api/goals/${b.dataset.deleteGoal}`,{method:'DELETE'});await loadGoals();showToast('Savings goal deleted.');}catch(e){handleError(e);}});
  $("#recurring-form").addEventListener('submit',async event=>{event.preventDefault();try{await api('/api/recurring',{method:'POST',body:JSON.stringify({type:$("#recurring-type").value,description:$("#recurring-description").value.trim(),amount:Number($("#recurring-amount").value),category:$("#recurring-category").value,payment_method:$("#recurring-payment").value,frequency:$("#recurring-frequency").value,next_date:$("#recurring-date").value})});event.target.reset();$("#recurring-date").value=localDate();fillFeatureSelects();await loadRecurring();showToast('Recurring transaction saved.');}catch(e){handleError(e);}});
  $("#recurring-type").addEventListener('change',()=>{const categories=state.categories[$("#recurring-type").value]||[];$("#recurring-category").innerHTML=categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');});
  $("#recurring-list").addEventListener('click',async event=>{const gen=event.target.closest('[data-generate-recurring]'),toggle=event.target.closest('[data-toggle-recurring]'),del=event.target.closest('[data-delete-recurring]');try{if(gen){await api(`/api/recurring/${gen.dataset.generateRecurring}/generate`,{method:'POST'});await Promise.all([loadRecurring(),refreshData()]);showToast('Recurring item recorded as a transaction.');}else if(toggle){await api(`/api/recurring/${toggle.dataset.toggleRecurring}`,{method:'PATCH',body:JSON.stringify({active:toggle.dataset.active!=='1'})});await loadRecurring();}else if(del){if(!confirm('Delete this recurring item?'))return;await api(`/api/recurring/${del.dataset.deleteRecurring}`,{method:'DELETE'});await loadRecurring();showToast('Recurring item deleted.');}}catch(e){handleError(e);}});
  $("#calendar-prev").addEventListener('click',()=>{const [y,m]=calendarMonth.split('-').map(Number),d=new Date(y,m-2,1);calendarMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;loadCalendar().catch(handleError);});
  $("#calendar-next").addEventListener('click',()=>{const [y,m]=calendarMonth.split('-').map(Number),d=new Date(y,m,1);calendarMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;loadCalendar().catch(handleError);});
  $("#calendar-grid").addEventListener('click',async event=>{const b=event.target.closest('[data-calendar-day]');if(!b)return;try{const data=await api(`/api/transactions?month=${encodeURIComponent(calendarMonth)}`);renderCalendarDay(Number(b.dataset.calendarDay),data.transactions);}catch(e){handleError(e);}});
  $("#group-form").addEventListener('submit',async event=>{event.preventDefault();const emails=$("#group-emails").value.split(',').map(e=>e.trim()).filter(Boolean);try{const result=await api('/api/groups',{method:'POST',body:JSON.stringify({name:$("#group-name").value.trim(),description:$("#group-description").value.trim(),emails})});event.target.reset();await loadGroups();await loadGroupDetail(result.id);showToast('Event created.');}catch(e){handleError(e);}});
  $("#groups-list").addEventListener('click',event=>{const b=event.target.closest('[data-open-group]');if(b)loadGroupDetail(b.dataset.openGroup).catch(handleError);});
  $("#group-detail").addEventListener('submit',async event=>{event.preventDefault();try{if(event.target.id==='add-group-member-form'){await api(`/api/groups/${activeGroupId}/members`,{method:'POST',body:JSON.stringify({email:$("#add-group-member-email").value.trim()})});await loadGroupDetail(activeGroupId);showToast('Member added to event.');}else if(event.target.id==='group-expense-form'){const form=event.target;const participantIds=$$('input[name="group-participant"]:checked',form).map(input=>Number(input.value));const splitType=$("#group-expense-split-type",form).value;const shares={};if(splitType==='custom')$$('[data-custom-share-user]',form).forEach(input=>{shares[input.dataset.customShareUser]=Number(input.value);});await api(`/api/groups/${activeGroupId}/expenses`,{method:'POST',body:JSON.stringify({description:$("#group-expense-description").value.trim(),amount:Number($("#group-expense-amount").value),paid_by:Number($("#group-expense-payer").value),expense_date:$("#group-expense-date").value,participant_ids:participantIds,split_type:splitType,shares})});await loadGroupDetail(activeGroupId);showToast('Shared expense added.');}}catch(e){handleError(e);}});
  $("#group-detail").addEventListener('change',event=>{if(event.target.matches('#group-expense-split-type, input[name="group-participant"]'))refreshGroupCustomShares();});
  $("#group-detail").addEventListener('input',event=>{if(event.target.matches('#group-expense-amount')){const hint=$("#group-split-total-hint");if(hint&&$("#group-expense-split-type")?.value==='custom')hint.textContent='Individual amounts must add up to '+money(event.target.value)+'.';}});
  $("#group-detail").addEventListener('click',async event=>{const b=event.target.closest('[data-settle-from]');if(!b)return;if(!confirm(`Mark ${money(b.dataset.settleAmount)} reimbursement as completed?`))return;try{await api(`/api/groups/${activeGroupId}/settlements`,{method:'POST',body:JSON.stringify({from_user_id:Number(b.dataset.settleFrom),to_user_id:Number(b.dataset.settleTo),amount:Number(b.dataset.settleAmount)})});await loadGroupDetail(activeGroupId);showToast('Reimbursement recorded.');}catch(e){handleError(e);}});
  $("#profile-form").addEventListener('submit',async event=>{event.preventDefault();try{const data=await api('/api/settings/profile',{method:'PUT',body:JSON.stringify({name:$("#profile-name").value.trim()})});state.user=data.user;showAppView();setMessage($("#profile-message"),'Profile updated.','success');showToast('Profile updated.');}catch(e){setMessage($("#profile-message"),e.message);}});
  $("#theme-toggle").addEventListener('click',()=>{document.body.classList.toggle('light-theme');localStorage.setItem('ledger-theme',document.body.classList.contains('light-theme')?'light':'dark');loadSettings();});
  initialize();
});

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay);
  };
}
