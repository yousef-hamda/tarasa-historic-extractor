# Facebook account-safety guide

This document explains the anti-detection changes shipped in the code (**Part A**)
and the free hosting move that gives the automation an **Israeli IP** (**Part B**),
so the account is far less likely to be flagged again.

> ⚠️ **No setup makes Facebook automation zero-risk.** Automating a personal
> account is against Facebook's ToS and always carries some risk. These steps
> take it from *"almost certain to be flagged"* to *"low risk."*

---

## Why the account was disabled (summary)

- **Messaging was never the cause here** — 0 messages were ever sent (verified in
  the DB). But automated cold DMs to non-friends *would* get the account banned,
  so messaging is now hard-locked off.
- The disable + "prove you're human" checkpoints came from the **automation
  looking like a bot**: a US/EU **datacenter IP** (Railway) under an **Israeli
  account** (impossible travel), a default **headless fingerprint** with the
  `navigator.webdriver` automation flag, and **auto-joining groups**.

---

## Part A — What changed in the code (free, already done)

| Change | Effect |
|---|---|
| One consistent **Israel identity** (UA / timezone / locale / geo / Accept-Language) on every browser context | Browser story matches the account's home region; no macOS-UA-on-Linux contradiction |
| `ignoreDefaultArgs: ['--enable-automation', ...]` on launch | Removes the `navigator.webdriver` bot tell without the (detectable) JS override hack |
| **Auto-join removed** | Scraper never clicks "Join group" — you join manually, once |
| Default cadence → **conservative** + **randomized gap between groups** | No robotic back-to-back bursts; well under FB's tolerance |
| **`MESSAGING_HARD_DISABLED=true`** kill switch | Cold DMs can't be sent even if the dashboard toggle is flipped |
| Optional **`PROXY_SERVER`** passthrough | Ready to route through an Israeli proxy if you ever add one |

New env vars are documented in `.env.example` (Anti-detection section). All have
safe defaults — you don't need to set any of them for Part A to work.

### Current safe state
- All groups are **soft-disabled** → the scraper contacts Facebook **0 times**.
- Messaging is **hard-disabled**.
- Nothing touches Facebook until you **re-enable groups** (Groups page → re-add)
  *after* the account is restored and ideally on an Israeli IP (Part B).

---

## Part B — Free Israeli IP: move hosting to Oracle Cloud (Always Free, Israel region)

Railway has no Israel region, so its IP will always mismatch the account. Oracle
Cloud's **Always Free** tier offers a VM in the **Israel Central (Jerusalem)**
region — a free, always-on, Israeli IP. It's still a *datacenter* IP (so risk is
"low," not "zero"), but it removes the country/impossible-travel mismatch, which
is the biggest signal.

### Steps

1. **Create an Oracle Cloud account** at <https://www.oracle.com/cloud/free/>.
   - A credit card is required for identity verification only — **Always Free
     resources are never charged.**
   - **At signup, choose your home region = Israel Central (Jerusalem).** This
     cannot be changed later and determines your IP's country.

2. **Create an "Always Free" VM instance.**
   - Shape: **Ampere A1 (ARM)** — pick the free allocation (e.g. 1–2 OCPU /
     6–12 GB RAM). This is plenty for the app + Chromium + Postgres + Redis.
   - Image: **Ubuntu 22.04** (or Oracle Linux).
   - If you hit "out of capacity," retry over a few hours/days or try a smaller
     Ampere allocation — free ARM capacity fluctuates.
   - Add an SSH key so you can log in.

3. **Open the firewall** for your dashboard port (e.g. 4000) in the instance's
   VCN **Security List / Network Security Group**, and run `sudo iptables`/`ufw`
   accordingly (Oracle images often need the OS firewall opened too).

4. **Install Docker + Docker Compose** on the VM:
   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
   sudo usermod -aG docker $USER   # re-login after this
   ```

5. **Clone the repo and bring up the stack** (the repo already has a
   `docker-compose.yml` with app + Postgres + Redis):
   ```bash
   git clone <your repo url> tarasa && cd tarasa
   cp .env.example .env
   # edit .env: set DATABASE_URL/REDIS to the compose services, OPENAI_API_KEY,
   # SITE_PASSWORD, and copy your existing FB cookies in via the dashboard later.
   docker compose up -d --build
   ```
   The Docker image is multi-arch and Playwright installs the **arm64** Chromium
   automatically, so it runs natively on the Ampere ARM VM.

6. **Point your domain** (`tarasa-history.com`) at the Oracle VM's public IP
   (DNS A record), or just use the IP for now.

7. **Restore the Facebook session** from the dashboard (cookie upload / renew),
   **re-enable your groups**, and leave the speed on **conservative**.

8. **Decommission Railway** once Oracle is confirmed working (so you're not
   running two instances against the same account from two IPs — that itself is
   impossible-travel).

### Verify the IP is Israeli
```bash
curl -s https://ipinfo.io/json   # run ON the Oracle VM; "country" should be IL
```

---

## Optional — the paid upgrade (only if you want the lowest risk)

A datacenter IP (even Israeli) is still detectable. The lowest-risk setup is an
**Israeli mobile/residential proxy** (~$15–80/mo). If you get one, you don't even
need to move off Railway — just set on the host:
```
PROXY_SERVER=socks5://user:pass@israeli-proxy-host:port
# or split creds:
PROXY_SERVER=http://israeli-proxy-host:port
PROXY_USERNAME=...
PROXY_PASSWORD=...
```
and set `FB_TIMEZONE`/`FB_LOCALE` to match. The code already routes all browser
traffic through `PROXY_SERVER` when set.

---

## Golden rules going forward

1. **Never re-enable messaging** in its cold-DM form. To collect stories,
   post the submission link *in the group* (with admin permission) and let
   people come to you — that's compliant.
2. **Keep speed on conservative.** Faster presets exist but raise risk.
3. **One IP, one location, one story** — IP country, browser timezone/locale,
   and the account's history should all say "Israel."
4. **A second strike is permanent** (per the appeal screen). When in doubt,
   keep groups disabled.
