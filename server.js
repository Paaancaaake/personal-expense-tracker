require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const MySQLStoreFactory = require("express-mysql-session");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "expense_tracker",
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  dateStrings: true
});

const sessionStore = new (MySQLStoreFactory(session))({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "expense_tracker",
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 900000
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "expense.sid",
  secret: process.env.SESSION_SECRET || "development-secret-change-me",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(express.static(path.join(__dirname, "public")));

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in to continue." });
  next();
}
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}
function validateTransaction(body) {
  const errors = {};
  const type = body.type;
  const amount = Number(body.amount);
  const category = String(body.category || "").trim();
  const description = String(body.description || "").trim();
  const date = String(body.transaction_date || "");
  if (!["income", "expense"].includes(type)) errors.type = "Choose income or expense.";
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999) errors.amount = "Enter an amount greater than zero.";
  if (!category || category.length > 60) errors.category = "Choose a category (maximum 60 characters).";
  if (!description || description.length > 180) errors.description = "Enter a description (maximum 180 characters).";
  if (!validDate(date)) errors.transaction_date = "Choose a valid date.";
  return { errors, value: { type, amount, category, description, transaction_date: date } };
}
function validMonth(month) {
  return typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}
const categories = {
  expense: ["Food & dining", "Transport", "Shopping", "Bills & utilities", "Health", "Education", "Entertainment", "Home", "Travel", "Other"],
  income: ["Salary", "Freelance", "Allowance", "Investment", "Gift", "Other"]
};

app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", database: "connected" });
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const errors = {};
  if (name.length < 2 || name.length > 100) errors.name = "Name must be between 2 and 100 characters.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) errors.email = "Enter a valid email address.";
  if (password.length < 8 || password.length > 72) errors.password = "Password must be 8–72 characters.";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });

  const [existing] = await pool.execute("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length) return res.status(409).json({ error: "An account with this email already exists.", fields: { email: "This email is already registered." } });

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.execute("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)", [name, email, passwordHash]);
  req.session.userId = result.insertId;
  req.session.userName = name;
  res.status(201).json({ user: { id: result.insertId, name, email } });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const [rows] = await pool.execute("SELECT id, name, email, password_hash FROM users WHERE email = ?", [email]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Could not start a session. Please try again." });
    req.session.userId = rows[0].id;
    req.session.userName = rows[0].name;
    res.json({ user: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
  });
}));

app.get("/api/auth/me", asyncRoute(async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const [rows] = await pool.execute("SELECT id, name, email FROM users WHERE id = ?", [req.session.userId]);
  if (!rows.length) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  res.json({ user: rows[0] });
}));

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Could not sign out. Please try again." });
    res.clearCookie("expense.sid", { httpOnly: true, sameSite: "lax" });
    res.json({ success: true });
  });
});

app.get("/api/categories", (_req, res) => res.json(categories));

