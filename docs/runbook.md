# Ledgerly runbook

What to do, step by step, when operating Ledgerly in production. Written to be
read at 3 a.m.: commands first, explanations after. Every alert links here.

All commands run **on the server**, in `~/ledgerly/deploy/`, unless they say otherwise.
`dc` below is shorthand for:

```bash
alias dc='IMAGE_TAG=$(tail -n1 .deploy-history) docker compose --env-file .env'
```

Contents: [Setting up a server](#setting-up-a-server) · [Email](#email) ·
[Protecting main](#protecting-main) · [Deploying](#deploying) ·
[Rolling back](#rolling-back) · [Failed deploy](#failed-deploy) ·
[Migrations](#migrations) · [Backups](#backups) · [Restoring](#restoring) ·
[Monitoring](#monitoring) · [Secrets](#secrets) · [Account support](#account-support) ·
[Alerts](#alerts)

---

## Setting up a server

One Linux server (2 vCPU / 4 GB is plenty to start; see Stage 12 for capacity).

1. Install Docker Engine with the Compose plugin. Create a user `deploy` in the
   `docker` group. Allow SSH key login only.
2. Point your domain's DNS `A`/`AAAA` record at the server. Open ports 80 and 443
   (and nothing else besides SSH).
3. As `deploy`:
   ```bash
   mkdir -p ~/ledgerly/deploy
   ```
   Then from your machine, copy the files once (CI does it on every deploy after this):
   ```bash
   rsync -az --exclude .env --exclude alertmanager/alertmanager.yml deploy/ deploy@SERVER:ledgerly/deploy/
   ```
4. On the server, create `~/ledgerly/deploy/.env` from `.env.example` and fill in every
   value. **Save `ENCRYPTION_KEY` and `POSTGRES_PASSWORD` in your password manager
   now**: without the key, a restored backup can't decrypt anyone's 2FA secret.
   Also fill in `LEGAL_OPERATOR_NAME` and `LEGAL_CONTACT_EMAIL`: they appear on the
   public **Privacy** and **Terms** pages (linked from sign-up). Do this before you
   invite anyone; a privacy page with nobody to contact is half a page. Read both
   pages once and check they describe what you really do (they describe the app as
   built; they are not legal advice, and a lawyer should read them if you take
   other people's money data for real).
5. If the images are private, let the server pull them: create a GitHub token with
   only `read:packages`, then `docker login ghcr.io -u <you>` with it.
6. In GitHub → Settings:
   - **Environments → New environment `production`**. Add yourself as a **required
     reviewer**, and under "Deployment branches" allow only `main`. Not optional:
     it is the second lock on production, behind the workflow's own check that
     only pushes to this repository's `main` are deployed.
   - **Actions → General → Fork pull request workflows**: require approval for
     **all outside collaborators**, so a stranger's pull request can't run CI
     until you've read it.
   - **Secrets** (in the environment): `DEPLOY_HOST`, `DEPLOY_USER` (`deploy`),
     `DEPLOY_SSH_KEY` (a key made only for this), and `DEPLOY_KNOWN_HOSTS`, the
     output of `ssh-keyscan SERVER`, checked against the server's real fingerprint.
   - **Variables**: `SITE_ADDRESS` (your domain), then `DEPLOY_ENABLED` = `true`.
7. **Backup encryption key** (off-site copies are encrypted; the script refuses
   to upload without a key). On YOUR machine, not the server:
   ```bash
   age-keygen -o ledgerly-backup-key.txt     # apt/brew install age
   ```
   Put the whole file in your password manager. Its `# public key: age1…` line
   is the `BACKUP_AGE_RECIPIENT` below: it can only ENCRYPT, so it's safe on the
   server. The private key is the only way to read a backup; lose it and every
   off-site copy is noise. (For the weekly drill to test the off-site copy, a
   copy of the key goes on the server too, readable by `deploy` only:
   `install -m 600 ledgerly-backup-key.txt ~/.ledgerly-backup-key.txt`. That
   gives a thief of the server nothing they don't already have, the live
   database, while a leaked bucket stays unreadable.)
8. **Check-in URLs**: create two checks at a "dead man's switch" service
   (healthchecks.io is free for this; Cronitor and Better Stack work the same):
   one expected **hourly** for backups, one **weekly** for the drill. Each
   gives you a URL. It emails you when the scripts STOP checking in, which is
   how a broken backup gets noticed before you need it.
9. Schedule backups and the weekly drill (`crontab -e` as `deploy`). The drill
   restores the newest OFF-SITE copy: what you'd really have after losing this server.

   ```
   15 * * * *  cd ~/ledgerly/deploy && BACKUP_UPLOAD='aws s3 cp {} s3://YOUR-BUCKET/ledgerly/' BACKUP_AGE_RECIPIENT=age1… BACKUP_HEARTBEAT_URL=https://hc-ping.com/… scripts/backup.sh >> backups/backup.log 2>&1
   40 3 * * 1  cd ~/ledgerly/deploy && f=$(aws s3 ls s3://YOUR-BUCKET/ledgerly/ | grep -o 'ledgerly-[0-9TZ]*\.dump\.age' | sort | tail -n1) && for x in "$f" "${f%.dump.age}.sha256" "${f%.dump.age}.counts.json"; do aws s3 cp "s3://YOUR-BUCKET/ledgerly/$x" /tmp/drill/; done && IMAGE_TAG=$(tail -n1 .deploy-history) BACKUP_AGE_IDENTITY=~/.ledgerly-backup-key.txt DRILL_HEARTBEAT_URL=https://hc-ping.com/… scripts/restore-drill.sh "/tmp/drill/$f" >> backups/drill.log 2>&1; rm -rf /tmp/drill
   ```

   (`mkdir -p /tmp/drill` first; adapt `aws s3` to your storage's tool.)

   **Set a lifecycle rule on the bucket that deletes objects after 14 days.** The
   Privacy page tells people that data from a deleted account leaves the backups
   "normally within 14 days"; that is only true if the bucket forgets too.

10. **Alerts by email**: `cp alertmanager/alertmanager.example.yml alertmanager/alertmanager.yml`,
    fill in your SMTP login and the address to alert (the comments say how to
    check it), then start monitoring: `dc --profile monitoring up -d prometheus alertmanager node-exporter`
    (node-exporter reports the server's disk space, see [Disk filling up](#disk-filling-up)).
    Test the whole path once: `dc stop worker`, wait ~3 minutes for a
    "LedgerlyWorkerDown" email, then `dc start worker` (a "resolved" email follows).

11. **Outside uptime check**, the one thing nothing on the server can do: if the
    whole server is down, so is Prometheus. Create an uptime monitor (the same
    service as step 8 usually offers it; UptimeRobot and Better Stack are free for
    this) for `https://SITE/healthz` and `https://SITE/api/health`, alerting your email.
    Not `/api/health/ready`: it truthfully answers 503 from a draining instance
    during every deploy.

## Email

Password resets, email confirmation, invitations and alerts are real emails, so
production needs a provider (Postmark, Amazon SES, Resend, Mailgun… all offer SMTP).

1. Create an account with the provider and **verify your sending domain**. That
   means adding the SPF and DKIM DNS records they give you, plus a DMARC record.
   Without them, Gmail and Outlook will treat Ledgerly's emails as spam.
2. In `.env`: `MAIL_DRIVER=smtp`, `SMTP_URL=smtp://USER:PASSWORD@HOST:587`,
   `MAIL_FROM=Ledgerly <no-reply@your-domain>`. Then deploy.
3. Test it: use "Forgot password?" with your own address. The worker logs one
   `account.email` job; the provider's dashboard shows the message.

The app refuses to start in production without a `MAIL_DRIVER`. `MAIL_DRIVER=log`
(no email at all) is allowed, but only when written down on purpose.

## Protecting main

GitHub can't stop a broken change from reaching `main` until you tell it to.
In the repository: **Settings → Branches → Add branch ruleset** (or "Add rule")
for `main`:

- **Require a pull request before merging.** Every change gets a reviewable diff.
- **Require status checks to pass**, and pick the four CI jobs: _Format · Lint ·
  Typecheck · Test · Build_, _End-to-end (Playwright)_, _Images · Deploy · Backup
  drill · Alerts_, _Dependency audit · Secret scan_. Also tick _require branches to
  be up to date_.
- **Block force pushes** and deletions.

From then on, work happens on a branch, CI runs on the pull request, and
**Deploy** only ever sees commits that passed everything. (Stages 11–13 were each
pushed straight to `main`, and CI was red for three stages before anyone looked.)

## Deploying

Normally you don't. Merge to `main`, and once CI is green the **Deploy** workflow
publishes images tagged with the commit and runs `scripts/deploy.sh <sha>` on the
server. To deploy by hand:

```bash
scripts/deploy.sh <commit-sha>
```

It pulls, migrates, replaces api → worker → web **one container at a time**
(new one healthy before the old one stops), smoke-tests through HTTPS, and rolls
back by itself if anything fails. `.deploy-history` lists what ran, newest last.

**Once, on a server set up before Stage 17:** the Compose project was renamed
from `ledgerly` to `ledgerly-prod` (so it can't collide with the development
stack). Data, certificates and the network keep their names, but the old
containers would keep ports 80/443. Before the first deploy after the rename,
stop them (this keeps every volume):

```bash
cd ~/ledgerly/deploy && docker compose -p ledgerly --env-file .env down   # never add -v
```

Expect about a minute of downtime while `deploy.sh` starts the new containers.

## Rolling back

```bash
tail -n 5 .deploy-history                 # what ran recently
scripts/deploy.sh <previous-sha>
```

Or in GitHub: Actions → Deploy → Run workflow, with that commit's SHA. Rolling
back code is always safe, because migrations are backwards-compatible (see [Migrations](#migrations)).
A rollback never undoes a migration.

## Failed deploy

`deploy.sh` printed `ROLLBACK FAILED`, or the site is down after a deploy.

1. What's running and is it healthy? `dc ps`
2. Why did the new version fail? `dc logs --tail 100 api web worker`
3. A migration failed with `lock timeout`: something held a table lock (a long
   query). The old version is still serving. Retry the deploy in a quiet moment.
4. Containers missing: `scripts/deploy.sh $(sed -n 'x;$p' .deploy-history)`, which redeploys
   the second-to-last version.
5. Still broken: `dc up -d --wait` starts everything at the last recorded tag.

## Migrations

Old and new code run **at the same time** during every deploy, and a rollback
runs old code against the new schema. So every migration must work with the
code before it. This is the **expand/contract** pattern:

| Change                 | Release 1 (expand)                          | Release 2 (contract, later) |
| ---------------------- | ------------------------------------------- | --------------------------- |
| Add a column           | add it **nullable** (or with a default)     | —                           |
| Rename a column        | add new column; write both; backfill        | read new only; drop old     |
| Drop a column          | stop reading/writing it                     | drop it                     |
| Make a column NOT NULL | backfill; add `CHECK … NOT VALID`; validate | `SET NOT NULL`              |
| Add an index           | `CREATE INDEX CONCURRENTLY` (own migration) | —                           |

Migrations give up after 10 s waiting for a lock (`MIGRATION_LOCK_TIMEOUT_MS`)
rather than freezing the app behind them.

## Backups

`scripts/backup.sh` writes `backups/ledgerly-<UTC>.dump` with a `.sha256` and
a `.counts.json` (exact row counts from the same snapshot), uploads them if
`BACKUP_UPLOAD` is set (the dump encrypted for `BACKUP_AGE_RECIPIENT`), checks
in at `BACKUP_HEARTBEAT_URL`, and thins the local copies (`prune-backups.sh`: every
backup for 2 days, then the first of each UTC day, nothing past 14 days; hourly
copies for 14 days would be 336 dumps on the same disk as the database). If the check-in service
emails you, look here first:

```bash
ls -lt backups | head
tail backups/backup.log
```

Backups on the same disk as the database aren't backups. Make sure the upload
works and the bucket has its own retention (and, ideally, object lock).

## Restoring

**First, prove the backup is good**: it never touches production.

```bash
scripts/restore-drill.sh backups/ledgerly-<UTC>.dump
# an off-site copy (download it with its .sha256 and .counts.json first):
BACKUP_AGE_IDENTITY=ledgerly-backup-key.txt scripts/restore-drill.sh ledgerly-<UTC>.dump.age
```

An encrypted copy restores the same way once decrypted:
`age -d -i ledgerly-backup-key.txt -o ledgerly-<UTC>.dump ledgerly-<UTC>.dump.age`.

**Then, to replace production's data** (this destroys what's there now):

```bash
scripts/backup.sh                                 # a backup of the current state, just in case
dc stop api worker web                            # nothing writes during the restore
dc exec -T postgres dropdb -U ledgerly ledgerly
dc exec -T postgres createdb -U ledgerly ledgerly
dc exec -T postgres pg_restore -U ledgerly -d ledgerly --exit-on-error --no-owner < backups/ledgerly-<UTC>.dump
scripts/deploy.sh $(tail -n1 .deploy-history)     # migrates if needed, starts everything, smoke-tests
```

Everything written after the backup is lost: that's the **RPO** (hourly backups
= up to an hour). For less, use a managed Postgres with point-in-time recovery.

## Monitoring

Prometheus isn't exposed to the internet. From your machine:

```bash
ssh -L 9090:localhost:9090 deploy@SERVER \
  'docker run --rm --network ledgerly_backend -p 127.0.0.1:9090:9090 alpine/socat TCP-LISTEN:9090,fork TCP:prometheus:9090'
```

Then open http://localhost:9090/alerts. Useful queries:

```promql
sum by (route) (rate(ledgerly_http_request_duration_seconds_count[5m]))        # traffic per route
histogram_quantile(0.95, sum by (le) (rate(ledgerly_http_request_duration_seconds_bucket{route!="/v1/events"}[5m])))
ledgerly_jobs_ready                                                             # queue depth
```

For outside-in checks, point an uptime monitor at `https://SITE/healthz` (web
liveness) and `https://SITE/api/health` (API liveness). Don't use
`/api/health/ready` for uptime: it truthfully answers 503 from a draining
instance during every deploy.

Prometheus evaluates the alert rules; **Alertmanager** emails them (setup step
10). Every alert below arrives as one email per problem, repeated every 4 hours
while it lasts, plus a "resolved" email when it ends. If you'd rather get them
in Slack or PagerDuty, add a receiver to `alertmanager/alertmanager.yml`.

One thing Prometheus can't tell you is that the whole server is down, because
it's on that server. That's what the outside uptime check above is for.

## Secrets

- **POSTGRES_PASSWORD**: change it in Postgres first
  (`dc exec postgres psql -U ledgerly -c "alter user ledgerly password '…'"`),
  then in `.env`, then `scripts/deploy.sh $(tail -n1 .deploy-history)`.
- **ENCRYPTION_KEY**: can't simply be changed. Existing 2FA secrets were encrypted
  with it. Rotating it needs a re-encryption migration; treat it as long-lived and
  guard it.
- **DEPLOY_SSH_KEY**: generate a new key, add it to the server's
  `authorized_keys`, update the GitHub secret, remove the old key.

## Account support

**"I'm locked out after too many wrong passwords."** Locks last at most 15
minutes, and a password reset lifts them immediately. To lift one by hand:

```bash
dc exec postgres psql -U ledgerly -c "delete from auth_throttles where key like '%sam@example.com'"
```

**"The reset / confirmation email never arrived."** Check the worker log for the
`account.email` job, then the provider's dashboard (bounced? marked as spam?).
Links expire: reset after 1 hour, confirmation after 48 hours. Ask the user to
request a new one; only the newest link works.

**"Delete my account."** Users can do it themselves under Settings → Security.
It's refused while they're the only owner of a household others use (they must
hand it over first). Deleting is immediate and permanent. Backups still hold
the data until they age out (14 days locally, and the bucket's lifecycle rule off-site,
which setup step 9 sets to 14 days). The Privacy page already says "normally within
14 days"; keep the two the same.

---

## Alerts

### API down

`up{job="api"}` is 0 or missing: Prometheus can't reach any API instance.

1. `dc ps api`. Is it restarting? `dc logs --tail 100 api`
2. Crash at start (`Invalid environment variables`): a bad `.env` value. Fix it,
   then `dc up -d api`.
3. Out of memory (`OOMKilled` in `docker inspect`): the server needs more RAM,
   or something leaks. Roll back if it began with a deploy.

### Worker down

Imports, emails, budget alerts and recurring transactions have **stopped**
(nothing is lost: jobs wait in the queue).

1. `dc ps worker` · `dc logs --tail 100 worker`
2. `dc up -d worker`. It picks up waiting jobs immediately.

### High error rate

More than 2% of API requests answer 5xx.

1. Did it start with a deploy? Compare with `tail .deploy-history` and the
   deploy time. If yes: **roll back first, investigate second.**
2. Which routes? `sum by (route, status_code) (rate(ledgerly_http_request_duration_seconds_count{status_code=~"5.."}[5m]))`
3. `dc logs --since 15m api | grep '"level":50'`. Each error has a `reqId`;
   users see the same id in the `x-request-id` header.
4. Database? `curl -s https://SITE/api/health/ready`

### Slow requests

p95 latency above 1 s for 10 minutes (live-update streams excluded).

1. Which route? `histogram_quantile(0.95, sum by (le, route) (rate(ledgerly_http_request_duration_seconds_bucket{route!="/v1/events"}[5m])))`
2. Database slow? `dc exec postgres psql -U ledgerly -c "select pid, now()-query_start as age, state, left(query,80) from pg_stat_activity where state <> 'idle' order by age desc limit 10"`
3. CPU? See [Event loop blocked](#event-loop-blocked).

### Database pool exhausted

Requests queue for a database connection (`ledgerly_db_pool_waiting > 0`).

1. Long-running queries holding connections: the `pg_stat_activity` query above.
2. Real growth in traffic: raise `DATABASE_POOL_MAX` (keep the sum across all
   processes below Postgres' `max_connections`, Stage 12), or add an API instance.

### Event loop blocked

A Node process spends ≥ 200 ms at a time on CPU work; every request on it waits.

1. Which process (`job` label)? Did it start with a deploy? Roll back.
2. Profile it in a copy of production (Stage 12's method).

### Job backlog

The oldest due job has waited more than 5 minutes.

1. Is the worker running? (See [Worker down](#worker-down).)
2. What's waiting? `dc exec postgres psql -U ledgerly -c "select name, count(*), min(run_at) from jobs where status='queued' and run_at<=now() group by name"`
3. Just busy (a big import)? Raise `WORKER_CONCURRENCY` in `.env` and redeploy,
   or wait.

### Jobs failing

Jobs used up their retries; their work did not happen.

1. Why? `dc exec postgres psql -U ledgerly -c "select name, last_error, finished_at from jobs where status='failed' order by finished_at desc limit 10"`
2. Fix the cause, then retry them:
   `dc exec postgres psql -U ledgerly -c "update jobs set status='queued', attempts=0, run_at=now() where status='failed' and name='<job>'"`

### Disk filling up

`LedgerlyDiskFillingUp` (under 20% free), `LedgerlyDiskAlmostFull` (under 8%), or
`LedgerlyDiskNotMonitored` (node-exporter stopped reporting, so the first two can't fire).
A full disk stops Postgres, so users see errors everywhere.

1. How full, and what is using it? `df -h /` then `sudo du -xh /var/lib/docker --max-depth=2 | sort -h | tail`
2. Backups on the same disk? `du -sh ~/ledgerly/deploy/backups`. `prune-backups.sh`
   keeps them in check; if they are large, the database is large: move backups
   off-site only, or give the server a bigger disk.
3. Old images from past deploys: `docker image prune -a --filter "until=168h"`
   (images in use are never removed).
4. Logs are capped (10 MB × 5 per container), so they are rarely the cause. Postgres
   itself growing is: `dc exec postgres psql -U ledgerly -c "select pg_size_pretty(pg_database_size('ledgerly'))"`.
5. Still tight: resize the disk. Do it before it reaches 100%: a full disk can corrupt
   what Postgres was writing.
6. `LedgerlyDiskNotMonitored`: `dc --profile monitoring ps node-exporter`, then
   `dc --profile monitoring up -d node-exporter`.
