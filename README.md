# Ledger — Personal Expense Tracker

A full-stack college mini project with a polished, responsive **Minimalist Dark** interface. The frontend uses **HTML5, CSS3, and vanilla JavaScript only**. The backend uses Node.js + Express, and persistent data is stored in MySQL.

## Features

- Account registration, sign-in, sign-out, and session persistence
- Secure password hashing with bcrypt
- Per-account private transactions
- Add, view, edit, and delete income and expense records
- Categories, transaction dates, descriptions, and amount validation
- Monthly dashboard with income, expenses, balance, spending breakdown, and six-month cash-flow chart
- Monthly spending budget with progress, over-budget status, and per-category limits with warning indicators
- Search, type filter, date-range filtering, amount/date sorting, edit/delete confirmation, and payment method tracking
- Analytics with month-over-month expense comparison, savings rate, category and payment method breakdowns, data-derived financial insights, CSV export, and printable monthly summary
- Savings goals with targets, saved amounts, progress bars, and optional target dates
- Recurring transactions with weekly/monthly/yearly frequency, pause/resume, and explicit recording of due items to the transaction ledger
- Transaction calendar with daily income/expense totals
- Group expense splitting: create events, invite existing Ledger accounts by email, add shared expenses and payer, split equally across members, calculate minimized reimbursement transfers, mark reimbursements complete, and view settlement history
- Profile display-name settings and persistent dark/light theme preference
- Export transactions as CSV
- Responsive desktop, tablet, and mobile layouts
- Semantic HTML, heading hierarchy, accessible labels, keyboard focus states, text error messages, and reduced-motion support
- Prepared SQL statements, server-side validation, secure HTTP-only session cookies, and Helmet security headers

> The application does not seed fake transactions or demo users. Dashboard figures are calculated from transactions saved by the signed-in user.

## Requirements

- Node.js 18 or newer
- MySQL 8.0 or compatible MySQL server
- A terminal (PowerShell on Windows is fine)

## Setup on Windows

### 1. Create the database

Open MySQL Workbench, connect to your local MySQL server, then open and execute `database/schema.sql`.

Alternatively, from a terminal where the MySQL client is available:

```bash
mysql -u root -p < database/schema.sql
```

This creates the `expense_tracker` database and all tables used by Ledger. If you already ran the earlier version of this project, execute the updated script one time to add the `payment_method` column and create the new feature tables. The `ALTER TABLE ... ADD COLUMN` line is a one-time schema upgrade; do not execute that same line again after the column exists. The app also creates a MySQL-backed session table at first start.

### 2. Configure the app

Copy `.env.example` to `.env` in the project root. Update `DB_USER`, `DB_PASSWORD`, and other database settings for your MySQL installation. Replace `SESSION_SECRET` with a long, random value.

Example:

```env
PORT=3000
NODE_ENV=development
SESSION_SECRET=use-a-long-random-secret-here
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=expense_tracker
```

Do not commit `.env` or share your database password.

### 3. Install dependencies

Open a terminal in the `personal-expense-tracker` folder and run:

```bash
npm install
```

### 4. Start the application

```bash
npm start
```

You should see:

```text
Expense Tracker is running at http://localhost:3000
```

Open **http://localhost:3000** in your browser. Do not open `public/index.html` directly as a file; the frontend uses the API served by Express.

### 5. Create your account

Choose **Create account**, enter your name, email, and a password of at least 8 characters. Add income, expenses, and a monthly budget. All entries are saved in MySQL under your account.

## Common issues

**`Could not connect to MySQL`**
- Confirm the MySQL service is running.
- Check the database username and password in `.env`.
- Confirm the database `expense_tracker` exists and the schema was executed.
- Make sure `DB_PORT` matches your MySQL server (usually 3306).

**`Database is not ready` in the UI**
- Execute `database/schema.sql` in MySQL Workbench.
- Restart the app after correcting `.env`.

**Port 3000 is already in use**
- Change `PORT=3001` in `.env` and open `http://localhost:3001`.

**Login does not work after changing session configuration**
- Restart the app and sign in again. Sessions are stored in MySQL.

## Project structure

```text
personal-expense-tracker/
├── database/
│   └── schema.sql
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── .env.example
├── .gitignore
├── package.json
├── server.js
└── README.md
```

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Check server and database connectivity |
| POST | `/api/auth/register` | Create an account |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Get the current signed-in user |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/categories` | Retrieve supported categories |
| GET | `/api/dashboard?month=YYYY-MM` | Monthly summary, category breakdown, recent transactions, cash flow |
| GET | `/api/transactions` | List/search/filter/sort saved transactions by month or date range |
| GET/PUT/DELETE | `/api/category-budgets` | Manage category spending limits |
| GET/POST/PUT/DELETE | `/api/goals` | Manage savings goals and saved progress |
| GET/POST/PATCH/DELETE | `/api/recurring` | Manage recurring transactions and record due items |
| GET/POST | `/api/groups` | Create events and list groups for the signed-in member |
| GET | `/api/groups/:id` | Event members, expenses, balances, and reimbursement recommendations |
| POST | `/api/groups/:id/expenses` | Add shared event expense and equal member shares |
| POST | `/api/groups/:id/settlements` | Record completed reimbursement |
| GET | `/api/groups/:id/settlements/history` | View completed reimbursements |
| PUT | `/api/settings/profile` | Update display name |
| POST | `/api/transactions` | Add a transaction |
| PUT | `/api/transactions/:id` | Update a transaction |
| DELETE | `/api/transactions/:id` | Delete a transaction |
| PUT | `/api/budget` | Save a monthly budget |
| GET | `/api/export.csv` | Export the signed-in user's transactions |

## Evaluation criteria checklist

### Structure & semantics
- [x] HTML5 doctype and correct `html`, `head`, and `body` structure
- [x] Semantic `header`, `nav`, `main`, `section`, `aside`, `footer`, `form`, `fieldset`, and `legend` elements where appropriate
- [x] Logical heading order without skipped levels
- [x] Table captions and scoped column headings

### Text & readability
- [x] Centralized CSS variables for the design tokens
- [x] Normal body text is at least 16px; supporting labels are intentionally smaller
- [x] Readable line-height and spacing
- [x] No blinking, marquee, or moving text
- [x] `prefers-reduced-motion` support
- [x] Dark palette with warm amber accent and glass-effect cards

### Images & media
- [x] No content images are required for this data dashboard; decorative CSS elements are hidden from assistive technology
- [x] No audio or video is included, so captions/transcripts are not applicable

### Accessible forms and controls
- [x] Every input/select has a visible associated label
- [x] Placeholders are hints, not labels
- [x] Required fields are identified in text and validated
- [x] Field-level error messages use text, `aria-invalid`, and `aria-describedby`
- [x] Status and form messages use live regions
- [x] Keyboard navigation, visible focus indicators, and a skip link
- [x] Touch-friendly primary controls (minimum 44px height in most form/button controls)

### Data and functionality
- [x] Real MySQL persistence; no seeded fake data
- [x] Server-side validation and parameterized SQL
- [x] Records are scoped to the signed-in account
- [x] Monthly budget and transaction data are stored in MySQL

## Notes for a college demonstration

1. Start the app and register a new account.
2. Add two income records and a few expense records across categories.
3. Show how the dashboard, chart, and budget progress update from saved data.
4. Edit and delete a transaction.
5. Search/filter transactions and export the CSV.
6. In MySQL Workbench, show the `users`, `transactions`, and `monthly_budgets` tables to demonstrate persistence.

The contrast and accessibility requirements are implemented in the stylesheet and markup, but automated and manual accessibility testing is still recommended before submission.