app.get("/api/dashboard", requireAuth, asyncRoute(async (req, res) => {
  const month = validMonth(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const [summaryRows] = await pool.execute(
    `SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expenses,
      COUNT(*) AS transaction_count
     FROM transactions WHERE user_id=? AND DATE_FORMAT(transaction_date, '%Y-%m')=?`,
    [req.session.userId, month]
  );
  const summary = summaryRows[0];
  summary.balance = Number(summary.income) - Number(summary.expenses);
  const [budgetRows] = await pool.execute("SELECT amount FROM monthly_budgets WHERE user_id=? AND month_key=?", [req.session.userId, month]);
  summary.budget = budgetRows.length ? Number(budgetRows[0].amount) : 0;
  summary.budget_remaining = summary.budget - Number(summary.expenses);

  const [categoryRows] = await pool.execute(
    `SELECT category, SUM(amount) AS total FROM transactions
     WHERE user_id=? AND type='expense' AND DATE_FORMAT(transaction_date, '%Y-%m')=?
     GROUP BY category ORDER BY total DESC`,
    [req.session.userId, month]
  );
  const [recentRows] = await pool.execute(
    `SELECT id, type, amount, category, description, transaction_date
     FROM transactions WHERE user_id=? ORDER BY transaction_date DESC, id DESC LIMIT 5`,
    [req.session.userId]
  );
  const [trendRows] = await pool.execute(
    `SELECT DATE_FORMAT(transaction_date, '%Y-%m') AS month,
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expenses
     FROM transactions
     WHERE user_id=? AND transaction_date >= DATE_SUB(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'), INTERVAL 5 MONTH)
       AND transaction_date < DATE_ADD(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH)
     GROUP BY DATE_FORMAT(transaction_date, '%Y-%m') ORDER BY month`,
    [req.session.userId, month, month]
  );
  res.json({ month, summary, categories: categoryRows, recent: recentRows, trend: trendRows });
}));

app.get("/api/transactions", requireAuth, asyncRoute(async (req, res) => {
  const where = ["user_id=?"];
  const values = [req.session.userId];
  const month = String(req.query.month || "");
  const type = String(req.query.type || "");
  const search = String(req.query.search || "").trim().slice(0, 100);
  if (validMonth(month)) { where.push("DATE_FORMAT(transaction_date, '%Y-%m')=?"); values.push(month); }
  if (["income", "expense"].includes(type)) { where.push("type=?"); values.push(type); }
  if (search) { where.push("(description LIKE ? OR category LIKE ?)"); values.push(`%${search}%`, `%${search}%`); }
  if (req.query.startDate && validDate(String(req.query.startDate))) { where.push("transaction_date>=?"); values.push(req.query.startDate); }
  if (req.query.endDate && validDate(String(req.query.endDate))) { where.push("transaction_date<=?"); values.push(req.query.endDate); }
  const sortOrders = { newest: "transaction_date DESC, id DESC", oldest: "transaction_date ASC, id ASC", highest: "amount DESC, transaction_date DESC", lowest: "amount ASC, transaction_date DESC" };
  const orderBy = sortOrders[String(req.query.sort || "newest")] || sortOrders.newest;
  const [rows] = await pool.execute(
    `SELECT id, type, amount, category, description, transaction_date, created_at, payment_method
     FROM transactions WHERE ${where.join(" AND ")}
     ORDER BY ${orderBy} LIMIT 1000`,
    values
  );
  res.json({ transactions: rows });
}));

app.post("/api/transactions", requireAuth, asyncRoute(async (req, res) => {
  const { errors, value } = validateTransaction(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });
  const paymentMethod = String(req.body.payment_method || "Other").slice(0, 40);
  const [result] = await pool.execute(
    "INSERT INTO transactions (user_id, type, amount, category, description, transaction_date, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.session.userId, value.type, value.amount, value.category, value.description, value.transaction_date, paymentMethod]
  );
  const [rows] = await pool.execute("SELECT id, type, amount, category, description, transaction_date, payment_method FROM transactions WHERE id=? AND user_id=?", [result.insertId, req.session.userId]);
  res.status(201).json({ transaction: rows[0] });
}));

app.put("/api/transactions/:id", requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid transaction ID." });
  const { errors, value } = validateTransaction(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });
  const [result] = await pool.execute(
    "UPDATE transactions SET type=?, amount=?, category=?, description=?, transaction_date=?, payment_method=? WHERE id=? AND user_id=?",
    [value.type, value.amount, value.category, value.description, value.transaction_date, String(req.body.payment_method || "Other").slice(0, 40), id, req.session.userId]
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Transaction not found." });
  const [rows] = await pool.execute("SELECT id, type, amount, category, description, transaction_date, payment_method FROM transactions WHERE id=? AND user_id=?", [id, req.session.userId]);
  res.json({ transaction: rows[0] });
}));

app.delete("/api/transactions/:id", requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid transaction ID." });
  const [result] = await pool.execute("DELETE FROM transactions WHERE id=? AND user_id=?", [id, req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ error: "Transaction not found." });
  res.json({ success: true });
}));

