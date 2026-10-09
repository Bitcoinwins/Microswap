import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Buffer } from "buffer";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { RefreshCw, ArrowDownUp, ShieldCheck, ExternalLink, AlertTriangle, Coins, Wallet, CheckCircle2 } from "lucide-react";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_API = "https://api.jup.ag/swap/v2";
const fmt = (n, digits=6) => Number(n).toLocaleString(undefined,{maximumFractionDigits:digits});
const short = (s) => s ? `${s.slice(0,4)}…${s.slice(-4)}` : "";
const amountRaw = (uiAmount, decimals) => BigInt(Math.floor(Number(uiAmount) * (10 ** decimals))).toString();

export default function App() {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction, sendTransaction } = useWallet();
  const [tokens, setTokens] = useState([]);
  const [sol, setSol] = useState(0);
  const [selected, setSelected] = useState({});
  const [quotes, setQuotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_JUPITER_API_KEY || "");
  const [slippage, setSlippage] = useState("100");

  const request = useCallback(async (url, options={}) => {
    const headers = {...(options.headers || {})};
    if (apiKey.trim()) headers["x-api-key"] = apiKey.trim();
    const response = await fetch(url, {...options, headers});
    const body = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status}). Check Jupiter API access/key.`);
    return body;
  }, [apiKey]);

  const loadBalances = useCallback(async () => {
    if (!publicKey) { setTokens([]); setSol(0); return; }
    setLoading(true); setError(""); setNotice("");
    try {
      const [lamports, accounts] = await Promise.all([
        connection.getBalance(publicKey, "confirmed"),
        connection.getParsedTokenAccountsByOwner(publicKey, {programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")}, "confirmed")
      ]);
      setSol(lamports / LAMPORTS_PER_SOL);
      const parsed = accounts.value.map(({pubkey, account}) => {
        const info = account.data.parsed.info;
        const t = info.tokenAmount;
        return { account: pubkey.toBase58(), mint: info.mint, amount: Number(t.uiAmountString || 0), raw: t.amount, decimals: t.decimals };
      }).filter(t => t.amount > 0 && t.mint !== SOL_MINT);
      // Include Token-2022 balances too.
      const token2022 = await connection.getParsedTokenAccountsByOwner(publicKey, {programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")}, "confirmed").catch(()=>({value:[]}));
      const extra = token2022.value.map(({pubkey,account}) => {
        const info = account.data.parsed.info; const t = info.tokenAmount;
        return {account:pubkey.toBase58(),mint:info.mint,amount:Number(t.uiAmountString||0),raw:t.amount,decimals:t.decimals};
      }).filter(t=>t.amount>0 && t.mint!==SOL_MINT);
      const all = [...parsed, ...extra];
      setTokens(all);
      setSelected(Object.fromEntries(all.map(t=>[t.mint, false])));
      setQuotes({});
    } catch (e) { setError(`Could not load balances: ${e.message}`); }
    finally { setLoading(false); }
  }, [publicKey, connection]);

  useEffect(()=>{ loadBalances(); }, [loadBalances]);

  const selectedTokens = useMemo(()=>tokens.filter(t=>selected[t.mint]),[tokens,selected]);
  const getQuote = async (token) => {
    if (!apiKey.trim()) throw new Error("Add your Jupiter API key below to request live quotes.");
    const url = new URL(`${JUPITER_API}/order`);
    url.searchParams.set("inputMint", token.mint);
    url.searchParams.set("outputMint", SOL_MINT);
    url.searchParams.set("amount", token.raw);
    url.searchParams.set("taker", publicKey.toBase58());
    const q = await request(url.toString());
    if (!q.outAmount || !q.transaction || !q.requestId) throw new Error(q.error || "No executable route for this token.");
    return {...q, mint:token.mint, outputSol:Number(q.outAmount)/LAMPORTS_PER_SOL};
  };
  const quoteSelected = async () => {
    if (!connected || !publicKey) { setError("Connect your wallet first."); return; }
    if (!selectedTokens.length) { setError("Select at least one token."); return; }
    setBusy(true); setError(""); setNotice(""); setQuotes({});
    const next = {};
    for (const token of selectedTokens) {
      try { next[token.mint] = { ...(await getQuote(token)), status:"quoted" }; }
      catch(e) { next[token.mint] = { status:"failed", error:e.message }; }
      setQuotes({...next});
    }
    setBusy(false);
  };

  const executeSwap = async (token) => {
    const quote = quotes[token.mint];
    if (!quote || quote.status!=="quoted") return;
    if (!apiKey.trim()) { setError("Jupiter API key is required."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      // The order transaction is only signed in the wallet after this explicit user click.
      const tx = VersionedTransaction.deserialize(Buffer.from(quote.transaction, "base64"));
      const signed = await signTransaction(tx);
      const response = await request(`${JUPITER_API}/execute`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ signedTransaction: Buffer.from(signed.serialize()).toString("base64"), requestId:quote.requestId })
      });
      if (response.status !== "Success" && !response.signature) throw new Error(response.error || response.message || "Swap execution was not confirmed.");
      setNotice(`Swap submitted: ${response.signature || "confirmed by Jupiter"}`);
      setQuotes(old=>({...old,[token.mint]:{...old[token.mint],status:"done",signature:response.signature}}));
      await loadBalances();
    } catch(e) { setError(`Swap failed or was cancelled: ${e.message}`); }
    finally { setBusy(false); }
  };

  const executeAll = async () => {
    const ready = selectedTokens.filter(t=>quotes[t.mint]?.status==="quoted");
    if (!ready.length) { setError("Get quotes first."); return; }
    setError("");
    for (const token of ready) {
      // Each token is a separate wallet-approved swap, not a hidden batch.
      await executeSwap(token);
    }
  };

  const explorer = (mint) => `https://solscan.io/token/${mint}`;
  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-icon"><ArrowDownUp size={21}/></span><span>DUST<span className="green">SWEEPER</span><small>SOLANA RECOVERY TOOL</small></span></a>
      <WalletMultiButton className="wallet-button" />
    </header>

    <section className="hero">
      <div className="eyebrow"><span className="pulse"/> NON-CUSTODIAL · SOLANA MAINNET</div>
      <h1>Turn leftover tokens<br/><span>back into SOL.</span></h1>
      <p className="lead">Find eligible token balances, preview live swap routes, and approve every transaction in your own wallet.</p>
      <div className="safety"><ShieldCheck size={17}/> Your private keys never leave your wallet. No seed phrase requested.</div>
    </section>

    {!apiKey.trim() && <section className="api-warning"><AlertTriangle size={19}/><div><b>Jupiter API key needed for live quotes</b><p>Get an API key from Jupiter's developer portal and enter it below. Balance scanning works without it, subject to RPC limits.</p></div></section>}
    <section className="stats">
      <article className="stat"><span className="stat-label"><Wallet size={15}/> WALLET SOL</span><strong>{connected ? `${fmt(sol,5)} SOL` : "—"}</strong><small>{connected ? short(publicKey?.toBase58()) : "Connect to begin"}</small></article>
      <article className="stat"><span className="stat-label"><Coins size={15}/> TOKEN BALANCES</span><strong>{connected ? tokens.length : "—"}</strong><small>Non-zero SPL / Token-2022</small></article>
      <article className="stat"><span className="stat-label"><CheckCircle2 size={15}/> SELECTED</span><strong>{selectedTokens.length}</strong><small>Eligible routes vary</small></article>
    </section>

    <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">01 / YOUR ASSETS</div><h2>Token balances</h2></div><button className="icon-btn" onClick={loadBalances} disabled={!connected||loading}><RefreshCw size={16} className={loading?"spin":""}/> Refresh</button></div>
      {!connected ? <div className="empty"><Wallet size={28}/><b>Connect your Solana wallet</b><p>Use Phantom or Solflare to load balances from mainnet.</p></div> : loading ? <div className="empty"><RefreshCw className="spin"/><p>Reading token accounts…</p></div> : tokens.length===0 ? <div className="empty"><Coins size={28}/><b>No non-zero token balances found</b><p>Make sure your wallet is on Solana mainnet.</p></div> : <>
        <div className="token-list">
          {tokens.map(t=><label className={`token-row ${selected[t.mint]?"chosen":""}`} key={t.account}>
            <input type="checkbox" checked={!!selected[t.mint]} onChange={e=>setSelected(s=>({...s,[t.mint]:e.target.checked}))}/>
            <span className="token-icon">{t.mint.slice(0,2).toUpperCase()}</span>
            <span className="token-main"><b>{short(t.mint)}</b><small>{fmt(t.amount,8)} tokens · {t.decimals} decimals</small><a href={explorer(t.mint)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>View token <ExternalLink size={11}/></a></span>
            <span className="token-right"><b>{quotes[t.mint]?.status==="quoted" ? `≈ ${fmt(quotes[t.mint].outputSol,6)} SOL` : quotes[t.mint]?.status==="done" ? "Swapped" : "—"}</b><small>{quotes[t.mint]?.status==="failed" ? "No route" : "Quote not loaded"}</small></span>
          </label>)}
        </div>
        <div className="panel-actions"><span className="muted">{selectedTokens.length} token(s) selected</span><button className="primary" onClick={quoteSelected} disabled={busy||!selectedTokens.length}>{busy?"Working…":"Get live quotes"} <ArrowDownUp size={16}/></button></div>
      </>}
    </section>

    {selectedTokens.length>0 && <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">02 / SWAP PREVIEW</div><h2>Review routes</h2></div><span className="pill">Output: SOL</span></div>
      <div className="slippage-row"><label htmlFor="slippage">Slippage tolerance</label><select id="slippage" value={slippage} onChange={e=>setSlippage(e.target.value)}><option value="50">0.5%</option><option value="100">1.0%</option><option value="300">3.0%</option></select></div>
      <p className="muted small">Quotes use Jupiter's order endpoint. Slippage is controlled by the routing provider where supported; confirm details in your wallet before signing.</p>
      {selectedTokens.map(t=>{const q=quotes[t.mint];return <div className="quote-row" key={t.account}><div><b>{short(t.mint)} → SOL</b><small>{fmt(t.amount,8)} tokens</small>{q?.status==="failed"&&<small className="red">{q.error}</small>}{q?.signature&&<a target="_blank" rel="noreferrer" href={`https://solscan.io/tx/${q.signature}`}>View transaction <ExternalLink size={11}/></a>}</div><div className="quote-right">{q?.status==="quoted"?<><b>≈ {fmt(q.outputSol,7)} SOL</b><button className="small-primary" onClick={()=>executeSwap(t)} disabled={busy}>Approve & swap</button></>:q?.status==="done"?<span className="green">Complete</span>:q?.status==="failed"?<span className="red">Unavailable</span>:<span className="muted">Quote pending</span>}</div></div>})}
      <div className="panel-actions"><span className="muted small">Each swap requires a separate wallet approval.</span><button className="primary" onClick={executeAll} disabled={busy||!selectedTokens.some(t=>quotes[t.mint]?.status==="quoted")}>Swap quoted tokens</button></div>
    </section>}

    <section className="panel settings">
      <div className="eyebrow">CONFIGURATION</div><h2>Live swap access</h2>
      <p className="muted">Jupiter's API may require a key for live orders. For a public deployment, configure the key through your hosting provider's environment variables rather than publishing it in source code.</p>
      <label className="field-label" htmlFor="jupkey">Jupiter API key (optional until quotes)</label>
      <input id="jupkey" className="api-input" type="password" autoComplete="off" placeholder="Paste API key for this session" value={apiKey} onChange={e=>setApiKey(e.target.value)}/>
      <small className="muted">This input is held in page memory only and is not saved. For production, use a server-side proxy to protect API keys and rate limits.</small>
    </section>

    {(error||notice)&&<div className={error?"message error":"message success"}>{error?<AlertTriangle size={18}/>:<CheckCircle2 size={18}/>}<span>{error||notice}</span>{notice&&notice.startsWith("Swap submitted:")&&<a href={`https://solscan.io/tx/${notice.split(": ").slice(1).join(": ")}`} target="_blank" rel="noreferrer">Explorer</a>}</div>}
    <footer><div className="footer-brand">DUST<span className="green">SWEEPER</span></div><p>Experimental software. Swap routes may be unavailable, illiquid, or uneconomical. Always verify mint addresses, token amounts, fees, and transaction details in your wallet.</p><p>Never share your seed phrase. This app does not custody funds or guarantee recovery of dust.</p></footer>
  </main>;
}