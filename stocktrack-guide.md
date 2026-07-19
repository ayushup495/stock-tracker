# StockTrack — Complete Guide

## What is StockTrack?

StockTrack is a stock/inventory tracking system built for small shops and factories. It replaces manual registers (or parts of Tally) for one specific job: knowing exactly what is currently in stock, without counting by hand.

It was built by Ayush Upadhyay, first as a tool for a single family-run factory, then expanded into a multi-shop platform that any shop or business can sign up to and use independently.

## The core idea

Every item's current stock is calculated from three numbers:

**Opening stock + everything logged as "Stock In" − everything logged as "Stock Out" = Current stock**

This number is never typed in by hand — it is calculated live, every time, from the full history of transactions. That means it can never quietly drift out of sync with reality the way a manually-updated number can.

## How it was built (architecture)

- **Frontend** — a single web app (HTML, CSS, JavaScript). No app-store installation needed — it works as a normal website, and can also be "installed" to a phone or computer home screen like a native app (a Progressive Web App / PWA).
- **Backend** — Google Firebase, specifically Firebase Authentication (secure login) and Firebase Realtime Database (stores items, transactions, and shop data).
- **Hosting** — GitHub Pages, free static hosting that gives the app a permanent web address.
- **Offline support** — a service worker caches the app so it loads even without internet. Stock entries made while offline are queued and automatically sync once the connection returns.
- **Multi-shop design** — every shop that signs up gets its own private, isolated space inside the same database. No shop can see another shop's data — this is enforced by database security rules tied to each person's login, not just hidden in the interface.

## Key features

- Multi-shop accounts — any shop can create its own account; owners and workers each log in with their own username and password
- Two roles — Admins can add items, log stock, and manage the team; Viewers can only see current stock and history
- Stock In / Stock Out logging, with tap-to-adjust quantity buttons
- Automatic low-stock alerts — any item below its set reorder level is highlighted
- Item photos and model numbers, to help identify items physically on the shelf
- "Most used this week" chart, showing which items are being used fastest
- Offline mode — keeps working without internet, syncs automatically once reconnected
- Dark / light theme
- Excel export of current stock
- Weekly email report — automatically emails the shop's chosen address every week with current stock and the top used items, so restocking decisions are easy

## Guide: setting up a new shop

1. Open the app's link in any browser
2. Click **"Create new shop"**
3. Fill in the shop name, your name, a username you choose, and a password (at least 6 characters)
4. Click **"Check"** next to the username to confirm it is available
5. Click **"Create shop"** — you are now logged in as the shop's Admin

No technical setup and no separate installation is needed. Every new shop is automatically private and separate from every other shop using the app.

## Guide: for the shop Admin (owner)

**Adding items** — Items tab → "+ Add item". Fill in the item's name, unit (kg / pieces / etc.), category, how much is already in stock today (opening stock), the quantity at which a low-stock warning should appear (reorder level), and optionally a photo and model number.

**Logging stock coming in** — Dashboard tab → "+ Stock in" → pick the item, quantity, source/supplier, and date → Save.

**Logging stock going out** — Dashboard tab → "− Stock out" → pick the item, quantity, what it is being used for, and date → Save. The app will not allow removing more than what is actually available.

**Adding team members** — Team tab → "+ Add person" → enter their name, choose a username and password for them, and pick their role (Admin or Viewer). Share the username and password with them — they can change their own password later from their own login.

**Setting up the weekly email** — In the Team tab, enter an email address under "Weekly report email" and save. Every week, that address automatically receives current stock levels and the most-used items, with no manual work needed.

**Exporting data** — Dashboard tab → "Export excel" downloads current stock as a spreadsheet, useful for accountants or backups.

## Guide: for workers (Viewer role)

Log in with the username and password your shop admin gave you. Current stock and transaction history are visible — enough to know what is available and what is running low — but nothing can be added or changed. An admin can upgrade an account to "Admin" role if that person needs to log stock themselves.

**Changing a password** — once logged in, tap "Password" in the top bar, enter a new one, and save.

## Installing it like an app

On phone or computer, open the app's link in Chrome. Chrome usually offers an "Install" or "Add to Home Screen" option (menu → Install App, or an icon in the address bar). Once installed, it opens like any other app, with its own icon, no browser address bar visible.

## A note on privacy between shops

Each shop's data is completely separate at the database level, not just hidden in the interface. Two different shops using this same app cannot see, read, or accidentally modify each other's stock, items, or team information.

---

Developed by **Ayush Upadhyay**
