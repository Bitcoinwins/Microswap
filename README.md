# Dust Sweeper — Solana

A mobile-friendly, non-custodial starter app for finding SPL / Token-2022 balances in a connected Solana wallet and requesting Jupiter swap orders to convert eligible tokens to SOL.

## What is implemented

- Phantom and Solflare wallet connection via Solana Wallet Adapter.
- Live SOL balance and SPL Token + Token-2022 account scan using the configured Solana RPC.
- Per-token selection and live Jupiter order requests.
- User-triggered wallet signing and Jupiter execute request.
- Separate swaps with separate approvals; no hidden batch execution.
- Responsive interface and error handling for unavailable routes.

## Important limitations

- This is an early implementation, not audited production financial software.
- The public Solana RPC has rate limits. Set `VITE_SOLANA_RPC_URL` to a reliable RPC provider before public launch.
- Jupiter's API access and authentication requirements can change. Create an API key in the Jupiter developer portal and set `VITE_JUPITER_API_KEY`, or paste a key into the page for local testing. The browser build exposes any `VITE_` value; do **not** use a privileged secret key in a public client. For production, add a server-side proxy that keeps the API key private and enforces rate limits.
- This version requests one order per token. Some dust cannot be sold because of absent liquidity, token restrictions, minimum trade size, or fees.
- It scans token accounts owned by the connected wallet only. It cannot access an internal custodial FOMO balance unless the asset can be withdrawn to a wallet the user controls.
- It does not estimate USD value or guarantee that a swap is profitable. Always inspect the wallet transaction before signing.
- The slippage selector is a UI hint in this starter; current Jupiter order routing manages execution parameters. Do not rely on the selector as a guaranteed slippage override.
- Token names/prices are not resolved; the UI displays shortened mint addresses to reduce spoofing risk.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
# Add your RPC URL and Jupiter API key to .env.local if available
npm run dev
```

Open the local URL printed by Vite. On iPhone, your development computer and phone must be on the same network to test the local server, or deploy the site to HTTPS hosting.

## Build

```bash
npm run build
npm run preview
```

The production static files are written to `dist/`.

## Deploy free on Vercel

1. Create a GitHub repository and upload this project.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
4. Add `VITE_SOLANA_RPC_URL` as an environment variable.
5. For quick testing only, you can set `VITE_JUPITER_API_KEY`. Remember that Vite environment variables are public in the built JavaScript.
6. Deploy, open the HTTPS URL on your phone, and connect Phantom or Solflare.

## Recommended production hardening

- Put Jupiter calls behind a small server-side proxy so the API key stays private; rate-limit by IP and wallet, validate parameters, and never sign transactions on the server.
- Use a paid/reliable RPC endpoint with suitable limits.
- Add transaction simulation, explicit route/fee/price-impact display, allowlists/blocklists for known malicious tokens, and robust handling for Token-2022 extensions.
- Audit dependency versions and transaction parsing; run security review before inviting public users.
- Never request or store seed phrases/private keys. Keep every swap user-approved in their wallet.

## API references

- Solana wallet connection guide: https://solana.com/developers/cookbook/wallets/connect-wallet-react
- Jupiter Swap API docs: https://dev.jup.ag/docs/swap
- Jupiter developer portal: https://portal.jup.ag/
