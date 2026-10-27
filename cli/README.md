# @delegance/cli

Get commercial insurance quotes from your terminal. Quote, bind, and pay; read your policies; generate certificates; quote bonds; file claims. Works from AI coding agents too.

```bash
npx -y @delegance/cli quote start --demo
```

The demo runs on sample data. It sends nothing to Delegance or to any carrier.

## Install

```bash
# Run without installing
npx -y @delegance/cli --help

# Or install globally
npm install -g @delegance/cli
delegance --version
```

Every `delegance` below is `npx -y @delegance/cli` if you did not install globally. The `-y` skips npx's "Ok to proceed?" prompt, which would hang a script or an agent.

Requires Node 20.19 or newer. Older versions cannot load the CLI's ESM-only dependencies.

## Availability

- Quoting is open to every account. Run `delegance signup` and quote the same day.
- Bind, pay, bonds, and claims are live from the terminal.
- A licensed Delegance broker approves every bind before coverage starts. A bind request never charges your card.

## Get a quote

```bash
# 1. Sign up. We email you a confirm link; the key lands in ~/.delegance/credentials.
delegance signup

# 2. Quote general liability and workers comp. Answer the carriers' questions.
delegance quote start --coverage gl,wc

# 3. Request a bind on the offer you want. A broker approves it.
delegance bind <submission-id> <offer-id>

# 4. Pay once the broker approves the bind.
delegance pay
```

What happens at each step:

- **Signup** creates your company, emails a confirm link, and waits for the click. It then stores a new API key in `~/.delegance/credentials` (mode 600). If you stop it with Ctrl-C, `delegance verify` resumes.
- **Quoting** asks the carriers' underwriting questions in the terminal. Answers we already know from your account are filled in for you to confirm. Yes/no questions come as one checklist: space to select, Enter to continue.
- **No instant carrier?** The CLI asks the few application questions a broker needs and hands the request to a Delegance broker, who places it with a market that quotes by hand. Ctrl-C stops the questions and sends what you answered.
- **Binding** files a request. A Delegance broker approves it, and you get an email when payment is ready.
- **Paying** opens a Stripe checkout link.

Coverages for `--coverage`: `gl`, `wc`, `bop`, `cyber`, `pl` (E&O), `auto`, `property`, `umbrella`.

### What a quote looks like

```
Coverage starts Nov 1, 2026
Best price per coverage:
  General Liability   Carrier A   $612/yr
  Workers' Comp       Carrier C   $1,184/yr

  Carrier    Coverage           Premium/yr  Limits                               Deductible  Status    Offer
  ─────────  ─────────────────  ──────────  ───────────────────────────────────  ──────────  ────────  ──────
  Carrier A  General Liability  $612        $1M per occurrence / $2M aggregate   $500        Quoted    demo-1
  Carrier B  General Liability  $748        $1M per occurrence / $2M aggregate   $1,000      Quoted    demo-2
  Carrier C  Workers' Comp      $1,184      Statutory / $1M employers liability  None        Quoted    demo-3
  Carrier D  Workers' Comp      -           -                                    -           Declined  demo-4

3 of 4 carriers priced.
```

That table is the `--demo` sample. A real quote names the carriers. The best price is per coverage: a GL premium is never compared with a WC one. A real quote prints one bind command per coverage. `-` means the carrier did not send that field.

## Sign in on an existing account

```bash
delegance auth login
```

It opens the portal, you approve the terminal there, and the key lands in `~/.delegance/credentials`. Other ways in:

- `delegance auth login --no-browser` prints the approval link instead of opening a browser.
- `delegance auth login --key <key>` stores a key you created in the portal.
- `DELEGANCE_API_KEY=<key>` overrides the stored key for one shell.

Keys from `signup` and `auth login` expire after 90 days without use. `delegance auth status` shows the date; `delegance auth refresh` extends it.

## Use it from an AI agent

Claude Code, Codex, Gemini CLI, or any coding agent can run the CLI. Open the agent in a folder with your insurance documents and ask it to get you a quote with `npx -y @delegance/cli`.

How the CLI behaves without a terminal:

