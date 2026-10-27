# Delegance CLI and SDK

Get commercial insurance quotes from your terminal, or from your AI coding agent.

```bash
npx -y @delegance/cli quote start --demo
```

The demo runs on sample data. It sends nothing to Delegance or to any carrier.

This repo holds the source of two npm packages:

| Folder | Package | Docs |
|---|---|---|
| [`cli/`](cli/) | [`@delegance/cli`](https://www.npmjs.com/package/@delegance/cli) | [cli/README.md](cli/README.md) |
| [`sdk/`](sdk/) | [`@delegance/sdk`](https://www.npmjs.com/package/@delegance/sdk) | [sdk/README.md](sdk/README.md) |

Full docs live at [portal.delegancebrokerage.com/docs/cli](https://portal.delegancebrokerage.com/docs/cli).

Delegance is a licensed commercial insurance brokerage. A licensed broker approves every bind before coverage starts.

The code here is a mirror of the packages as they ship. Report bugs with `npx -y @delegance/cli feedback` or open an issue. MIT licensed.
