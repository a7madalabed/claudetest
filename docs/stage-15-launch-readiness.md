# Stage 15 — Launch Readiness

> **Goal of this stage:** close the gaps between "deployable" and "ready for real people". A real person forgets their password, mistypes their email, wants their data back, wants to leave, and sometimes visits a page that someone has tried to attack. Stage 14 could deploy Ledgerly; this stage makes it safe and decent to open the doors.
>
> **What you'll learn:** sending real email (and testing it for real); single-use links done properly; why rate limits for secrets belong in the database; email verification and why it matters for _invitations_; data export and account deletion as product features; a nonce-based Content Security Policy; and how browser tests found **four bugs that had been in the app for stages**, including one that made links on the sign-in page miss clicks.

---

## Table of contents

1. [What we built](#1-what-we-built)
2. [The review that started it](#2-the-review-that-started-it)
3. [Real email](#3-real-email)
4. [Links sent by email](#4-links-sent-by-email)
5. [Forgot password](#5-forgot-password)
6. [Confirming an email address](#6-confirming-an-email-address)
7. [Throttling in the database](#7-throttling-in-the-database)
8. [Your data: export and deletion](#8-your-data-export-and-deletion)
9. [A Content Security Policy](#9-a-content-security-policy)
10. [Browser tests for every account journey](#10-browser-tests-for-every-account-journey)
11. [What testing caught this stage](#11-what-testing-caught-this-stage)
12. [Results](#12-results)
13. [Protecting `main`](#13-protecting-main)
14. [Run it yourself](#14-run-it-yourself)
15. [Exercises](#15-exercises)
16. [Glossary](#16-glossary)

---

## 1. What we built

| Area             | What's new                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email            | An SMTP mailer (nodemailer). **Mailpit** catches every message in development, tests and CI. Production refuses to start without a mail setting.                                               |
| Account links    | `account_tokens`: hashed, single-use, expiring, bound to an address. The raw link travels to the worker encrypted.                                                                             |
| Forgot password  | `/forgot-password` → email → `/reset-password`. Never reveals who has an account. Resetting signs out every device and emails the owner.                                                       |
| Email check      | Every sign-up gets a "confirm your email" message and a banner until it's done. **Joining a household needs a confirmed address.** Notification emails go only to confirmed addresses.         |
| Throttling       | Every limit that protects a secret (passwords, 2FA codes, reset emails) moved from process memory to a Postgres table: shared by all instances, kept across deploys, race-free.                |
| Privacy          | **Download my data** (one JSON file with everything you can see) and **Delete my account** (password and 2FA code; refuses to orphan a shared household; a goodbye email).                     |
| Browser security | A **Content Security Policy** with a fresh nonce per response, `frame-ancestors 'none'`, and four companion headers on every page.                                                             |
| Browser tests    | 5 new journeys: forgot password, confirm email, two-factor sign-in (code and recovery code), export and delete, CSP. **Every** test now fails if the browser blocks anything under the policy. |
| Fixes            | A redirect loop for anyone with an expired session; sign-in page links that missed clicks; a stale comment about Redis; the global rate limit's role clarified.                                |
| Operations       | Runbook sections: email (SPF, DKIM, DMARC), account support requests, and protecting `main`.                                                                                                   |

---

## 2. The review that started it

After Stage 14, we read the whole project as if we were about to launch it, and asked one question of every part: _what happens on the first bad day?_ The list:

- **Nobody could reset a password.** A forgotten password meant a lost account, and all its history with it.
- **No email was ever sent.** The worker had a "mailer" that printed messages to its log. Fine for learning, useless for users.
- **Email addresses were never checked.** You could sign up as anyone, and receive a household invitation meant for that address.
- **No way to leave, or to take your data.** Many privacy laws (GDPR in Europe, CCPA in California) give people both rights. More importantly, users expect both.
- **Pages had no Content Security Policy** and could be framed by any site.
- **Login lockouts lived in process memory.** Every deploy reset them; two API instances meant two allowances. A comment even promised "Stage 12 moves them to Redis". It didn't, and the comment stayed.
- **Two-factor sign-in and settings had no browser tests.**
- **Nothing stopped a direct push to `main`.**

Notice that none of these are bugs in the usual sense. Every test was green. They are _missing features_ that an honest checklist finds and a test suite never will: tests check what you built, not what you forgot to build.

---

## 3. Real email

### 3.1 The mailer

`apps/api/src/lib/mailer.ts` has two implementations behind one interface:

- `LogMailer` prints the message (useful when you have no inbox at all);
- `SmtpMailer` sends it over SMTP with [nodemailer](https://nodemailer.com/), the standard Node library.

Which one runs is configuration, read by `createMailer(env)`:

| Setting       | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `MAIL_DRIVER` | `smtp` or `log`. **Required in production**: the API refuses to start without it.      |
| `SMTP_URL`    | e.g. `smtps://user:password@smtp.example.com:465`. Required when the driver is `smtp`. |
| `MAIL_FROM`   | The sender, e.g. `Ledgerly <no-reply@ledgerly.app>`.                                   |

Why make production _choose_? Because the safe-looking default (`log`) fails silently: everything works, and no user ever gets an email. A crash at start-up is loud and fixed in minutes; silent non-delivery is found weeks later by an angry user.

SMTP is deliberately boring. Every email provider (Postmark, Amazon SES, Resend, Mailgun, your own server) speaks it, so changing provider is a one-line change in `.env`, not a code change.

### 3.2 Sending at most once

Email jobs run through the transactional outbox from Stage 10. A job can run twice (the worker crashes after sending, before recording success), so each message gets a **deterministic Message-ID** made from the job's idempotency key. Some providers and mail clients recognise a repeated Message-ID and drop or merge the duplicate. It's not a guarantee of exactly-once (nothing over a network is), but it gives the receiving side what it needs to spot a repeat.

### 3.3 Testing email for real: Mailpit

[Mailpit](https://mailpit.axllent.org/) is a tiny SMTP server with a web inbox and an HTTP API. It runs next to Postgres (`pnpm db:up`), in CI as a service container, and in the e2e suite:

- the **API tests** send through real SMTP and read the message back through Mailpit's API: the headers, the subject, the link;
- the **browser tests** wait for the actual email, take the link out of it, and open it, exactly as a person would (`e2e/src/mail.ts`).

That's a big step up from "assert that `mailer.send` was called". A mocked mailer can't tell you that the link points at the wrong host, the template has a typo, or the SMTP settings don't work.

### 3.4 Delivery is a DNS problem, too

Sending isn't the same as arriving. Big inboxes reject or spam-folder mail from a domain that hasn't set up **SPF** (which servers may send for you), **DKIM** (a signature on every message) and **DMARC** (what to do when those fail). These are DNS records your provider gives you. The runbook's _Email_ section lists the steps; they can't be done in code.

---

## 4. Links sent by email

"Reset your password" and "confirm your email" are both links that grant something to whoever holds them. They follow the same rules as sessions (Stage 5) and invitations (Stage 11):

| Rule                                   | How                                                                                                | Why                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Unguessable                            | 256 random bits                                                                                    | Guessing is hopeless                                                        |
| **Stored hashed**                      | The database keeps only the SHA-256                                                                | A leaked database or backup contains no working links                       |
| **Encrypted in transit to the worker** | The job payload holds the raw token encrypted with `ENCRYPTION_KEY`                                | Job payloads are rows too; they'd otherwise be a copy of every live link    |
| **Single-use**                         | Redeeming sets `used_at` under `SELECT … FOR UPDATE`                                               | Two clicks (or an attacker racing you) can't both succeed                   |
| **Short-lived**                        | Reset: 1 hour. Confirmation: 48 hours                                                              | A link sitting in an old inbox stops working                                |
| **Only the newest works**              | Issuing a link retires older unused ones of the same kind                                          | "I asked three times" doesn't leave three live links                        |
| **Bound to an address**                | The token row stores the email it was sent to; redeeming checks the account still has that address | A link proves ownership of _that_ inbox, not of whatever the address is now |

The worker also checks, just before sending, that the link is still unused and unexpired. If you asked twice in a row, the first (already retired) email is skipped instead of sending a dead link.

---

## 5. Forgot password

```
/login ── "Forgot password?" ──► /forgot-password ── email ──► /reset-password?token=…
                                         │                              │
                         202, always the same answer          new password set,
                         (account or not)                     every session deleted,
                                                              "password changed" email
```

Three decisions worth understanding:

**1. The answer never reveals whether an account exists.** `POST /v1/auth/password-reset/request` answers `202 Accepted` with the same body for any address. If it said "no account with that email", anyone could test a list of addresses and learn who uses Ledgerly: **account enumeration**. (Sign-up necessarily reveals it, "this email is taken", which is why sign-up is throttled per IP.)

**2. A reset signs out everywhere.** People reset passwords because something went wrong. If an attacker has a session, the reset must end it. `resetPassword` deletes all of the user's sessions in the same transaction that sets the new hash.

**3. The owner is told.** A "your password was changed" email goes to the account. If it wasn't them, they now know, while the reset link is the only thing that could have done it.

Clicking a reset link also confirms the email address: you just proved you can read that inbox.

---

## 6. Confirming an email address

Every sign-up now sends a "confirm your email" message, and the app shows a banner (with a **Resend** button) until the link is clicked. `users.email_verified_at` records when.

Most apps confirm emails to fight spam sign-ups. Ledgerly has a sharper reason: **household invitations are addressed to an email**. Before this stage, someone could sign up as `jamie@example.com` without owning that inbox, then accept an invitation meant for Jamie, and see a family's finances. Now:

- **accepting an invitation requires a confirmed address** (403 `email_not_verified`). The invite page explains the extra step instead of showing an error;
- **notification emails go only to confirmed addresses**, so Ledgerly can't be used to send mail to someone who never signed up.

Unconfirmed accounts can otherwise use the app fully. Locking people out until they find an email is a poor first experience, and their own data isn't at risk.

---

## 7. Throttling in the database

### 7.1 Why memory wasn't enough

Stage 5's login lockout used Fastify's rate limiter, which counts in process memory. Three problems:

1. **Every deploy reset it.** Stage 14 deploys restart the API, so an attacker gets a fresh allowance each time.
2. **Each instance counts on its own.** Two API containers meant twice the guesses.
3. **Check, then record, is a race.** "Fewer than 5 failures? Then check the password, and record a failure if wrong." Send 100 guesses at the same instant and all 100 pass the check before the first failure is written.

### 7.2 Count first, atomically

`apps/api/src/modules/auth/throttle.ts` keeps counters in an `auth_throttles` table. Every attempt counts _itself_ with one `INSERT … ON CONFLICT DO UPDATE` (which locks the row) **before** the secret is looked at:

```sql
insert into auth_throttles (key, attempts, window_started_at)
values ($key, 1, now())
on conflict (key) do update set
  attempts = case when <window expired> then 1 else auth_throttles.attempts + 1 end,
  window_started_at = case when <window expired> then now() else auth_throttles.window_started_at end
returning attempts, <seconds until the window ends> as retry_after
```

If the returned count is over the limit, the request stops with `429 too_many_attempts` and a `Retry-After` header. A success clears the counter. Parallel guessing gains nothing.

We proved the race was real with a mutation check: the naive "check, then record" version let **19 of 20** simultaneous wrong guesses through. The atomic version lets exactly 5 through (`throttle.test.ts`).

### 7.3 One limit per attack

| Limit                       | Window | Stops                                                 |
| --------------------------- | ------ | ----------------------------------------------------- |
| login, per IP + account: 5  | 15 min | one machine guessing one person's password            |
| login, per account: 20      | 15 min | a botnet guessing one person's password from many IPs |
| login, per IP: 100          | 15 min | one machine trying a common password on many accounts |
| 2FA code, per account: 5    | 15 min | guessing a 6-digit code from many sessions at once    |
| re-entering a password: 5   | 15 min | guessing via "disable 2FA" or "delete account"        |
| reset emails: 3 per address | 1 h    | flooding someone's inbox                              |
| confirmation emails: 3      | 1 h    | the same, via "Resend"                                |
| data export: 10             | 1 h    | hammering the most expensive query in the app         |
| sign-ups per IP: 10         | 1 h    | scripted account creation                             |

The per-account login limit is looser on purpose. Anyone can trip it for someone else's account, which locks the real owner out: a 15-minute nuisance, never a permanent lockout. That's the trade-off every login system makes.

Limits that count _volume from one IP_ can be switched off with `RATE_LIMIT_ENABLED=false`, because the e2e suite and load tests send thousands of requests from `127.0.0.1`. **Limits that protect a specific account can never be switched off.**

The general in-memory rate limit stays. It's a cheap first defence against floods, where an approximate count is fine. Secrets get the exact, shared one. The nightly cleanup job deletes counters older than a day.

---

## 8. Your data: export and deletion

Both live in **Settings → Security → Your data**.

### 8.1 Download my data

`GET /v1/me/export` returns one JSON file (`ledgerly-export-2026-11-05.json`):

- your profile;
- every household you belong to, with its accounts, categories, transactions, budgets, goals and recurring rules.

The format has a name and a version (`"format": "ledgerly-export", "version": 1`), so a future importer knows what it's reading.

It deliberately **leaves out** two kinds of data. Secrets: password hash, 2FA secret, recovery codes, sessions. Other people's personal data: fellow household members appear by name and role only, not by email address. The export answers "what does Ledgerly know about _me_", not "everything about my household's members".

### 8.2 Delete my account

Deletion asks for your password, and your 2FA code if you use it, through the same re-authentication throttle as other sensitive actions. Then, in one transaction:

1. **Lock** the membership rows of every household you're in (`SELECT … FOR UPDATE`).
2. If you're the **only owner of a household other people use**, stop with 409 `sole_owner`: "make one of them an owner first". Deleting you would leave them in a household nobody can manage. This is Stage 11's last-owner rule. The lock matters: without it, the other owner could be demoted between our check and our delete.
3. Households where you're the only member are deleted with you.
4. A goodbye email is queued. It carries the address and name inside the job, because the account won't exist when the worker sends it.
5. The user row is deleted. Foreign keys with `ON DELETE CASCADE` take sessions, tokens, memberships and preferences with it. Transactions you added to a _shared_ household stay: they're the household's records. Their "created by" becomes empty.

The browser goes to `/login?deleted=1`, which says the account is gone.

**Backups:** a deleted account still exists in backups until they age out (14 days locally, plus whatever your off-site copies keep). That's normal, and privacy regulators accept it as long as you say so and never restore the account into the live app. The runbook's _Account support_ section has the wording.

---

## 9. A Content Security Policy

### 9.1 What it is

Cross-site scripting (XSS) means an attacker's JavaScript runs on your page. Usually it gets there through data you display without escaping. React escapes text for us, but one mistake (an unsafe HTML prop, a library bug) and the attacker's script can read the page, act as the user, and send data anywhere.

A **Content Security Policy** is a response header that tells the browser which scripts may run. With a good one, an injected `<script>` simply doesn't execute. XSS goes from "game over" to "a blocked attempt in the console".

### 9.2 Ours, and why it's shaped this way

`apps/web/src/lib/security-headers.ts`, sent by `src/proxy.ts` on every page:

```
default-src 'self';
script-src 'self' 'nonce-<random>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; object-src 'none';
frame-ancestors 'none'; form-action 'self'; base-uri 'self';
upgrade-insecure-requests          (behind HTTPS only)
```

- **A nonce, new on every response.** The proxy generates a random UUID (122 random bits) and passes it to Next.js in a request header. Next stamps the nonce on every script it renders; `next-themes` gets it as a prop for its tiny inline script. An injected script can't know a value that changes on every page load.
- **`'strict-dynamic'`.** A trusted (nonced) script may load more scripts: Next's code-split chunks. Host allow-lists are then ignored, which is the point. Research found most allow-list policies could be bypassed, usually through a JSONP endpoint or an old library on an allowed CDN. This "strict CSP" is what Google recommends.
- **Styles allow inline.** Animations and components set `style=""` attributes, which nonces can't cover. Injected CSS can do far less harm than injected JavaScript, so this is a common, deliberate trade.
- **`frame-ancestors 'none'`** (plus `X-Frame-Options: DENY` for old browsers) stops **clickjacking**: another site loading Ledgerly in an invisible frame over a fake button, so your click lands on "Delete forever".

Four companion headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that switches off camera, microphone, location, payment and USB, and the frame header above. HSTS was already set by Caddy (Stage 14).

A nonce means each response is unique, so pages render per request rather than from a static cache. Ledgerly's pages are personal and dynamic already, so nothing was lost.

### 9.3 A policy that's too strict fails silently

This is the dangerous part. When a CSP blocks one of _your_ scripts, nothing crashes. A button stops working, a chart doesn't draw, and the only trace is a line in the browser console that nobody reads.

So every browser test now has an automatic **CSP guard** (`cspGuard` in `e2e/src/fixtures.ts`). It listens for the browser's `securitypolicyviolation` event in every page of every test, including second browsers, and fails the test if there was one. The guard immediately found something (§11, bug 4).

And a dedicated test proves the policy works: it injects a `<script>` into the real HTML of `/login`, with the real headers, and checks that the page works, the script didn't run, and the guard noticed. (Injecting with `page.evaluate` would prove nothing: scripts added through the DevTools protocol are exempt from CSP. Our first draft of the test made exactly that mistake, and passed against a page with no policy at all.)

---

## 10. Browser tests for every account journey

`e2e/tests/account.spec.ts`, all through the real UI and the real email:

| Journey         | What it proves                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forgot password | The emailed link sets a new password, the new one works, **the old device's session ends cleanly**, and the "password changed" email arrives.    |
| Confirm email   | A new account sees the banner, the emailed link confirms it, the banner disappears.                                                              |
| Two-factor      | Set up 2FA with a real TOTP code (the `otpauth` library computes it), then sign in with a code, and again with a recovery code.                  |
| Your data       | The download is a valid export containing a transaction we added; deletion signs out, sends the goodbye email, and the password no longer works. |
| CSP             | §9.3.                                                                                                                                            |

The household journey (Stage 11) gained a step: the invited partner now confirms their email from the real message before joining.

One detail in the 2FA test is worth copying. It signs in with the code for the _next_ 30-second window, not the current one. The current code was just used to switch 2FA on, and the API correctly refuses a code twice (replay protection from Stage 5). The test respects the security rule rather than working around it.

---

## 11. What testing caught this stage

1. **A redirect loop for every expired session** (forgot-password journey). It had been there since the app shell (Stage 6). A page whose API call returned 401 redirected to `/login`; the proxy sends anyone _with_ a session cookie from `/login` to `/app`; `/app` got a 401 again… forever, until the browser gave up. Anyone whose session was revoked (sign out everywhere, a password reset) hit it. Fixed with `/session-expired`, a route that deletes the stale cookie and _then_ goes to `/login`. Reproduced first with `curl` and a real cookie jar.
2. **Links on the sign-in page missed clicks** (Playwright clicked "Forgot password?" and nothing happened). Present since Stage 5, and the hardest bug of the stage. We built Stage 14 in a separate worktree to prove it was older than this stage. Then we ruled out the router, React, and event handlers. Measuring the layout found it. Clicking the link moved focus out of the email field, which ran validation on blur. That showed an error message, which pushed the link down **11 pixels between mouse-down and mouse-up**. The click landed on empty space. Real people with a mouse hit the same thing. Fixed by validating on submit (then live while correcting), which is also calmer for users: no red text before you've finished. All four auth forms changed.
3. **The CSP guard missed a violation** (mutation check). Our first guard watched the console. Chromium reported one blocked `eval` as an event but logged nothing. The guard now listens for `securitypolicyviolation` events.
4. **Zod probed `eval` on every page** (the improved guard). Zod 4 checks whether `new Function("")` works, to decide whether it can compile faster validators. Under our CSP that check is a violation in every page, every time. One line, `z.config({ jitless: true })`, loaded before anything else, tells Zod not to try. Validation is slightly slower, which is invisible at form sizes.
5. **A race when deleting an account** (repeated runs). While the delete request ran, a live-updates connection noticed the session had ended and redirected to `/login?next=…`, beating our own redirect to `/login?deleted=1`. The person saw a plain sign-in page instead of "your account has been deleted". The app now marks "signing out" before the request, and the live-updates handler stands aside.
6. **Throttle race** (mutation check): §7.2, 19 of 20 parallel guesses through with the naive version.
7. **Memory-only lockouts reset on every deploy** (the review in §2), and a code comment promising a Redis migration that never happened.
8. **A 1-in-40 flaky test** (`--repeat-each 40`). Both the sign-in page and the forgot-password page have an "Email" field; sometimes the test typed into the old page's field just before navigation finished. The test now waits for the new page's heading. It's a reminder that "it passed" once means little: run a new browser test many times before trusting it.
9. **An unset Compose variable arrives as an empty string**, which failed URL validation for `SMTP_URL` in the container stack. Empty strings are now treated as "not set".
10. **A Next.js warning about Node APIs in the Edge runtime**, from the shutdown hook in `instrumentation.ts`. It now loads only on the Node runtime.

Bugs 1, 2 and 5 are the kind users report as "the app is broken sometimes" and nobody can reproduce. Browser tests of complete journeys, run many times, found them in an afternoon.

We also checked that the new tests can fail. Removing each rule made its test go red: session revocation on reset, the invitation's email check, the sole-owner rule, the atomic throttle, and validate-on-submit.

---

## 12. Results

| What                                    | Result                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| New API endpoints                       | 6 (`password-reset/request`, `password-reset`, `verify-email`, `verify-email/resend`, `GET /me/export`, `DELETE /me`) |
| New tables                              | 2 (`auth_throttles`, `account_tokens`), plus `users.email_verified_at`; migration 0013                                |
| Parallel wrong guesses that get through | naive: 19 / 20 → now: **5 / 20** (exactly the limit)                                                                  |
| CSP violations across the e2e suite     | **0** (guarded on every test)                                                                                         |
| Browser suite                           | 19 tests; 3 full runs **57 / 57**; account journeys ×10 **50 / 50**                                                   |
| Tests                                   | 413 → **445** (db 35, api 210, shared 89, web 92, e2e 19) + 9 alert tests                                             |
| API contract                            | additive only: 6 operations and `Me.emailVerified` added, nothing removed or changed                                  |

---

## 13. Protecting `main`

Until now, finished stages were pushed straight to `main`. CI ran afterwards, so a red build was already on `main` by the time anyone knew. For a team (or for a launched app) that's backwards. GitHub's **branch protection** (Settings → Branches, or the newer _Rulesets_) can require:

- **a pull request** for every change to `main`, no direct pushes;
- **status checks to pass first**: the `check`, `e2e`, `containers` and `security` jobs;
- the branch to be **up to date** with `main` before merging;
- optionally, **a review** from someone other than the author.

This is a setting in the repository, not something in the code, so it isn't part of this stage's commit. The runbook's _Protecting main_ section lists exactly which boxes to tick.

---

## 14. Run it yourself

```bash
pnpm db:up        # Postgres and Mailpit
pnpm dev
open http://localhost:8025    # Mailpit: every email the app sends lands here
```

Then try:

- **Forgot password:** on `/login`, click "Forgot password?", enter `demo@ledgerly.app`, open the email in Mailpit, and set a new password. Any other browser signed in as demo is now signed out, cleanly.
- **Confirm an email:** sign up with any address and watch the banner; confirm from Mailpit.
- **Invitations:** invite a new address from the household page; the new account must confirm before it can join.
- **Your data:** Settings → Security → Download my data. Open the JSON.
- **The CSP:** open the browser's developer tools on any page, Network tab, and look at the response headers. Try pasting `document.body.append(Object.assign(document.createElement('script'), {textContent: 'alert(1)'}))` into the console: blocked.
- **The throttle:** sign in with a wrong password six times. The sixth answer is 429, with a `Retry-After` header. Restart the API: still locked.

```bash
pnpm e2e    # all 19 browser journeys, real emails included
```

---

## 15. Exercises

1. **Change of email.** Design "change my email address". Which address gets the confirmation link, and which gets a "your address was changed" notice? What happens to an unused verification link for the old address? (Hint: §4's last rule.)
2. **Timing.** `password-reset/request` gives the same _answer_ for unknown addresses, but does it take the same _time_? Measure 100 requests of each kind. If they differ, how would you hide it?
3. **Break the CSP.** Remove `'strict-dynamic'` from the policy, build, and run the e2e suite. Which tests fail, and what does the guard report?
4. **Report-only first.** Real teams roll out a CSP with `Content-Security-Policy-Report-Only` and a `report-to` endpoint, watch the reports for a week, then enforce. Add a reporting endpoint to the API and send violations to the logs.
5. **Export at scale.** Stage 12's large household has 2 million transactions. How big is its export? Change `GET /me/export` to stream the response instead of building it in memory.
6. **The deletion grace period.** Some apps wait 14 days before deleting, in case of a mistake or a stolen session. Design it: what's locked during the wait, how is it cancelled, and which job finally deletes?
7. **Leaked passwords.** Add a check against the "Have I Been Pwned" password list using its k-anonymity API (only the first 5 characters of a SHA-1 hash leave the server). Where should it run, and what if the service is down?

---

## 16. Glossary

| Term                          | Meaning                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| **SMTP**                      | The protocol servers use to send email.                                                         |
| **SPF / DKIM / DMARC**        | DNS records that let inboxes check that mail claiming to be from your domain really is.         |
| **Transactional email**       | Email caused by something a user did (reset, confirmation), as opposed to marketing.            |
| **Account enumeration**       | Learning who has an account from differences in an app's answers.                               |
| **Single-use token**          | A secret that stops working once used.                                                          |
| **Throttling**                | Limiting how many attempts are allowed in a time window.                                        |
| **Credential stuffing**       | Trying username/password pairs leaked from other sites.                                         |
| **Password spraying**         | Trying one common password against many accounts.                                               |
| **Race condition**            | A bug that depends on the timing of two things happening at once.                               |
| **UPSERT**                    | "Insert, or update if it exists", done atomically (`INSERT … ON CONFLICT DO UPDATE`).           |
| **Right to access / erasure** | Privacy-law rights to get a copy of your data and to have it deleted.                           |
| **XSS**                       | Cross-site scripting: an attacker's script running on your site.                                |
| **Content Security Policy**   | A header telling the browser which scripts, styles, frames and connections a page may use.      |
| **Nonce**                     | "Number used once": a random value, new per response, that marks trusted scripts.               |
| **`'strict-dynamic'`**        | A CSP rule: scripts trusted by nonce may load further scripts; host allow-lists are ignored.    |
| **Clickjacking**              | Tricking a click by loading a site in an invisible frame over a decoy.                          |
| **Branch protection**         | Repository rules that stop changes reaching a branch without a pull request and passing checks. |
| **Flaky test**                | A test that sometimes passes and sometimes fails with no code change.                           |