- It never waits on a prompt. With no TTY and no `--answers` file, `quote start` exits 1 with "No terminal to ask the questions in."
- `--json` without `--answers` prints the session and its questions as JSON, then stops: `{ "submissionId", "sessionVersion", "questions": [...] }`.
- `signup` without a TTY needs every field as a flag: `--email --business --first --last --industry --size --street --city --state --zip`.
- `auth login` prints the approval link; a person approves it in the browser.
- Exit code `0` means success; `1` means an error. Errors print the server trace id.
- In `--json` mode stdout stays parseable. Progress and hints go to stderr.

The scripted quote flow:

```bash
# 1. Start the session and save the questions
npx -y @delegance/cli quote start --coverage gl --json > session.json

# 2. Write answers.json (keys are question ids), then file it
npx -y @delegance/cli quote submit "$(jq -r .submissionId session.json)" \
  --session-version "$(jq -r .sessionVersion session.json)" \
  --answers answers.json --idempotency-key "gl-$(date +%Y%m%d)" --json

# 3. Read premiums later
npx -y @delegance/cli quote status <submission-id> --wait --json
```

Or do it in one call when you already know the question ids: `quote start --coverage gl --answers answers.json --json`.

`answers.json` format:

```json
{
  "annual_revenue": 850000,
  "employees": 6,
  "delivery": "no",
  "claims_5y": "0"
}
```

- Keys are question `id`s from the session.
- `yes_no` takes `"yes"` or `"no"`. `number`, `currency`, `percentage` take a number. `select` takes one option `value`. Other types take text.
- A question you leave out uses its `prefill` (data from your own account). A `suggested` value is a guess and counts only if you send it.
- `showIf` hides a follow-up until its parent answer matches. A hidden question is never required; `requiredIfShown` makes it required while visible.
- `quote start --answers` checks every answer first and lists every problem at once, with the valid question ids.
- Reuse the same `--idempotency-key` on a retry of `quote submit`, so a lost response never files twice.
- A `quote submit` for coverage that already has a request with carriers exits 1 with `active_request_exists`. To close that request and re-quote, re-run the same submit with `--replace` and a new idempotency key (or none). Running `quote start --replace` alone does not re-quote in this flow: it only starts a fresh session.

When the submit result is `no_carriers`, hand it to a broker:

```bash
npx -y @delegance/cli quote handoff <submission-id> --answers acord-answers.json --json
```

Without `--answers` (and no TTY) the request goes to the broker as is, and the broker emails for what is missing.

If something fails, report it with the context attached (command name, exit code, trace id, versions; never the arguments):

```bash
npx -y @delegance/cli feedback "quote submit hung on the delivery question" --include-last
```

## Coverage you already have

```bash
delegance onboarding status
delegance doc upload "./policies/*.pdf" --type policy --wait
delegance policy list
delegance policy expiring 60
delegance coi generate --interactive
delegance ask "Does my GL policy cover products liability?"
```

## Commands

| Command | What it does |
|---------|--------------|
| `signup` / `verify` | Create an account and collect an API key from the terminal |
| `auth` | Log in (browser approval or key), status, whoami, refresh, log out |
| `quote` | Instant quotes: `quote start`, `quote submit`, `quote status`, `quote handoff` |
| `bind` | Request a bind on one offer; a broker approves it |
| `pay` | List payment requests and open a Stripe checkout link |
| `billing` | What you owe and what you paid |
| `bond` | Surety bond quotes; you buy on the surety's own page |
| `claim` | File and track claims |
| `policy` | List policies, show one policy, list what expires soon |
| `coi` | Generate and list certificates of insurance |
| `doc` | Upload documents, check extraction, reprocess, archive |
| `sov` | Upload and track schedules of values |
| `ask` / `chat` | Ask the Orin assistant about your coverage |
| `knowledge` | Search notecards and read the facts extracted from a document |
| `appetite` | Match a business to the carriers that will write it |
| `lead` | Send a prospect business to Delegance |
| `onboarding` | Show setup status, send the verification email, wait for a state |
| `company` | Show your company and set the default |
| `feedback` / `bug` | Report a bug, an idea, or a question |
| `usage` | Billing-period usage, daily usage, rate limits |
| `keys` | List and create API keys, rotate by replacement |
| `config` | Local settings and profiles |