app.put("/api/budget", requireAuth, asyncRoute(async (req, res) => {
  const month = String(req.body.month || "");
  const amount = Number(req.body.amount);
  if (!validMonth(month)) return res.status(400).json({ error: "Choose a valid month.", fields: { month: "Choose a valid month." } });
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999999) return res.status(400).json({ error: "Enter a valid budget amount.", fields: { amount: "Budget must be zero or greater." } });
  await pool.execute(
    `INSERT INTO monthly_budgets (user_id, month_key, amount) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE amount=VALUES(amount)`,
    [req.session.userId, month, amount]
  );
  res.json({ month, amount });
}));

app.get("/api/export.csv", requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT transaction_date, type, category, description, amount, payment_method FROM transactions WHERE user_id=? ORDER BY transaction_date DESC, id DESC",
    [req.session.userId]
  );
  const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [["Date", "Type", "Category", "Description", "Amount", "Payment method"], ...rows.map(r => [r.transaction_date, r.type, r.category, r.description, r.amount, r.payment_method])]
    .map(row => row.map(escapeCsv).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="expense-transactions.csv"');
  res.send("\uFEFF" + lines.join("\r\n"));
}));


// --- Category budgets ---
app.get("/api/category-budgets", requireAuth, asyncRoute(async (req, res) => {
  const month = validMonth(String(req.query.month || "")) ? req.query.month : new Date().toISOString().slice(0, 7);
  const [rows] = await pool.execute(`SELECT cb.id, cb.month_key, cb.category, cb.amount,
    COALESCE(SUM(t.amount),0) AS spent FROM category_budgets cb
    LEFT JOIN transactions t ON t.user_id=cb.user_id AND t.category=cb.category AND t.type='expense'
      AND DATE_FORMAT(t.transaction_date,'%Y-%m')=cb.month_key
    WHERE cb.user_id=? AND cb.month_key=? GROUP BY cb.id ORDER BY cb.category`, [req.session.userId, month]);
  res.json({ month, budgets: rows });
}));
app.put("/api/category-budgets", requireAuth, asyncRoute(async (req, res) => {
  const month = String(req.body.month || ""), category = String(req.body.category || "").trim(), amount = Number(req.body.amount);
  if (!validMonth(month) || !category || category.length > 60 || !Number.isFinite(amount) || amount <= 0 || amount > 999999999)
    return res.status(400).json({ error: "Enter a month, category and budget greater than zero." });
  await pool.execute(`INSERT INTO category_budgets(user_id,month_key,category,amount) VALUES(?,?,?,?)
    ON DUPLICATE KEY UPDATE amount=VALUES(amount)`, [req.session.userId, month, category, amount]);
  res.json({ success: true });
}));
app.delete("/api/category-budgets/:id", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM category_budgets WHERE id=? AND user_id=?", [Number(req.params.id), req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ error: "Category budget not found." });
  res.json({ success: true });
}));

// --- Savings goals ---
app.get("/api/goals", requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute("SELECT id,name,target_amount,saved_amount,target_date,created_at FROM savings_goals WHERE user_id=? ORDER BY created_at DESC", [req.session.userId]);
  res.json({ goals: rows });
}));
app.post("/api/goals", requireAuth, asyncRoute(async (req, res) => {
  const name = String(req.body.name || "").trim(), target = Number(req.body.target_amount), saved = Number(req.body.saved_amount || 0), date = req.body.target_date || null;
  if (name.length < 2 || name.length > 100 || !Number.isFinite(target) || target <= 0 || !Number.isFinite(saved) || saved < 0 || saved > target || (date && !validDate(date)))
    return res.status(400).json({ error: "Enter a goal name, a positive target, a valid saved amount, and optional target date." });
  const [result] = await pool.execute("INSERT INTO savings_goals(user_id,name,target_amount,saved_amount,target_date) VALUES(?,?,?,?,?)", [req.session.userId, name, target, saved, date]);
  res.status(201).json({ id: result.insertId });
}));
app.put("/api/goals/:id", requireAuth, asyncRoute(async (req, res) => {
  const saved = Number(req.body.saved_amount);
  if (!Number.isFinite(saved) || saved < 0) return res.status(400).json({ error: "Saved amount must be zero or more." });
  const [result] = await pool.execute("UPDATE savings_goals SET saved_amount=LEAST(target_amount,?) WHERE id=? AND user_id=?", [saved, Number(req.params.id), req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ error: "Savings goal not found." });
  res.json({ success: true });
}));
app.delete("/api/goals/:id", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM savings_goals WHERE id=? AND user_id=?", [Number(req.params.id), req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ error: "Savings goal not found." });
  res.json({ success: true });
}));

