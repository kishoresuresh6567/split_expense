# Gather

A web app for shared expenses, without accounts or Google sign-in.

## Run

Use Node.js 22 or later. No dependencies to install.

```powershell
npm run dev
```

Open the address printed in the terminal (normally http://localhost:3000). If a port is busy the server tries the next one. `npm start` runs without watching files. If PowerShell blocks npm.ps1, use `npm.cmd run dev`.

## Features

- Create groups with member names; add more members later.
- Record INR expenses, their payer, date, and category.
- Select exactly which members share each expense and choose **Split evenly**, **Split by amounts**, **Split by shares**, or **Split by percentage**. Preview each person's cost before saving.
- Choose a group from the single group list; use **Manage members** to add or remove members.
- Use **Group options → Close group** to move a group to **Closed groups** in the hamburger menu. Closed groups remain viewable with their original records and balances; choose **Reopen group** to edit again.
- Use **Group options → Delete group** to permanently remove an active or closed group, including all members, expenses, and repayments. Deletion requires confirmation.
- Expand an expense to see its shares, edit it, or delete it. **Edit expense** lets you change its name, amount, date, payer, and selected members.
- Use **Expenses** to record costs and **Balances** to see who owes whom, record repayments, or undo a repayment.
- Saved changes recalculate balances and preserve recorded repayments. Existing browser data is retained through the redesign.

Data is stored in localStorage in the current browser and origin, with updates between tabs. Different ports have separate browser storage. There is no server database, cloud sync, login, or money transfer. Keep the same URL to access your saved groups. The app uses system fonts and has no external runtime dependencies.

## Check calculations

```powershell
npm test
```

Amounts are calculated in integer paise. Even splits assign extra paise in member order. Weighted shares and percentages use the largest fractional remainders, with member order breaking ties, so no money is lost to rounding. Exact member amounts must equal the expense total; percentages must add up to 100%. Shares must be positive, and custom inputs support up to two decimal places. Existing expenses without a split method remain even splits. You can switch methods through **Edit expense**; repayments stay unchanged. New members do not change past splits automatically.

## Code organization

```text
split_expense/
├── public/                       Website files
│   ├── index.html                Page layout
│   ├── assets/
│   │   └── gather-logo.svg       App logo and browser icon
│   ├── css/
│   │   └── styles.css            Responsive styles
│   └── js/
│       ├── app.js                State, storage, and user actions
│       ├── expense-logic.js      Split and balance calculations
│       ├── forms.js              Shared create/edit forms
│       └── views.js              Page rendering
├── server/
│   └── index.js                  Local web server
├── tests/
│   ├── expense-logic.test.js      Calculation tests
│   └── browser.test-runner.js    Browser workflow tests
├── .gitignore
├── package.json                  Run and test commands
└── README.md
```

`npm run test:browser` runs the Chromium workflow check using a separate browser profile in the operating system's temporary directory. The profile is deleted after the test, including failures; no browser data or screenshots are saved in the project. Set `CHROME_PATH` if Chrome is installed elsewhere. Set `TEST_URL` to test a running server; otherwise it tests `public/index.html` directly.