Every command and flag, generated from the CLI itself: [portal.delegancebrokerage.com/docs/cli/commands](https://portal.delegancebrokerage.com/docs/cli/commands). Run `delegance <command> --help` for the same list offline.

`quote request`, `quote list`, `quote get`, `quote wait`, and `quote cancel` belong to the legacy partner queue. Submission there is not live; use `quote start`.

### Bonds and claims

```bash
delegance bond quote --state TX --bond "notary"
delegance bond answer <session-id> --answers bond-answers.json
delegance bond status <session-id>

delegance claim file --description-file what-happened.txt --date 2026-10-01
delegance claim list
```

Filing a claim needs a key with the `claims:write` scope. Keys from `signup` and `auth login` carry it for owners and admins. The first time, accept the claims disclaimer in the portal; nobody can accept it for you.

### Carrier checkout (fast bind)

`delegance bind` also takes `--attest`, `--step-up <id>`, and `--code <code>` for fast bind: you confirm the application answers, and we email a 6-digit code. Fast bind into the carrier's own checkout is not open yet. Until it is, every bind goes to a broker for approval.

## API keys

- A key belongs to one company. Every command acts on that company. Naming another company's id fails with 403 `company_mismatch`.
- A new key expires in 90 days unless you pick another expiry with `--expires-in-days`.
- A key with `write`, `admin`, or `claims:write` must expire within 365 days. `--expires-in-days never` works only for a read-only key.
- `claims:write` can be created only while signed in to the portal.
- Delegance staff accounts cannot create client keys.
- `appetite match` needs `appetite:read`, which neither `read` nor `write` includes.
- `delegance keys revoke` needs a signed-in portal session. `delegance keys rotate` creates the replacement key and tells you where to revoke the old one.

```bash
delegance keys create "appetite checks" --scopes read,appetite:read --expires-in-days 90
```

## Limits

| Limit | What you see |
|-------|--------------|
| Quote starts per key per day | 429 `quote_limit_reached` |
| Per-key daily AI budget | 429 `api_key_budget_exhausted` |
| Delegance-wide daily API AI budget | 429 `api_budget_exhausted` (try again in an hour) |
| Requests per minute | 429; `delegance usage limits` shows where you stand |

The CLI does not retry a 429. Wait and run the command again.

## Configuration

The API key lives only in `~/.delegance/credentials` (mode 600). Other settings live in `~/.config/delegance-nodejs/config.json` (mode 600), which holds a masked hint of the key and never the key itself.

| Variable | Description |
|----------|-------------|
| `DELEGANCE_API_KEY` | API key. Takes precedence over the stored key |
| `DELEGANCE_BASE_URL` | API base URL (default: `https://portal.delegancebrokerage.com`) |
| `DEBUG` | Debug output |
| `VERBOSE` | Verbose output |

## Examples

### Bulk upload

```bash
delegance doc upload "./inbox/*.pdf" --wait --type policy

# Tag each file with your own id
for file in ./inbox/*.pdf; do
  delegance doc upload "$file" --external-id "$(basename "$file" .pdf)"
done
```

### Appetite check

```bash
delegance appetite match --state CA --industry "commercial bakery" \
  --coverage general_liability,workers_comp
```

## Developing in the monorepo

Inside the monorepo the CLI resolves the SDK from the sibling source (`"@delegance/sdk": "file:../sdk"`). Build the SDK first:

```bash
cd sdk && npm ci && npm run build
cd ../cli && npm ci && npm run build && npm test
```

`npm pack` and `npm publish` rewrite that dependency to `^<sdk version>` on their own (`scripts/sdk-dep.cjs`, run from the `prepack`, `postpack`, and `postpublish` hooks), so the tarball and the registry both carry a semver range.

## Support

- Docs: https://portal.delegancebrokerage.com/docs/cli
- Email: support@delegancebrokerage.com