// --- Recurring transactions ---
app.get("/api/recurring", requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute("SELECT id,type,amount,category,description,payment_method,frequency,next_date,active FROM recurring_transactions WHERE user_id=? ORDER BY active DESC,next_date", [req.session.userId]);
  res.json({ recurring: rows });
}));
app.post("/api/recurring", requireAuth, asyncRoute(async (req, res) => {
  const type = req.body.type === "income" ? "income" : "expense", amount = Number(req.body.amount), category = String(req.body.category || "").trim(), description = String(req.body.description || "").trim(), frequency = String(req.body.frequency || "monthly"), nextDate = String(req.body.next_date || "");
  if (!Number.isFinite(amount) || amount <= 0 || !category || !description || description.length > 180 || !["weekly","monthly","yearly"].includes(frequency) || !validDate(nextDate)) return res.status(400).json({ error: "Complete all recurring transaction fields with valid values." });
  const [result] = await pool.execute("INSERT INTO recurring_transactions(user_id,type,amount,category,description,payment_method,frequency,next_date) VALUES(?,?,?,?,?,?,?,?)", [req.session.userId,type,amount,category,description,String(req.body.payment_method||"Other"),frequency,nextDate]);
  res.status(201).json({ id: result.insertId });
}));
app.post("/api/recurring/:id/generate", requireAuth, asyncRoute(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT * FROM recurring_transactions WHERE id=? AND user_id=? AND active=1 FOR UPDATE", [Number(req.params.id), req.session.userId]);
    if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: "Active recurring item not found." }); }
    const item = rows[0], today = localToday();
    if (String(item.next_date).slice(0,10) > today) { await connection.rollback(); return res.status(400).json({ error: `This item is next due on ${String(item.next_date).slice(0,10)}.` }); }
    await connection.execute("INSERT INTO transactions(user_id,type,amount,category,description,transaction_date,payment_method) VALUES(?,?,?,?,?,?,?)", [req.session.userId,item.type,item.amount,item.category,item.description,today,item.payment_method]);
    const next = new Date(`${String(item.next_date).slice(0,10)}T12:00:00`);
    if (item.frequency === "weekly") next.setDate(next.getDate()+7); else if (item.frequency === "yearly") next.setFullYear(next.getFullYear()+1); else next.setMonth(next.getMonth()+1);
    const nextDate = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-${String(next.getDate()).padStart(2,"0")}`;
    await connection.execute("UPDATE recurring_transactions SET next_date=? WHERE id=?", [nextDate,item.id]);
    await connection.commit(); res.json({ success: true, next_date: nextDate });
  } catch (e) { await connection.rollback(); throw e; } finally { connection.release(); }
}));
app.patch("/api/recurring/:id", requireAuth, asyncRoute(async (req, res) => {
  const active = req.body.active ? 1 : 0;
  const [result] = await pool.execute("UPDATE recurring_transactions SET active=? WHERE id=? AND user_id=?", [active,Number(req.params.id),req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ error: "Recurring item not found." }); res.json({ success: true });
}));
app.delete("/api/recurring/:id", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM recurring_transactions WHERE id=? AND user_id=?", [Number(req.params.id),req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ error: "Recurring item not found." }); res.json({ success: true });
}));

function localToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
async function getGroupMembership(groupId, userId) {
  const [rows] = await pool.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?", [groupId,userId]); return rows.length > 0;
}
async function calculateGroupSettlements(groupId) {
  const [members] = await pool.execute("SELECT u.id,u.name,u.email FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=? ORDER BY u.name", [groupId]);
  const [expenses] = await pool.execute("SELECT ge.id,ge.description,ge.amount,ge.expense_date,ge.paid_by,u.name AS payer_name FROM group_expenses ge JOIN users u ON u.id=ge.paid_by WHERE ge.group_id=? ORDER BY ge.expense_date,ge.id", [groupId]);
  const [expenseShareRows] = await pool.execute(`SELECT ges.expense_id,ges.user_id,ges.share_amount,u.name FROM group_expense_shares ges JOIN users u ON u.id=ges.user_id JOIN group_expenses ge ON ge.id=ges.expense_id WHERE ge.group_id=? ORDER BY u.name`, [groupId]);
  const sharesByExpense = new Map();
  for (const share of expenseShareRows) { if (!sharesByExpense.has(String(share.expense_id))) sharesByExpense.set(String(share.expense_id), []); sharesByExpense.get(String(share.expense_id)).push({user_id:share.user_id,name:share.name,share_amount:Number(share.share_amount)}); }
  for (const expense of expenses) expense.shares = sharesByExpense.get(String(expense.id)) || [];
  const balances = new Map(members.map(m => [String(m.id), 0]));
  const [paidRows] = await pool.execute("SELECT paid_by,SUM(amount) AS total FROM group_expenses WHERE group_id=? GROUP BY paid_by", [groupId]);
  const [shareRows] = await pool.execute(`SELECT ges.user_id,SUM(ges.share_amount) AS total FROM group_expense_shares ges
    JOIN group_expenses ge ON ge.id=ges.expense_id WHERE ge.group_id=? GROUP BY ges.user_id`, [groupId]);
  for (const row of paidRows) balances.set(String(row.paid_by), (balances.get(String(row.paid_by)) || 0) + Math.round(Number(row.total) * 100));
  for (const row of shareRows) balances.set(String(row.user_id), (balances.get(String(row.user_id)) || 0) - Math.round(Number(row.total) * 100));
  const [paidSettlements] = await pool.execute("SELECT from_user_id,to_user_id,amount FROM group_settlements WHERE group_id=? AND settled=1", [groupId]);
  for (const payment of paidSettlements) {
    const cents = Math.round(Number(payment.amount) * 100);
    balances.set(String(payment.from_user_id), (balances.get(String(payment.from_user_id)) || 0) + cents);
    balances.set(String(payment.to_user_id), (balances.get(String(payment.to_user_id)) || 0) - cents);
  }
  const creditors = members.map(m=>({user_id:m.id,name:m.name,amount:balances.get(String(m.id))||0})).filter(x=>x.amount>0).sort((a,b)=>b.amount-a.amount);
  const debtors = members.map(m=>({user_id:m.id,name:m.name,amount:balances.get(String(m.id))||0})).filter(x=>x.amount<0).map(x=>({...x,amount:-x.amount})).sort((a,b)=>b.amount-a.amount);
  const settlements=[]; let i=0,j=0;
  while(i<debtors.length && j<creditors.length){ const cents=Math.min(debtors[i].amount,creditors[j].amount); if(cents>0) settlements.push({from_user_id:debtors[i].user_id,from_name:debtors[i].name,to_user_id:creditors[j].user_id,to_name:creditors[j].name,amount:cents/100}); debtors[i].amount-=cents; creditors[j].amount-=cents; if(debtors[i].amount===0)i++; if(creditors[j].amount===0)j++; }
  return { members, expenses, settlements, balances: members.map(m=>({user_id:m.id,name:m.name,net:(balances.get(String(m.id))||0)/100})) };
}
app.get("/api/groups", requireAuth, asyncRoute(async (req,res)=>{
  const [rows]=await pool.execute(`SELECT eg.id,eg.name,eg.description,eg.created_at,COUNT(gm.user_id) AS member_count,
    COALESCE((SELECT SUM(amount) FROM group_expenses WHERE group_id=eg.id),0) AS total_expenses
    FROM expense_groups eg JOIN group_members mine ON mine.group_id=eg.id AND mine.user_id=?
    JOIN group_members gm ON gm.group_id=eg.id GROUP BY eg.id ORDER BY eg.created_at DESC`,[req.session.userId]);
  res.json({groups:rows});
}));
app.post("/api/groups", requireAuth, asyncRoute(async (req,res)=>{
  const name=String(req.body.name||"").trim(), description=String(req.body.description||"").trim().slice(0,255);
  const emails=[...new Set((Array.isArray(req.body.emails)?req.body.emails:[]).map(e=>String(e).trim().toLowerCase()).filter(Boolean))];
  if(name.length<2||name.length>120) return res.status(400).json({error:"Event name must be between 2 and 120 characters."});
  if(emails.length>30) return res.status(400).json({error:"Add no more than 30 participants at once."});
  const [users]=emails.length?await pool.query(`SELECT id,email FROM users WHERE email IN (${emails.map(()=>"?").join(",")})`,emails):[[]];
  const found=new Set(users.map(u=>u.email)); const missing=emails.filter(e=>!found.has(e));
  if(missing.length) return res.status(400).json({error:`These emails do not have Ledger accounts yet: ${missing.join(", ")}. Ask them to register first.`});
  const connection=await pool.getConnection(); try { await connection.beginTransaction();
    const [g]=await connection.execute("INSERT INTO expense_groups(name,description,created_by) VALUES(?,?,?)",[name,description||null,req.session.userId]);
    const ids=new Set([String(req.session.userId),...users.map(u=>String(u.id))]);
    for(const id of ids) await connection.execute("INSERT INTO group_members(group_id,user_id) VALUES(?,?)",[g.insertId,id]);
    await connection.commit(); res.status(201).json({id:g.insertId});
  } catch(e){await connection.rollback();throw e;} finally{connection.release();}
}));
app.get("/api/groups/:id", requireAuth, asyncRoute(async (req,res)=>{
  const id=Number(req.params.id); if(!await getGroupMembership(id,req.session.userId)) return res.status(404).json({error:"Event not found or you are not a member."});
  const [groupRows]=await pool.execute("SELECT id,name,description,created_at FROM expense_groups WHERE id=?",[id]);
  const data=await calculateGroupSettlements(id); res.json({group:groupRows[0],...data});
}));
app.post("/api/groups/:id/expenses", requireAuth, asyncRoute(async (req,res)=>{
  const groupId=Number(req.params.id), payer=Number(req.body.paid_by||req.session.userId), amount=Number(req.body.amount), description=String(req.body.description||"").trim(), date=String(req.body.expense_date||localToday());
  const splitType = req.body.split_type === "custom" ? "custom" : "equal";
  if(!await getGroupMembership(groupId,req.session.userId)) return res.status(404).json({error:"Event not found or you are not a member."});
  if(!Number.isFinite(amount)||amount<=0||amount>999999999||description.length<2||description.length>180||!validDate(date)) return res.status(400).json({error:"Enter a valid expense amount, description and date."});
  if(!await getGroupMembership(groupId,payer)) return res.status(400).json({error:"The payer must be a member of this event."});
  const [groupMembers] = await pool.execute("SELECT user_id FROM group_members WHERE group_id=? ORDER BY user_id",[groupId]);
  const memberIds = new Set(groupMembers.map(m=>Number(m.user_id)));
  const participantIds = [...new Set((Array.isArray(req.body.participant_ids) ? req.body.participant_ids : []).map(Number).filter(Number.isInteger))];
  if(!participantIds.length || participantIds.some(id=>!memberIds.has(id))) return res.status(400).json({error:"Choose at least one event member who shares this expense."});
  const totalCents = Math.round(amount*100);
  let shareRows = [];
  if(splitType === "custom") {
    const rawShares = req.body.shares && typeof req.body.shares === "object" ? req.body.shares : {};
    shareRows = participantIds.map(userId=>({userId,cents:Math.round(Number(rawShares[String(userId)])*100)}));
    if(shareRows.some(s=>!Number.isFinite(s.cents)||s.cents<0)) return res.status(400).json({error:"Enter a valid non-negative amount for each selected participant."});
    if(shareRows.every(s=>s.cents===0)) return res.status(400).json({error:"The custom split must assign a positive amount to at least one participant."});
    if(shareRows.reduce((sum,s)=>sum+s.cents,0)!==totalCents) return res.status(400).json({error:"Individual shares must add up exactly to the total expense amount."});
  } else {
    const base=Math.floor(totalCents/participantIds.length), rem=totalCents-base*participantIds.length;
    shareRows=participantIds.map((userId,i)=>({userId,cents:base+(i<rem?1:0)}));
  }
  const connection=await pool.getConnection(); try { await connection.beginTransaction();
    const [result]=await connection.execute("INSERT INTO group_expenses(group_id,paid_by,description,amount,expense_date) VALUES(?,?,?,?,?)",[groupId,payer,description,amount,date]);
    for(const share of shareRows) await connection.execute("INSERT INTO group_expense_shares(expense_id,user_id,share_amount) VALUES(?,?,?)",[result.insertId,share.userId,share.cents/100]);
    await connection.commit(); res.status(201).json({id:result.insertId});
  }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}));
app.post("/api/groups/:id/members", requireAuth, asyncRoute(async(req,res)=>{
  const groupId=Number(req.params.id), email=String(req.body.email||"").trim().toLowerCase();
  if(!await getGroupMembership(groupId,req.session.userId)) return res.status(404).json({error:"Event not found or you are not a member."});
  const [users]=await pool.execute("SELECT id FROM users WHERE email=?",[email]); if(!users.length) return res.status(404).json({error:"No Ledger account exists for that email yet."});
  await pool.execute("INSERT IGNORE INTO group_members(group_id,user_id) VALUES(?,?)",[groupId,users[0].id]); res.json({success:true});
}));
app.post("/api/groups/:id/settlements", requireAuth, asyncRoute(async(req,res)=>{
  const groupId=Number(req.params.id), from=Number(req.body.from_user_id), to=Number(req.body.to_user_id), amount=Number(req.body.amount);
  if(!await getGroupMembership(groupId,req.session.userId)) return res.status(404).json({error:"Event not found or you are not a member."});
  if(from===to||!Number.isFinite(amount)||amount<=0||!await getGroupMembership(groupId,from)||!await getGroupMembership(groupId,to)) return res.status(400).json({error:"Invalid reimbursement transaction."});
  await pool.execute("INSERT INTO group_settlements(group_id,from_user_id,to_user_id,amount,settled,settled_at) VALUES(?,?,?,?,1,NOW())",[groupId,from,to,amount]);
  res.json({success:true});
}));
app.get("/api/groups/:id/settlements/history", requireAuth, asyncRoute(async(req,res)=>{
  const groupId=Number(req.params.id); if(!await getGroupMembership(groupId,req.session.userId)) return res.status(404).json({error:"Event not found or you are not a member."});
  const [rows]=await pool.execute(`SELECT s.id,s.amount,s.settled_at,f.name AS from_name,t.name AS to_name FROM group_settlements s JOIN users f ON f.id=s.from_user_id JOIN users t ON t.id=s.to_user_id WHERE s.group_id=? AND s.settled=1 ORDER BY s.settled_at DESC`,[groupId]); res.json({settlements:rows});
}));

app.put("/api/settings/profile", requireAuth, asyncRoute(async(req,res)=>{
  const name=String(req.body.name||"").trim(); if(name.length<2||name.length>100) return res.status(400).json({error:"Name must be between 2 and 100 characters."});
  await pool.execute("UPDATE users SET name=? WHERE id=?",[name,req.session.userId]); req.session.userName=name; const [rows]=await pool.execute("SELECT id,name,email FROM users WHERE id=?",[req.session.userId]); res.json({user:rows[0]});
}));

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  if (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_DB_ERROR" || err.code === "ECONNREFUSED") {
    return res.status(503).json({ error: "Database is not ready. Follow README.md to create the database and check your .env settings." });
  }
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function start() {
  try {
    await pool.query("SELECT 1");
    app.listen(PORT, () => console.log(`Expense Tracker is running at http://localhost:${PORT}`));
  } catch (error) {
    console.error("Could not connect to MySQL. Check your .env configuration and ensure MySQL is running.");
    console.error(error.message);
    process.exit(1);
  }
}
start();
