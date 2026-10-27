# Changelog

## Versioning policy (0.x)

While the CLI is 0.x, a minor release may add commands, flags, and fields in
`--json` output. It never removes or renames one. A removal or rename waits
for a new API version date and is announced here first. A release that can no
longer work against the live API may be refused with HTTP 426 and an upgrade
command (today that list holds only 0.2.x).

## Unreleased

## 0.3.4 (unpublished)

- `delegance --help` ends with where to get help: "Need help? Email
  support@delegancebrokerage.com or run `delegance feedback`".
- The same line prints on stderr after a server error (5xx), a network
  failure, a timeout, or any error no command caught. A 4xx error still
  prints only its own fix.
- An error no command caught prints its message instead of a Node stack
  trace. Set DEBUG or VERBOSE to see the stack. Ctrl+C in a prompt exits
  130 without a message.
- `quote start` with workers' comp prints one line per insured state saying
  how workers' comp works there. In a monopolistic state such as Ohio, no
  private WC price is requested and the CLI says a broker handles it. `--json`
  output is unchanged apart from the server's additive `wcMarket` field.
- Commands that write (quote submit, bind, claims, COIs, signup) send their
  request once and no longer resend it on a server error or a timeout. If no
  answer comes back, the CLI says the command may have gone through and tells
  you to check before you run it again.
- Reads retry a 429 or 503 after the server's `Retry-After`.
- Every request names the CLI release in `X-Delegance-Client: cli/<version>`
  and the API version in `Delegance-Version: 2026-10-01`.

## 0.3.3 (2026-10-13)

- The headline reads "Best price you can bind now" and counts only quotes
  you can bind online. A cheaper quote that binds through Delegance shows on
  its own line: "Cheaper: CHUBB $2,610/yr, bind through Delegance".
- Each quoted row says how it binds: "Quoted, bind online" or "Quoted, bind
  through Delegance".
- A carrier that could not answer (an outage or server error) reads
  "Carrier unavailable, retry later" and counts as unavailable, not declined.
  This needs a server that reports the outage; an older server's rows still
  read "Declined".
- Answering No to a carrier's underwriting statement warns that the carrier
  will not quote.
- A carrier statement (a declaration such as a terrorism coverage
  disclosure) is shown in full and asked on its own: "Do you accept this
  statement?". It used to sit in the "check every statement that is TRUE for
  your business" list, where an unchecked box meant No and quietly removed
  that carrier from the quote.
- A number question with a carrier range (for example an Accounts
  Receivable limit of 25,000 to 250,000) refuses a value outside it, at the
  prompt and in an `--answers` file, instead of sending one the carrier
  declines.

## 0.3.2 (2026-10-12)

- An `--answers` file matches a carrier option the way you type it: straight
  quotes match curly ones, any dash matches a hyphen, and case and extra
  spaces are ignored. Typing `N/A - This is a "New Business"` now matches
  the carrier's curly-quote option.
- When an answer is not one of the options, the error lists each option in
  quotes, separated by ` | `, so an option with a comma inside reads as one.

## 0.3.0 (2026-10-12)

Includes the unreleased 0.2.2 changes, which never reached npm.

- `delegance signup` shows the Terms of Service, the Privacy Policy, and the
  self-directed placement summary (Terms Section 9A), then asks you to accept.
  Without a terminal, pass `--accept-terms`. The server records the version you
  accepted and the time.
- `delegance verify --accept-terms` finishes a signup started by an older CLI,
  or one whose Terms changed while it waited.
- New `delegance terms` shows the current Terms; `delegance terms accept`
  records your acceptance of the current version. A bind can require it.
- `delegance bind` prints a one-line self-directed placement notice.
  `--broker-review` binds nothing and prints how to ask a licensed broker to
  review the quote first. With `--json` it prints one JSON document.
- Against a server that has no Terms step yet, signup still works and skips
  the prompt.
- Quote results compare prices within one coverage: a "Best price per
  coverage" block replaces the single cheapest line, and real quotes print a
  bind command for each coverage's best price.
- Coverage codes print as plain names (CGL becomes General Liability). The
  table shows limits, deductible, and the coverage start date when the server
  sends them. `--json` output stays raw.
- A referred quote shows "Referred to an underwriter" or "Needs more info",
  and carrier reasons print under the table.
- `delegance bind` prints the pay-over-time offer and lender terms when
  financing is available.
- Every hint that names a command repeats the form you ran, so `npx` users
  see `npx -y @delegance/cli <cmd>`.
- Checkbox prompts say only "space to select, Enter to continue" and ignore
  the a and i keys, so one stray key cannot flip every answer.

Servers running the Terms step refuse signups from CLI 0.2.x. Update with
`npm install -g @delegance/cli@latest`.

## 0.2.1

- `--demo` uses generic carrier names.

## 0.2.0

- First public release.
