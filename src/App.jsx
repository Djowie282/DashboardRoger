import { useState, useEffect, useRef, useCallback } from "react";
import {
  ComposedChart, AreaChart, Area, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";

// ─── Tokens ───────────────────────────────────────────────────────
const BG="#09090c",CARD="#111216",LINE="rgba(255,255,255,.07)",DIM="rgba(255,255,255,.28)";
const GOLD="#d4a853",GREEN="#3ecf8e",RED="#f06070",AMBER="#f59e0b",BLUE="#5b9cf6",PURPLE="#9b87f5";
const MONO="'DM Mono',monospace",SANS="'Syne',sans-serif";
const COLS=["#d4a853","#5b9cf6","#3ecf8e","#9b87f5","#f0a050","#ec4899","#14b8a6","#f06070","#6366f1","#84cc16","#22d3ee","#a78bfa","#fb7185","#f59e0b"];
const STORAGE_KEY="portfolio_dashboard_v2";

// Twelve Data symbol overrides for non-US exchanges
const TD_MAP = { SIVE:"SIVE:XSTO", VWCE:"VWCE:XETRA", WEBN:"WEBN:IBIS2" };

// ─── Default / example data ────────────────────────────────────────
const EXAMPLE = {
  snapshot:"Jan 1, 2025 · Example",
  twr:0, api_key:"", last_price_update:null,
  nav:{total:0,prior:0,cash:0},
  fx:{usd:0.92},
  currency:{base:"EUR",symbol:"€"},
  positions:[
    {id:1,sym:"AAPL",name:"Apple Inc.",        qty:50,  px:195.00,cost:8200, ccy:"USD",earnings:"",pt:220, thesis:"Big Tech core hold.",td_sym:""},
    {id:2,sym:"NVDA",name:"NVIDIA Corp.",       qty:20,  px:875.00,cost:9000, ccy:"USD",earnings:"",pt:1100,thesis:"AI infrastructure.",   td_sym:""},
    {id:3,sym:"MSFT",name:"Microsoft Corp.",    qty:30,  px:415.00,cost:10500,ccy:"USD",earnings:"",pt:480, thesis:"Cloud + AI moat.",     td_sym:""},
  ],
  realized:[
    {id:1,sym:"AMZN",desc:"Amazon partial exit",pnl:1200},
    {id:2,sym:"META",desc:"Meta — sold too early",pnl:-400},
  ],
  watchlist:[
    {id:1,sym:"TSM",name:"Taiwan Semiconductor",px:160,ccy:"USD",pt:210,thesis:"World's best fab. Geopolitical risk."},
  ],
  deposits:[
    {id:1,date:"2024-01-01",amount:10000,desc:"Initial deposit"},
    {id:2,date:"2024-06-01",amount:5000, desc:"Top-up"},
  ],
  history:[],
};

// ─── Helpers ──────────────────────────────────────────────────────
const r2   = n => +parseFloat(n||0).toFixed(2);
const fmtN = (n,d=0) => Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtM = (sym,n,d=0) => (n<0?"−":"")  +sym+fmtN(n,d);
const fmtS = (sym,n,d=0) => (n<0?"−":"+")+  sym+fmtN(n,d);
const fmtP = (n,d=1) => (n>=0?"+":"")+n.toFixed(d)+"%";
const fmtDateShort = d => { if(!d)return""; return new Date(d).toLocaleDateString("en-US",{day:"numeric",month:"short",year:"2-digit"}); };
const fmtDateChart  = d => d?.slice(5).replace("-","/");
const cof  = n => n>=0?GREEN:RED;
const fxOf = (ccy,fx) => ccy==="USD"?fx.usd : ccy==="SEK"?(fx.sek||0) : 1;

const enrich = (positions,fx) =>
  positions.map(p=>{
    const r=fxOf(p.ccy,fx), val=r2(p.qty*p.px*r);
    return {...p,value:val,upnl:r2(val-p.cost),pxBase:r2(p.px*r)};
  }).sort((a,b)=>b.value-a.value);

const daysUntil  = d => d?Math.ceil((new Date(d)-new Date())/86400000):null;
const fmtEarnings = d => d?new Date(d).toLocaleDateString("en-US",{day:"numeric",month:"short"}):null;
const ecColor    = days => days===null?null:days<=7?RED:days<=30?AMBER:BLUE;

let uid=400;

// ─── Styles ────────────────────────────────────────────────────────
const sCard = {background:CARD,border:`1px solid ${LINE}`,borderRadius:12,overflow:"hidden"};
const sTab  = a => ({background:"none",border:"none",padding:"8px 16px",fontFamily:SANS,cursor:"pointer",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",borderBottom:a?`2px solid ${GOLD}`:"2px solid transparent",color:a?"#fff":DIM,marginBottom:-1});
const sLabel= {fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".1em",display:"block",marginBottom:5};
const sIn   = {background:"rgba(255,255,255,.06)",border:`1px solid ${LINE}`,borderRadius:6,color:"#e8e8ea",padding:"7px 10px",fontSize:12,fontFamily:MONO,outline:"none",width:"100%"};
const sInHL = {...sIn,background:"rgba(212,168,83,.07)",borderColor:"rgba(212,168,83,.22)"};
const sBtn  = p => ({background:p?GOLD:"rgba(255,255,255,.06)",border:p?"none":`1px solid ${LINE}`,borderRadius:8,padding:"8px 18px",color:p?"#09090c":"rgba(255,255,255,.6)",fontSize:12,fontWeight:p?700:400,fontFamily:SANS,cursor:"pointer"});

// ─── Price fetch via Twelve Data ───────────────────────────────────
async function fetchPrices(apiKey, positions) {
  if (!apiKey?.trim()) throw new Error("No API key — add one in Settings");
  const syms = positions.map(p => p._tdSym || TD_MAP[p.sym] || p.sym);
  const all  = [...new Set([...syms,"EUR/USD","EUR/SEK"])];
  const url  = `https://api.twelvedata.com/price?symbol=${all.join(",")}&apikey=${apiKey.trim()}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  if (data.code && data.message) throw new Error(`Twelve Data: ${data.message}`);

  const px={}, fx={};
  for (const [sym,val] of Object.entries(data)) {
    if (!val?.price) continue;
    const price=parseFloat(val.price); if(isNaN(price)) continue;
    if (sym==="EUR/USD")      fx.usd = r2(1/price);
    else if (sym==="EUR/SEK") fx.sek = parseFloat((1/price).toFixed(6));
    else { const orig=Object.entries(TD_MAP).find(([,v])=>v===sym)?.[0]||sym; px[orig]=price; }
  }
  return {px,fx};
}

// ─── UI atoms ──────────────────────────────────────────────────────
const Pill = ({v,label}) => (
  <span style={{display:"inline-block",padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,
    background:(v??0)>=0?"rgba(62,207,142,.1)":"rgba(240,96,112,.1)",color:(v??0)>=0?GREEN:RED}}>
    {label??fmtP(v??0)}
  </span>
);

const MetCard = ({lbl,val,sub,vc,accent}) => (
  <div style={{...sCard,padding:"16px 18px",borderColor:accent?"rgba(212,168,83,.2)":LINE}}>
    <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:8}}>{lbl}</div>
    <div style={{fontFamily:MONO,fontSize:19,fontWeight:500,color:vc||"#f9fafb",lineHeight:1}}>{val}</div>
    {sub&&<div style={{fontFamily:MONO,fontSize:11,color:DIM,marginTop:5}}>{sub}</div>}
  </div>
);

// Native price + base currency equivalent in brackets
const PriceDisplay = ({px,ccy,pxBase,sym}) => {
  if (ccy==="EUR") return <span style={{fontFamily:MONO}}>{sym}{px.toFixed(2)}</span>;
  if (ccy==="SEK") return <span style={{fontFamily:MONO}}>SEK {px.toFixed(2)}<span style={{fontSize:10,color:DIM}}> (≈{sym}{pxBase.toFixed(2)})</span></span>;
  return <span style={{fontFamily:MONO}}>${px.toFixed(2)}<span style={{fontSize:10,color:DIM}}> (≈{sym}{pxBase.toFixed(2)})</span></span>;
};

// ─── Earnings calendar ─────────────────────────────────────────────
function EarningsCalendar({positions}) {
  const upcoming=positions.map(p=>({sym:p.sym,date:p.earnings,days:daysUntil(p.earnings)}))
    .filter(p=>p.days!==null&&p.days>=0&&p.days<=90).sort((a,b)=>a.days-b.days);
  return (
    <div style={{...sCard,padding:"16px 18px"}}>
      <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:12}}>Earnings Calendar</div>
      {!upcoming.length
        ? <div style={{fontSize:12,color:DIM,fontStyle:"italic"}}>No earnings within 90 days</div>
        : upcoming.map((e,i)=>{const c=ecColor(e.days);return(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:i<upcoming.length-1?`1px solid ${LINE}`:"none"}}>
            <div style={{width:36,height:36,borderRadius:8,background:`${c}18`,border:`1px solid ${c}40`,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",flexShrink:0}}>
              <span style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:c,lineHeight:1}}>{e.days}</span>
              <span style={{fontSize:8,color:c,textTransform:"uppercase",letterSpacing:".06em"}}>days</span>
            </div>
            <div><div style={{fontWeight:700,fontSize:13}}>{e.sym}</div><div style={{fontSize:11,color:DIM}}>{fmtEarnings(e.date)}</div></div>
            {e.days<=7&&<span style={{marginLeft:"auto",fontSize:10,fontWeight:700,color:RED,textTransform:"uppercase"}}>Soon</span>}
          </div>
        );})}
    </div>
  );
}

// ─── NAV chart ─────────────────────────────────────────────────────
function NavChart({history}) {
  if (!history?.length||history.length<2) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:180,color:DIM,fontSize:12,flexDirection:"column",gap:6}}>
      <span style={{fontSize:24,opacity:.2}}>📈</span><span>Save multiple daily updates to build the curve</span>
    </div>
  );
  const data=history.map(h=>({date:fmtDateChart(h.date),nav:Math.round(h.nav/1000),full:h.nav}));
  const minV=Math.min(...data.map(d=>d.nav))*.98,maxV=Math.max(...data.map(d=>d.nav))*1.02;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{top:8,right:8,left:0,bottom:0}}>
        <defs><linearGradient id="navG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={GREEN} stopOpacity={.18}/>
          <stop offset="95%" stopColor={GREEN} stopOpacity={0}/>
        </linearGradient></defs>
        <XAxis dataKey="date" tick={{fill:DIM,fontSize:10,fontFamily:MONO}} axisLine={false} tickLine={false}/>
        <YAxis domain={[minV,maxV]} tick={{fill:DIM,fontSize:10,fontFamily:MONO}} axisLine={false} tickLine={false} tickFormatter={v=>`${v}K`} width={44}/>
        <Tooltip contentStyle={{background:"#1a1c22",border:`1px solid ${LINE}`,borderRadius:8,fontFamily:MONO,fontSize:12}} labelStyle={{color:DIM}} formatter={(v,_,p)=>[p.payload.full.toLocaleString("en-US"),"NAV"]}/>
        <Area type="monotone" dataKey="nav" stroke={GREEN} strokeWidth={2} fill="url(#navG)" dot={{fill:GREEN,r:3,strokeWidth:0}}/>
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── P&L Trajectory ────────────────────────────────────────────────
function PnLTrajectory({data,enriched,sym}) {
  const [showDeposits,setShowDeposits]=useState(false);
  const totalDeposited=(data.deposits||[]).reduce((s,d)=>s+d.amount,0);

  const chartData=(data.history||[]).map(h=>({
    date:h.date, label:fmtDateChart(h.date),
    total:     h.total_pnl??(h.nav-(h.deposits_total??totalDeposited)),
    unrealized:h.unrealized??0,
    realized:  h.realized??0,
  }));

  const today=new Date().toISOString().slice(0,10);
  const lastH=chartData[chartData.length-1];
  if (!lastH||lastH.date!==today) {
    const u=enriched.reduce((s,p)=>s+p.upnl,0);
    const r=(data.realized||[]).reduce((s,r)=>s+r.pnl,0);
    chartData.push({date:today,label:fmtDateChart(today)+"*",total:data.nav.total-totalDeposited,unrealized:u,realized:r});
  }

  const current=chartData[chartData.length-1]||{total:0,unrealized:0,realized:0};
  const athVal =Math.max(...chartData.map(d=>d.total),0);
  const athIdx =chartData.findIndex(d=>d.total===athVal);
  const dd=current.total-athVal, ddPct=athVal>0?(dd/athVal*100):0;
  const minDate=chartData[0]?.date||"", maxDate=chartData[chartData.length-1]?.date||"";

  const events=[
    ...(data.deposits||[]).map(d=>({date:d.date,label:`+${sym}${d.amount.toLocaleString("en-US")} ${d.desc||"Deposit"}`,color:BLUE})),
    ...(data.realized||[]).filter(r=>Math.abs(r.pnl)>1000).map(r=>({date:null,label:`${r.sym}: ${r.pnl>=0?"+":""}${sym}${Math.round(r.pnl).toLocaleString("en-US")} · ${r.desc}`,color:r.pnl>=0?GREEN:RED})),
    athIdx>=0?{date:chartData[athIdx].date,label:`ATH ${sym}${Math.round(athVal).toLocaleString("en-US")}`,color:GREEN}:null,
  ].filter(Boolean).sort((a,b)=>(a.date||"z").localeCompare(b.date||"z"));

  const depositLines=showDeposits?(data.deposits||[]).filter(d=>chartData.some(c=>c.date>=d.date)):[];

  const yFmt=v=>{const abs=Math.abs(v);return(v<0?"-":"")+sym+(abs>=1000?Math.round(abs/1000)+"K":Math.round(abs));};

  const customTip=({active,payload,label})=>{
    if(!active||!payload?.length)return null;
    return(<div style={{background:"#1a1c22",border:`1px solid ${LINE}`,borderRadius:8,padding:"10px 14px",fontFamily:MONO,fontSize:12}}>
      <div style={{color:DIM,marginBottom:6}}>{label}</div>
      {payload.map((p,i)=><div key={i} style={{color:p.color||"#fff",marginBottom:2}}>{p.name}: {sym}{Math.round(p.value).toLocaleString("en-US")}</div>)}
    </div>);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{...sCard,padding:"22px 24px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:18}}>
          <div>
            <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".14em",marginBottom:6}}>
              P&L TRAJECTORY · {chartData.length} DATA POINTS · {fmtDateShort(minDate)} → {fmtDateShort(maxDate)}
            </div>
            <div style={{fontSize:40,fontWeight:800,color:cof(current.total),letterSpacing:"-.03em",lineHeight:1,fontFamily:MONO}}>{fmtS(sym,current.total)}</div>
            <div style={{fontSize:12,color:DIM,marginTop:6}}>Total P&L · on {sym}{totalDeposited.toLocaleString("en-US")} capital</div>
          </div>
          <div style={{display:"flex",gap:24}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".1em",marginBottom:4}}>ATH</div>
              <div style={{fontFamily:MONO,fontSize:20,fontWeight:700,color:GREEN}}>{sym}{Math.round(athVal).toLocaleString("en-US")}</div>
              <div style={{fontSize:11,color:DIM}}>{chartData[athIdx]?.date?fmtDateShort(chartData[athIdx].date):""}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".1em",marginBottom:4}}>DD FROM ATH</div>
              <div style={{fontFamily:MONO,fontSize:20,fontWeight:700,color:RED}}>{fmtS(sym,dd)}</div>
              <div style={{fontFamily:MONO,fontSize:11,color:RED}}>{ddPct.toFixed(2)}%</div>
            </div>
          </div>
        </div>

        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <button onClick={()=>setShowDeposits(!showDeposits)} style={{background:showDeposits?"rgba(91,156,246,.15)":"rgba(255,255,255,.05)",border:`1px solid ${showDeposits?BLUE:LINE}`,borderRadius:6,padding:"5px 14px",color:showDeposits?BLUE:DIM,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:SANS,textTransform:"uppercase",letterSpacing:".08em"}}>
            + SHOW DEPOSITS
          </button>
        </div>

        <div style={{display:"flex",gap:20,marginBottom:14,flexWrap:"wrap"}}>
          {[{color:GOLD,dash:true,label:"Realized P&L · closed trades"},{color:PURPLE,dash:false,label:"Unrealized P&L · open positions"},{color:GREEN,dash:false,label:"Total P&L · NAV − Deposits"}].map((l,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:7,fontSize:11}}>
              <svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash?"5 3":"0"}/></svg>
              <span style={{color:"rgba(255,255,255,.55)"}}>{l.label}</span>
            </div>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{top:10,right:10,left:0,bottom:0}}>
            <defs><linearGradient id="pnlG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={GREEN} stopOpacity={.18}/>
              <stop offset="95%" stopColor={GREEN} stopOpacity={0}/>
            </linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.04)" vertical={false}/>
            <XAxis dataKey="label" tick={{fill:DIM,fontSize:10,fontFamily:MONO}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
            <YAxis tick={{fill:DIM,fontSize:10,fontFamily:MONO}} axisLine={false} tickLine={false} tickFormatter={yFmt} width={56}/>
            <Tooltip content={customTip}/>
            <ReferenceLine y={0} stroke="rgba(255,255,255,.18)" strokeWidth={1}/>
            {depositLines.map((d,i)=><ReferenceLine key={i} x={fmtDateChart(d.date)} stroke={`${BLUE}50`} strokeDasharray="4 2" label={{value:`+${sym}${(d.amount/1000).toFixed(0)}K`,position:"top",fill:BLUE,fontSize:9,fontFamily:MONO}}/>)}
            {athIdx>=0&&<ReferenceLine x={chartData[athIdx]?.label} stroke={`${GREEN}40`} strokeDasharray="3 3"/>}
            <Area type="monotone" dataKey="total"      name="Total P&L"  stroke={GREEN}  strokeWidth={2}   fill="url(#pnlG)" dot={false} activeDot={{r:4,fill:GREEN}}/>
            <Line type="monotone" dataKey="unrealized" name="Unrealized" stroke={PURPLE} strokeWidth={1.5} dot={false} activeDot={{r:3,fill:PURPLE}}/>
            <Line type="monotone" dataKey="realized"   name="Realized"   stroke={GOLD}   strokeWidth={1.5} dot={false} strokeDasharray="5 3" activeDot={{r:3,fill:GOLD}}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {events.length>0&&(
        <div style={{...sCard,padding:"16px 20px"}}>
          <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:14}}>Key Events</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
            {events.map((e,i)=>(
              <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{width:8,height:8,borderRadius:4,background:e.color,flexShrink:0,marginTop:5}}/>
                <div>{e.date&&<div style={{fontFamily:MONO,fontSize:10,color:DIM,marginBottom:2}}>{fmtDateShort(e.date)}</div>}<div style={{fontSize:12,color:"rgba(255,255,255,.7)"}}>{e.label}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {chartData.length<3&&(
        <div style={{...sCard,padding:"20px",textAlign:"center"}}>
          <div style={{fontSize:12,color:DIM,fontStyle:"italic"}}>Save daily updates to build the P&L trajectory. Add your deposit history via <strong style={{color:GOLD}}>✏ Update → Deposits</strong>.</div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD TABS
// ═══════════════════════════════════════════════════════════════════

function OverviewTab({data,enriched,lastPx,sym}) {
  const totalUpnl=enriched.reduce((s,p)=>s+p.upnl,0),totalReal=data.realized.reduce((s,r)=>s+r.pnl,0);
  const navDelta=data.nav.total-data.nav.prior,totalCost=enriched.reduce((s,p)=>s+p.cost,0);
  const topMovers=enriched.map(p=>({...p,delta:lastPx[p.sym]?((p.px-lastPx[p.sym])/lastPx[p.sym]*100):null})).filter(p=>p.delta!==null).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,6);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
        <MetCard lbl="NAV"           val={fmtM(sym,data.nav.total)}                          sub={fmtS(sym,navDelta)+" · TWR "+data.twr.toFixed(2)+"%"} vc="#f9fafb"/>
        <MetCard lbl="Equities"      val={fmtM(sym,enriched.reduce((s,p)=>s+p.value,0))}     sub={enriched.length+" positions"} vc={GOLD}/>
        <MetCard lbl="Cash"          val={fmtM(sym,data.nav.cash)}                            sub={(data.nav.total>0?(data.nav.cash/data.nav.total*100):0).toFixed(1)+"% of NAV"} vc={BLUE}/>
        <MetCard lbl="Unrealized P&L" val={fmtS(sym,totalUpnl)}                              sub={fmtP(totalCost>0?totalUpnl/totalCost*100:0)+" on cost"} vc={cof(totalUpnl)} accent/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <EarningsCalendar positions={data.positions}/>
        <div style={{...sCard,padding:"16px 18px"}}>
          <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:12}}>{topMovers.length?"Movement vs last update":"Movers"}</div>
          {topMovers.length?topMovers.map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<topMovers.length-1?`1px solid ${LINE}`:"none",fontSize:13}}>
              <span style={{fontWeight:700,minWidth:50}}>{p.sym}</span>
              <span style={{flex:1,fontSize:11,color:DIM,padding:"0 8px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
              <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontFamily:MONO,color:cof(p.delta)}}>{fmtP(p.delta)}</span><Pill v={p.delta}/></div>
            </div>
          )):<div style={{fontSize:12,color:DIM,fontStyle:"italic"}}>Save multiple updates to see movement</div>}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{...sCard,padding:"16px 18px"}}>
          <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:12}}>Top 5 unrealized</div>
          {[...enriched].sort((a,b)=>b.upnl-a.upnl).slice(0,5).map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<4?`1px solid ${LINE}`:"none",fontSize:13}}>
              <span style={{fontWeight:700,color:COLS[enriched.indexOf(p)%COLS.length]}}>{p.sym}</span>
              <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontFamily:MONO,color:GREEN}}>{fmtS(sym,p.upnl)}</span><Pill v={p.upnl/p.cost*100}/></div>
            </div>
          ))}
        </div>
        <div style={{...sCard,padding:"16px 18px"}}>
          <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:12}}>Realized YTD · net {fmtS(sym,totalReal)}</div>
          {data.realized.slice().sort((a,b)=>b.pnl-a.pnl).slice(0,6).map((r,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<5?`1px solid ${LINE}`:"none",fontSize:12}}>
              <span style={{fontWeight:700,minWidth:44}}>{r.sym}</span>
              <span style={{flex:1,fontSize:11,color:DIM,padding:"0 8px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.desc}</span>
              <span style={{fontFamily:MONO,color:cof(r.pnl)}}>{fmtS(sym,r.pnl)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PositionsTab({data,enriched,lastPx,sym}) {
  const [exp,setExp]=useState(null);
  const totalVal=enriched.reduce((s,p)=>s+p.value,0),totalCost=enriched.reduce((s,p)=>s+p.cost,0),totalUpnl=enriched.reduce((s,p)=>s+p.upnl,0);
  return (
    <div>
      <div style={{...sCard,padding:"16px 18px",marginBottom:14}}>
        <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:10}}>Allocation</div>
        <div style={{display:"flex",height:8,borderRadius:5,overflow:"hidden",gap:1,marginBottom:10}}>
          {enriched.map((p,i)=><div key={i} title={`${p.sym}: ${(p.value/totalVal*100).toFixed(1)}%`} style={{flex:p.value/totalVal,background:COLS[i%COLS.length],borderRadius:3,minWidth:2,opacity:.85}}/>)}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"4px 14px"}}>
          {enriched.map((p,i)=><span key={i} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:DIM}}><span style={{width:7,height:7,borderRadius:2,background:COLS[i%COLS.length],display:"inline-block"}}/>{p.sym} {totalVal>0?(p.value/totalVal*100).toFixed(1):0}%</span>)}
        </div>
      </div>
      <div style={{...sCard,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${LINE}`}}>
              {["Symbol","Price (native)","Δ update","Value","P&L","% gain","Target","Upside","Earnings","% NAV"].map((h,i)=>(
                <th key={i} style={{padding:"9px 10px",textAlign:i===0?"left":"right",fontSize:9,color:DIM,textTransform:"uppercase",letterSpacing:".1em",fontWeight:700,fontFamily:SANS,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {enriched.map((p,i)=>{
              const delta=lastPx[p.sym]?((p.px-lastPx[p.sym])/lastPx[p.sym]*100):null;
              const ptBase=p.pt>0?r2(p.pt*fxOf(p.ccy,data.fx)):0;
              const upside=ptBase>0?((ptBase-p.pxBase)/p.pxBase*100):null;
              const days=daysUntil(p.earnings);
              const isExp=exp===p.id;
              return (
                <>
                  <tr key={p.id} onClick={()=>setExp(isExp?null:p.id)} style={{borderBottom:isExp?`1px solid ${GOLD}40`:i<enriched.length-1?`1px solid ${LINE}`:"none",cursor:"pointer"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.015)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <td style={{padding:"10px 10px",fontWeight:700,fontSize:14,color:COLS[i%COLS.length]}}>{p.sym}</td>
                    <td style={{padding:"10px 10px",textAlign:"right"}}><PriceDisplay px={p.px} ccy={p.ccy} pxBase={p.pxBase} sym={sym}/></td>
                    <td style={{padding:"10px 10px",textAlign:"right"}}>{delta!==null?<Pill v={delta}/>:<span style={{color:DIM,fontSize:11}}>—</span>}</td>
                    <td style={{padding:"10px 10px",textAlign:"right",fontFamily:MONO,fontSize:13,fontWeight:600}}>{fmtM(sym,p.value)}</td>
                    <td style={{padding:"10px 10px",textAlign:"right",fontFamily:MONO,fontSize:12,color:cof(p.upnl),fontWeight:600}}>{fmtS(sym,p.upnl)}</td>
                    <td style={{padding:"10px 10px",textAlign:"right"}}><Pill v={p.upnl/p.cost*100}/></td>
                    <td style={{padding:"10px 10px",textAlign:"right",fontFamily:MONO,fontSize:11,color:ptBase>0?"#f9fafb":DIM}}>{ptBase>0?`${sym}${ptBase.toFixed(0)}`:"—"}</td>
                    <td style={{padding:"10px 10px",textAlign:"right"}}>{upside!==null?<Pill v={upside}/>:<span style={{color:DIM,fontSize:11}}>—</span>}</td>
                    <td style={{padding:"10px 10px",textAlign:"right"}}>{days!==null&&days>=0?<span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:ecColor(days)}}>{fmtEarnings(p.earnings)} ({days}d)</span>:<span style={{color:DIM,fontSize:11}}>—</span>}</td>
                    <td style={{padding:"10px 10px",textAlign:"right",fontFamily:MONO,fontSize:11,color:DIM}}>{data.nav.total>0?(p.value/data.nav.total*100).toFixed(1):0}%</td>
                  </tr>
                  {isExp&&(
                    <tr key={`x${p.id}`} style={{borderBottom:`1px solid ${LINE}`,background:"rgba(212,168,83,.03)"}}>
                      <td colSpan={10} style={{padding:"10px 14px"}}>
                        <div style={{display:"flex",gap:24,flexWrap:"wrap",fontSize:11}}>
                          <span style={{color:DIM}}>Qty: <span style={{color:"#e8e8ea",fontFamily:MONO}}>{p.qty.toLocaleString()}</span></span>
                          <span style={{color:DIM}}>Cost basis: <span style={{color:"#e8e8ea",fontFamily:MONO}}>{fmtM(sym,p.cost)}</span></span>
                          <span style={{color:DIM}}>Thesis: <span style={{color:p.thesis?"#e8e8ea":DIM,fontStyle:p.thesis?"normal":"italic"}}>{p.thesis||"No note"}</span></span>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{borderTop:`1px solid ${LINE}`}}>
              <td style={{padding:"10px 10px",fontWeight:700}}>Total</td><td/><td/>
              <td style={{padding:"10px 10px",textAlign:"right",fontFamily:MONO,fontWeight:700}}>{fmtM(sym,totalVal)}</td>
              <td style={{padding:"10px 10px",textAlign:"right",fontFamily:MONO,fontWeight:700,color:cof(totalUpnl)}}>{fmtS(sym,totalUpnl)}</td>
              <td colSpan={5}/>
            </tr>
          </tfoot>
        </table>
        <div style={{padding:"8px 14px",fontSize:10,color:DIM,borderTop:`1px solid ${LINE}`}}>Click a row to see qty, cost basis and thesis note</div>
      </div>
    </div>
  );
}

function PerformanceTab({data,enriched,sym}) {
  const totalUpnl=enriched.reduce((s,p)=>s+p.upnl,0),totalReal=data.realized.reduce((s,r)=>s+r.pnl,0);
  const navDelta=data.nav.total-data.nav.prior,top3=enriched.slice(0,3).reduce((s,p)=>s+p.value,0);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{...sCard,padding:"20px 22px"}}>
        <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:14}}>NAV History</div>
        <NavChart history={data.history}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:0,...sCard,padding:"18px 22px"}}>
        {[{lbl:"NAV today",v:fmtM(sym,data.nav.total),c:"#f9fafb"},{lbl:"Day change",v:fmtS(sym,navDelta),c:cof(navDelta)},{lbl:"Unrealized",v:fmtS(sym,totalUpnl),c:cof(totalUpnl)},{lbl:"Realized",v:fmtS(sym,totalReal),c:cof(totalReal)},{lbl:"TWR today",v:"+"+data.twr.toFixed(2)+"%",c:GREEN}].map((m,i)=>(
          <div key={i} style={{borderLeft:i>0?`1px solid ${LINE}`:"none",paddingLeft:i>0?20:0}}>
            <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>{m.lbl}</div>
            <div style={{fontFamily:MONO,fontSize:15,fontWeight:600,color:m.c}}>{m.v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{...sCard,padding:"16px 18px"}}>
          <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:12}}>Concentration</div>
          {[["#1 position",enriched[0]?.value??0,enriched[0]?.sym??"—"],["Top 3",top3,"of NAV"],["Top 5",enriched.slice(0,5).reduce((s,p)=>s+p.value,0),"of NAV"]].map(([lbl,v,extra],i)=>{
            const pct=data.nav.total>0?(v/data.nav.total*100):0;
            return (
              <div key={i} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
                  <span style={{color:"rgba(255,255,255,.55)"}}>{lbl} <span style={{color:DIM,fontSize:10}}>{extra}</span></span>
                  <span style={{fontFamily:MONO,color:pct>30?AMBER:"#f9fafb",fontWeight:600}}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{height:4,background:"rgba(255,255,255,.06)",borderRadius:2,overflow:"hidden"}}>
                  <div style={{width:`${Math.min(100,pct)}%`,height:"100%",background:pct>30?AMBER:GOLD,borderRadius:2}}/>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{...sCard,padding:"16px 18px"}}>
          <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".12em",marginBottom:12}}>Price target vs current</div>
          {enriched.filter(p=>p.pt>0).slice(0,6).map((p,i,arr)=>{
            const ptBase=r2(p.pt*fxOf(p.ccy,data.fx)),upside=((ptBase-p.pxBase)/p.pxBase*100);
            return (
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<arr.length-1?`1px solid ${LINE}`:"none",fontSize:12}}>
                <span style={{fontWeight:700,minWidth:50}}>{p.sym}</span>
                <div style={{flex:1,height:4,background:"rgba(255,255,255,.06)",borderRadius:2,overflow:"hidden",margin:"0 10px"}}>
                  <div style={{width:`${Math.min(100,Math.max(0,(p.pxBase/ptBase)*100))}%`,height:"100%",background:cof(upside),borderRadius:2}}/>
                </div>
                <Pill v={upside}/>
              </div>
            );
          })}
          {!enriched.filter(p=>p.pt>0).length&&<div style={{fontSize:12,color:DIM,fontStyle:"italic"}}>Add price targets via edit mode</div>}
        </div>
      </div>
    </div>
  );
}

function RealizedTab({data,sym}) {
  const sorted=[...data.realized].sort((a,b)=>b.pnl-a.pnl);
  const total=data.realized.reduce((s,r)=>s+r.pnl,0),wins=data.realized.filter(r=>r.pnl>0).reduce((s,r)=>s+r.pnl,0),losses=data.realized.filter(r=>r.pnl<0).reduce((s,r)=>s+r.pnl,0);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
        <MetCard lbl="Net realized" val={fmtS(sym,total)} vc={cof(total)}/>
        <MetCard lbl="Gains" val={fmtS(sym,wins)} vc={GREEN}/>
        <MetCard lbl="Losses" val={fmtS(sym,losses)} vc={RED}/>
      </div>
      <div style={{...sCard,padding:"14px 18px"}}>
        {sorted.map((r,i)=>(
          <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:i<sorted.length-1?`1px solid ${LINE}`:"none",fontSize:12}}>
            <span style={{fontWeight:700,minWidth:50}}>{r.sym}</span>
            <span style={{color:DIM,fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.desc}</span>
            <span style={{fontFamily:MONO,color:cof(r.pnl),minWidth:90,textAlign:"right"}}>{fmtS(sym,r.pnl)}</span>
            <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10,minWidth:44,textAlign:"center",background:r.pnl>=0?"rgba(62,207,142,.1)":"rgba(240,96,112,.1)",color:r.pnl>=0?GREEN:RED}}>{r.pnl>=0?"WIN":"LOSS"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchlistTab({data,sym}) {
  if (!data.watchlist?.length) return <div style={{...sCard,padding:"40px",textAlign:"center"}}><div style={{color:DIM,fontSize:12,fontStyle:"italic"}}>Add stocks via edit mode</div></div>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {data.watchlist.map(w=>{
        const pxBase=r2(w.px*fxOf(w.ccy,data.fx)),ptBase=w.pt>0?r2(w.pt*fxOf(w.ccy,data.fx)):0,upside=ptBase>0?((ptBase-pxBase)/pxBase*100):null;
        return (
          <div key={w.id} style={{...sCard,padding:"18px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:w.thesis?10:0}}>
              <div><span style={{fontSize:18,fontWeight:800,color:GOLD}}>{w.sym}</span><span style={{fontSize:12,color:DIM,marginLeft:8}}>{w.name}</span></div>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{textAlign:"right"}}><div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".08em"}}>Price</div><div style={{fontFamily:MONO,fontSize:14,fontWeight:600}}><PriceDisplay px={w.px} ccy={w.ccy} pxBase={pxBase} sym={sym}/></div></div>
                {ptBase>0&&<div style={{textAlign:"right"}}><div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".08em"}}>Target</div><div style={{fontFamily:MONO,fontSize:14,fontWeight:600}}>{sym}{ptBase.toFixed(2)}</div></div>}
                {upside!==null&&<Pill v={upside} label={fmtP(upside)+" upside"}/>}
              </div>
            </div>
            {w.thesis&&<div style={{fontSize:12,color:"rgba(255,255,255,.5)",lineHeight:1.6,borderTop:`1px solid ${LINE}`,paddingTop:10}}>{w.thesis}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EDIT TABS
// ═══════════════════════════════════════════════════════════════════

function EditPrices({draft,setDraft,sym,onRefresh,refreshState,refreshErr}) {
  const upd=(k,v)=>setDraft(d=>({...d,[k]:v}));
  const updNav=(k,v)=>setDraft(d=>({...d,nav:{...d.nav,[k]:r2(v)}}));
  const updFx=(k,v)=>setDraft(d=>({...d,fx:{...d.fx,[k]:parseFloat(v)||0}}));
  const updPx=(id,v)=>setDraft(d=>({...d,positions:d.positions.map(p=>p.id===id?{...p,px:r2(v)}:p)}));
  const enriched=enrich(draft.positions,draft.fx);
  const hasKey=!!draft.api_key?.trim();

  return (
    <div>
      <div style={{...sCard,padding:"14px 18px",marginBottom:18,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".1em",marginBottom:4}}>Auto price refresh</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)"}}>
            {hasKey?`API key set · ${refreshState==="loading"?"Loading…":refreshState==="ok"?"Prices updated ✓":refreshState==="error"?refreshErr||"Error":"Click Refresh Prices"}`:"Add a Twelve Data API key in Settings to enable auto-refresh"}
          </div>
        </div>
        {draft.last_price_update&&<div style={{fontSize:11,color:DIM,fontFamily:MONO}}>Updated: {new Date(draft.last_price_update).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>}
        <button onClick={onRefresh} disabled={!hasKey||refreshState==="loading"} style={{...sBtn(hasKey&&refreshState!=="loading"),opacity:(!hasKey||refreshState==="loading")?0.5:1,display:"flex",alignItems:"center",gap:6}}>
          <span style={{display:"inline-block",animation:refreshState==="loading"?"spin 1s linear infinite":"none"}}>↺</span>
          {refreshState==="loading"?"Loading…":"Refresh Prices"}
        </button>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",gap:12,marginBottom:20,alignItems:"end"}}>
        <div><label style={sLabel}>Snapshot date</label><input value={draft.snapshot} onChange={e=>upd("snapshot",e.target.value)} style={sIn}/></div>
        {[["Total NAV",draft.nav.total,v=>updNav("total",v)],["Prior NAV",draft.nav.prior,v=>updNav("prior",v)],["Cash",draft.nav.cash,v=>updNav("cash",v)]].map(([l,v,fn],i)=>(
          <div key={i}><label style={sLabel}>{l} ({sym})</label><input type="number" step="1" value={v} onChange={e=>fn(e.target.value)} style={sIn}/></div>
        ))}
        <div><label style={sLabel}>EUR/USD rate</label><input type="number" step="0.00001" value={draft.fx.usd} onChange={e=>updFx("usd",e.target.value)} style={sIn}/></div>
      </div>
      <div style={{maxWidth:200,marginBottom:20}}>
        <label style={sLabel}>TWR % (from broker)</label>
        <input type="number" step="0.01" value={draft.twr} onChange={e=>setDraft(d=>({...d,twr:parseFloat(e.target.value)||0}))} style={sIn}/>
      </div>

      <div style={{fontSize:10,color:GOLD,textTransform:"uppercase",letterSpacing:".12em",marginBottom:10}}>Prices in native currency · EUR equivalent auto-calculated</div>
      <div style={{...sCard,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{borderBottom:`1px solid ${LINE}`}}>
            {["Sym","Ccy","Price ↗","Base equiv.","Value","Unrealized P&L","Earnings","PT"].map((h,i)=>(
              <th key={i} style={{padding:"8px 10px",textAlign:i>2?"right":"left",fontSize:9,color:DIM,textTransform:"uppercase",letterSpacing:".1em",fontWeight:700,fontFamily:SANS,whiteSpace:"nowrap"}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {enriched.map(p=>{
              const days=daysUntil(p.earnings);
              return (
                <tr key={p.id} style={{borderBottom:`1px solid rgba(255,255,255,.03)`}}>
                  <td style={{padding:"7px 10px",fontWeight:700,color:GOLD}}>{p.sym}</td>
                  <td style={{padding:"7px 10px"}}><span style={{fontSize:10,padding:"2px 6px",borderRadius:6,fontFamily:MONO,fontWeight:700,background:p.ccy==="USD"?"rgba(91,156,246,.15)":p.ccy==="SEK"?"rgba(212,168,83,.15)":"rgba(62,207,142,.1)",color:p.ccy==="USD"?BLUE:p.ccy==="SEK"?GOLD:GREEN}}>{p.ccy}</span></td>
                  <td style={{padding:"6px 10px",textAlign:"right"}}><input type="number" step="0.01" value={p.px} onChange={e=>updPx(p.id,e.target.value)} style={{...sInHL,width:100,textAlign:"right"}}/></td>
                  <td style={{padding:"7px 10px",textAlign:"right",fontFamily:MONO,fontSize:12,color:DIM}}>{p.ccy!=="EUR"&&`${sym}${p.pxBase.toFixed(2)}`}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",fontFamily:MONO,fontSize:12}}>{fmtM(sym,p.value)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",fontFamily:MONO,fontSize:12,color:cof(p.upnl)}}>{fmtS(sym,p.upnl)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",fontFamily:MONO,fontSize:11,color:ecColor(days)||DIM}}>{p.earnings?`${fmtEarnings(p.earnings)} (${days}d)`:"—"}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",fontFamily:MONO,fontSize:11,color:DIM}}>{p.pt>0?p.pt:"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditPositions({draft,setDraft,sym}) {
  const [exp,setExp]=useState(null);
  const add=()=>setDraft(d=>({...d,positions:[...d.positions,{id:++uid,sym:"",name:"",qty:0,px:0,cost:0,ccy:"USD",earnings:"",pt:0,thesis:"",td_sym:""}]}));
  const del=id=>setDraft(d=>({...d,positions:d.positions.filter(p=>p.id!==id)}));
  const upd=(id,k,v)=>setDraft(d=>({...d,positions:d.positions.map(p=>p.id===id?{...p,[k]:["sym","name","ccy","earnings","thesis","td_sym"].includes(k)?v:r2(v)}:p)}));

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:11,color:DIM}}>Manage positions — add ticker, quantity, cost basis, earnings date, price target and thesis</div>
        <button onClick={add} style={{...sBtn(true),padding:"7px 14px",fontSize:11}}>+ Add Position</button>
      </div>
      <div style={{...sCard,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{borderBottom:`1px solid ${LINE}`}}>
            {["Symbol","Name","Qty","Price","Ccy",`Cost (${sym})`,"Earnings","PT","TD Symbol",""].map((h,i)=>(
              <th key={i} style={{padding:"8px 10px",textAlign:i>1?"right":"left",fontSize:9,color:DIM,textTransform:"uppercase",letterSpacing:".1em",fontWeight:700,fontFamily:SANS}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {draft.positions.map(p=>{
              const isE=exp===p.id;
              return (
                <>
                  <tr key={p.id} style={{borderBottom:isE?`1px solid ${GOLD}40`:`1px solid ${LINE}`}}>
                    <td style={{padding:"6px 8px"}}><input value={p.sym} onChange={e=>upd(p.id,"sym",e.target.value.toUpperCase())} style={{...sIn,width:70}} placeholder="AAPL"/></td>
                    <td style={{padding:"6px 8px"}}><input value={p.name} onChange={e=>upd(p.id,"name",e.target.value)} style={{...sIn,width:140}} placeholder="Name"/></td>
                    <td style={{padding:"6px 8px",textAlign:"right"}}><input type="number" value={p.qty} onChange={e=>upd(p.id,"qty",e.target.value)} style={{...sIn,width:80,textAlign:"right"}}/></td>
                    <td style={{padding:"6px 8px",textAlign:"right"}}><input type="number" step="0.01" value={p.px} onChange={e=>upd(p.id,"px",e.target.value)} style={{...sInHL,width:90,textAlign:"right"}}/></td>
                    <td style={{padding:"6px 8px"}}>
                      <select value={p.ccy} onChange={e=>upd(p.id,"ccy",e.target.value)} style={{...sIn,width:65,background:"rgba(255,255,255,.06)"}}>
                        {["USD","EUR","SEK","GBP"].map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"right"}}><input type="number" value={p.cost} onChange={e=>upd(p.id,"cost",e.target.value)} style={{...sIn,width:90,textAlign:"right"}}/></td>
                    <td style={{padding:"6px 8px",textAlign:"right"}}><input type="date" value={p.earnings} onChange={e=>upd(p.id,"earnings",e.target.value)} style={{...sIn,width:130}}/></td>
                    <td style={{padding:"6px 8px",textAlign:"right"}}><input type="number" step="0.01" value={p.pt} placeholder="Target" onChange={e=>upd(p.id,"pt",e.target.value)} style={{...sIn,width:70,textAlign:"right"}}/></td>
                    <td style={{padding:"6px 8px"}}><input value={p.td_sym||""} onChange={e=>upd(p.id,"td_sym",e.target.value)} style={{...sIn,width:100}} placeholder="e.g. SIVE:XSTO"/></td>
                    <td style={{padding:"6px 8px",display:"flex",gap:4}}>
                      <button onClick={()=>setExp(isE?null:p.id)} style={{background:"rgba(212,168,83,.1)",border:"1px solid rgba(212,168,83,.2)",borderRadius:6,color:GOLD,padding:"4px 8px",fontSize:11,cursor:"pointer"}}>✏</button>
                      <button onClick={()=>del(p.id)} style={{background:"rgba(240,96,112,.1)",border:"1px solid rgba(240,96,112,.2)",borderRadius:6,color:RED,padding:"4px 8px",fontSize:11,cursor:"pointer"}}>✕</button>
                    </td>
                  </tr>
                  {isE&&(
                    <tr key={`x${p.id}`} style={{borderBottom:`1px solid ${LINE}`,background:"rgba(212,168,83,.03)"}}>
                      <td colSpan={10} style={{padding:"10px 10px"}}>
                        <label style={sLabel}>Investment thesis / notes</label>
                        <textarea value={p.thesis} onChange={e=>upd(p.id,"thesis",e.target.value)} placeholder="Investment thesis, exit targets, key risks…" style={{...sIn,height:60,resize:"vertical"}}/>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
        <div style={{padding:"8px 14px",fontSize:10,color:DIM,borderTop:`1px solid ${LINE}`}}>
          "TD Symbol" = Twelve Data override for non-US stocks (e.g. <code style={{background:"rgba(255,255,255,.06)",padding:"1px 5px",borderRadius:4}}>SIVE:XSTO</code>, <code style={{background:"rgba(255,255,255,.06)",padding:"1px 5px",borderRadius:4}}>VWCE:XETRA</code>)
        </div>
      </div>
    </div>
  );
}

function EditRealized({draft,setDraft,sym}) {
  const add=()=>setDraft(d=>({...d,realized:[...d.realized,{id:++uid,sym:"",desc:"",pnl:0}]}));
  const del=id=>setDraft(d=>({...d,realized:d.realized.filter(r=>r.id!==id)}));
  const upd=(id,k,v)=>setDraft(d=>({...d,realized:d.realized.map(r=>r.id===id?{...r,[k]:k==="pnl"?r2(v):v}:r)}));
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
        <div style={{fontSize:11,color:DIM}}>Log closed positions and their realized P&L</div>
        <button onClick={add} style={{...sBtn(true),padding:"7px 14px",fontSize:11}}>+ Add Trade</button>
      </div>
      <div style={{...sCard,padding:"8px 0"}}>
        {!draft.realized.length&&<div style={{padding:"24px",textAlign:"center",color:DIM,fontStyle:"italic"}}>No closed trades yet</div>}
        {draft.realized.map((r,i)=>(
          <div key={r.id} style={{display:"flex",gap:10,alignItems:"center",padding:"6px 14px",borderBottom:i<draft.realized.length-1?`1px solid ${LINE}`:"none"}}>
            <input value={r.sym} onChange={e=>upd(r.id,"sym",e.target.value.toUpperCase())} style={{...sIn,width:70}} placeholder="SYM"/>
            <input value={r.desc} onChange={e=>upd(r.id,"desc",e.target.value)} style={{...sIn,flex:1}} placeholder="Description"/>
            <input type="number" step="0.01" value={r.pnl} onChange={e=>upd(r.id,"pnl",e.target.value)} style={{...(r.pnl>=0?{...sIn,borderColor:"rgba(62,207,142,.25)",background:"rgba(62,207,142,.05)"}:{...sIn,borderColor:"rgba(240,96,112,.25)",background:"rgba(240,96,112,.05)"}),width:110,textAlign:"right"}}/>
            <button onClick={()=>del(r.id)} style={{background:"rgba(240,96,112,.1)",border:"1px solid rgba(240,96,112,.2)",borderRadius:6,color:RED,padding:"4px 8px",fontSize:11,cursor:"pointer",flexShrink:0}}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditDeposits({draft,setDraft,sym}) {
  const add=()=>setDraft(d=>({...d,deposits:[...(d.deposits||[]),{id:++uid,date:new Date().toISOString().slice(0,10),amount:0,desc:""}]}));
  const del=id=>setDraft(d=>({...d,deposits:d.deposits.filter(x=>x.id!==id)}));
  const upd=(id,k,v)=>setDraft(d=>({...d,deposits:d.deposits.map(x=>x.id===id?{...x,[k]:k==="amount"?r2(v):v}:x)}));
  const total=(draft.deposits||[]).reduce((s,d)=>s+d.amount,0);
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <div style={{fontSize:11,color:DIM}}>Capital deposits — needed for the P&L Trajectory chart</div>
          <div style={{fontSize:12,color:GOLD,fontFamily:MONO,marginTop:4}}>Total deposited: {sym}{total.toLocaleString("en-US")}</div>
        </div>
        <button onClick={add} style={{...sBtn(true),padding:"7px 14px",fontSize:11}}>+ Add Deposit</button>
      </div>
      <div style={{...sCard,fontSize:13}}>
        {!(draft.deposits?.length)
          ? <div style={{padding:"24px",textAlign:"center",color:DIM,fontStyle:"italic"}}>No deposits yet — add your full deposit history for the P&L chart</div>
          : [...(draft.deposits||[])].sort((a,b)=>a.date.localeCompare(b.date)).map((d,i,arr)=>(
            <div key={d.id} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 14px",borderBottom:i<arr.length-1?`1px solid ${LINE}`:"none"}}>
              <input type="date" value={d.date} onChange={e=>upd(d.id,"date",e.target.value)} style={{...sIn,width:140}}/>
              <input type="number" step="100" value={d.amount} placeholder="Amount" onChange={e=>upd(d.id,"amount",e.target.value)} style={{...sInHL,width:110,textAlign:"right"}}/>
              <input value={d.desc} onChange={e=>upd(d.id,"desc",e.target.value)} style={{...sIn,flex:1}} placeholder="Description (optional)"/>
              <button onClick={()=>del(d.id)} style={{background:"rgba(240,96,112,.1)",border:"1px solid rgba(240,96,112,.2)",borderRadius:6,color:RED,padding:"4px 8px",fontSize:11,cursor:"pointer",flexShrink:0}}>✕</button>
            </div>
          ))
        }
      </div>
    </div>
  );
}

function EditWatchlist({draft,setDraft}) {
  const [exp,setExp]=useState(null);
  const add=()=>setDraft(d=>({...d,watchlist:[...(d.watchlist||[]),{id:++uid,sym:"",name:"",px:0,ccy:"USD",pt:0,thesis:""}]}));
  const del=id=>setDraft(d=>({...d,watchlist:d.watchlist.filter(w=>w.id!==id)}));
  const upd=(id,k,v)=>setDraft(d=>({...d,watchlist:d.watchlist.map(w=>w.id===id?{...w,[k]:["sym","name","ccy","thesis"].includes(k)?v:r2(v)}:w)}));
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
        <div style={{fontSize:11,color:DIM}}>Stocks you're tracking but haven't bought yet</div>
        <button onClick={add} style={{...sBtn(true),padding:"7px 14px",fontSize:11}}>+ Add to Watchlist</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {!(draft.watchlist?.length)&&<div style={{...sCard,padding:"24px",textAlign:"center",color:DIM,fontStyle:"italic"}}>Watchlist is empty</div>}
        {(draft.watchlist||[]).map(w=>{
          const isE=exp===w.id;
          return (
            <div key={w.id} style={{...sCard,padding:"12px 16px"}}>
              <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:isE?12:0}}>
                <input value={w.sym} onChange={e=>upd(w.id,"sym",e.target.value.toUpperCase())} style={{...sIn,width:70}} placeholder="SYM"/>
                <input value={w.name} onChange={e=>upd(w.id,"name",e.target.value)} style={{...sIn,flex:1}} placeholder="Company name"/>
                <input type="number" step="0.01" value={w.px} onChange={e=>upd(w.id,"px",e.target.value)} style={{...sInHL,width:90,textAlign:"right"}} placeholder="Price"/>
                <select value={w.ccy} onChange={e=>upd(w.id,"ccy",e.target.value)} style={{...sIn,width:65,background:"rgba(255,255,255,.06)"}}>
                  {["USD","EUR","SEK","GBP"].map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                <input type="number" step="0.01" value={w.pt} onChange={e=>upd(w.id,"pt",e.target.value)} style={{...sIn,width:80,textAlign:"right"}} placeholder="Target"/>
                <button onClick={()=>setExp(isE?null:w.id)} style={{background:"rgba(212,168,83,.1)",border:"1px solid rgba(212,168,83,.2)",borderRadius:6,color:GOLD,padding:"4px 8px",fontSize:11,cursor:"pointer"}}>✏</button>
                <button onClick={()=>del(w.id)} style={{background:"rgba(240,96,112,.1)",border:"1px solid rgba(240,96,112,.2)",borderRadius:6,color:RED,padding:"4px 8px",fontSize:11,cursor:"pointer"}}>✕</button>
              </div>
              {isE&&<><label style={sLabel}>Thesis / why it's on the watchlist</label><textarea value={w.thesis} onChange={e=>upd(w.id,"thesis",e.target.value)} placeholder="Entry trigger, key risks, what would make you buy…" style={{...sIn,height:56,resize:"vertical"}}/></>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditSettings({draft,setDraft}) {
  return (
    <div style={{maxWidth:500,display:"flex",flexDirection:"column",gap:14}}>
      <div style={{...sCard,padding:"20px 22px"}}>
        <div style={{fontSize:12,color:"rgba(255,255,255,.6)",marginBottom:16,fontWeight:600}}>Currency</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div><label style={sLabel}>Base currency (e.g. EUR, USD)</label><input value={draft.currency?.base||"EUR"} onChange={e=>setDraft(d=>({...d,currency:{...d.currency,base:e.target.value.toUpperCase()}}))} style={sIn}/></div>
          <div><label style={sLabel}>Symbol (e.g. €, $)</label><input value={draft.currency?.symbol||"€"} onChange={e=>setDraft(d=>({...d,currency:{...d.currency,symbol:e.target.value}}))} style={sIn}/></div>
        </div>
      </div>
      <div style={{...sCard,padding:"20px 22px"}}>
        <div style={{fontSize:12,color:"rgba(255,255,255,.6)",marginBottom:4,fontWeight:600}}>Twelve Data API Key</div>
        <div style={{fontSize:11,color:DIM,marginBottom:14,lineHeight:1.7}}>
          Free account at <strong style={{color:"rgba(255,255,255,.6)"}}>twelvedata.com</strong> → Dashboard → copy your API Key.<br/>
          Free tier: 800 credits/day — enough for ~50 full refreshes per day.
          Your API key is stored locally in your browser only.
        </div>
        <div><label style={sLabel}>API Key</label>
          <input type="password" value={draft.api_key||""} onChange={e=>setDraft(d=>({...d,api_key:e.target.value}))} style={sIn} placeholder="Paste your Twelve Data API key here"/>
        </div>
        {draft.api_key&&<div style={{marginTop:10,fontSize:11,color:GREEN}}>✓ API key set ({draft.api_key.length} characters)</div>}
        <div style={{marginTop:14,fontSize:11,color:DIM,lineHeight:1.7}}>
          Non-US stocks need an exchange suffix in Twelve Data. Set this per position via <strong style={{color:"rgba(255,255,255,.5)"}}>Edit → Positions → "TD Symbol" column</strong>.<br/>
          Examples: <code style={{background:"rgba(255,255,255,.06)",padding:"1px 4px",borderRadius:3}}>SIVE:XSTO</code>, <code style={{background:"rgba(255,255,255,.06)",padding:"1px 4px",borderRadius:3}}>VWCE:XETRA</code>, <code style={{background:"rgba(255,255,255,.06)",padding:"1px 4px",borderRadius:3}}>WEBN:IBIS2</code>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════

export default function App() {
  const [view,         setView]         = useState("loading");
  const [tab,          setTab]          = useState("overview");
  const [editTab,      setEditTab]      = useState("prices");
  const [data,         setData]         = useState(null);
  const [draft,        setDraft]        = useState(null);
  const [saved,        setSaved]        = useState(false);
  const [refreshState, setRefreshState] = useState("idle");
  const [refreshErr,   setRefreshErr]   = useState("");
  const importRef = useRef(null);

  useEffect(()=>{
    try { const r=localStorage.getItem(STORAGE_KEY); setData(r?JSON.parse(r):EXAMPLE); }
    catch { setData(EXAMPLE); }
    setView("dashboard");
  },[]);

  // ── Auto price refresh: on page load + every 15 minutes ─────────
  // Skips if prices were already refreshed in the last 5 minutes.
  const autoBusy = useRef(false);
  useEffect(()=>{
    if (!data?.api_key?.trim()) return;
    let cancelled=false;

    const doRefresh = async () => {
      if (autoBusy.current) return;
      const last = data?.last_price_update ? new Date(data.last_price_update).getTime() : 0;
      if (Date.now() - last < 5*60*1000) return; // refreshed <5 min ago
      autoBusy.current = true;
      try {
        const posWithMap = data.positions.map(p=>({...p,_tdSym:p.td_sym?.trim()||TD_MAP[p.sym]||p.sym}));
        const {px,fx} = await fetchPrices(data.api_key, posWithMap);
        if (cancelled) return;
        setData(d=>{
          const next = {
            ...d, last_price_update:new Date().toISOString(),
            fx:{...d.fx,...(fx.usd?{usd:fx.usd}:{}),...(fx.sek?{sek:fx.sek}:{})},
            positions:d.positions.map(p=>{
              const tdSym=p.td_sym?.trim()||TD_MAP[p.sym]||p.sym;
              const newPx=px[p.sym]??px[tdSym];
              return newPx?{...p,px:r2(newPx)}:p;
            }),
          };
          try { localStorage.setItem(STORAGE_KEY,JSON.stringify(next)); } catch {}
          return next;
        });
      } catch(e) { console.warn("Auto-refresh failed:",e.message); }
      finally { autoBusy.current=false; }
    };

    doRefresh();                                  // refresh on load
    const t=setInterval(doRefresh, 15*60*1000);   // and every 15 min while open
    return ()=>{ cancelled=true; clearInterval(t); };
  },[data?.api_key]); // eslint-disable-line

  function openEdit() {
    setDraft(JSON.parse(JSON.stringify(data)));
    setEditTab("prices");
    setView("edit");
    setRefreshState("idle");
    setRefreshErr("");
  }

  const handleRefresh = useCallback(async () => {
    if (!draft) return;
    setRefreshState("loading"); setRefreshErr("");
    try {
      const posWithMap = draft.positions.map(p=>({...p,_tdSym:p.td_sym?.trim()||TD_MAP[p.sym]||p.sym}));
      const {px,fx} = await fetchPrices(draft.api_key, posWithMap);
      const now = new Date().toISOString();
      setDraft(d=>({
        ...d, last_price_update:now,
        fx:{...d.fx,...(fx.usd?{usd:fx.usd}:{}),...(fx.sek?{sek:fx.sek}:{})},
        positions:d.positions.map(p=>{
          const tdSym=p.td_sym?.trim()||TD_MAP[p.sym]||p.sym;
          const newPx=px[p.sym]??px[tdSym];
          return newPx?{...p,px:r2(newPx)}:p;
        }),
      }));
      setRefreshState("ok");
    } catch(err) { setRefreshState("error"); setRefreshErr(err.message); }
  },[draft]);

  function save() {
    const today=new Date().toISOString().slice(0,10);
    const hist=draft.history||[], last=hist[hist.length-1];
    const newDraft={...draft};
    const enriched=enrich(draft.positions,draft.fx);
    const totalU=enriched.reduce((s,p)=>s+p.upnl,0);
    const totalR=(draft.realized||[]).reduce((s,r)=>s+r.pnl,0);
    const totalDep=(draft.deposits||[]).reduce((s,d)=>s+d.amount,0);
    const posSnap={}; draft.positions.forEach(p=>{posSnap[p.sym]=p.px;});

    if (!last||last.date!==today) {
      newDraft.history=[...hist,{date:today,nav:draft.nav.total,unrealized:totalU,realized:totalR,deposits_total:totalDep,total_pnl:draft.nav.total-totalDep,px:posSnap}].slice(-365);
    }

    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(newDraft)); } catch(e){console.warn(e);}
    setData(newDraft); setSaved(true); setTimeout(()=>setSaved(false),2500); setView("dashboard");
  }

  function exportData() {
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download=`portfolio_${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function importData(e) {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try {
        const imp=JSON.parse(ev.target.result);
        localStorage.setItem(STORAGE_KEY,JSON.stringify(imp));
        setData(imp); setView("dashboard"); setSaved(true); setTimeout(()=>setSaved(false),2500);
      } catch { alert("Invalid JSON file"); }
    };
    reader.readAsText(file); e.target.value="";
  }

  function reset() {
    if (!confirm("Delete all data and reset to example data?")) return;
    localStorage.removeItem(STORAGE_KEY); setData(EXAMPLE); setView("dashboard");
  }

  if (view==="loading") return <div style={{background:BG,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:SANS,color:DIM}}>Loading…</div>;

  const sym      = data.currency?.symbol||"€";
  const enriched = enrich(data.positions, data.fx);
  const navDelta = data.nav.total - data.nav.prior;
  const lastPx   = (data.history||[]).slice(-2,-1)[0]?.px||{};
  const isEdit   = view==="edit";

  const DTABS = ["overview","positions","p&l","performance","realized","watchlist"];
  const ETABS = ["prices","positions","realized","deposits","watchlist","settings"];
  const DL = {overview:"Overview","p&l":"P&L Chart",positions:"Positions",performance:"Performance",realized:"Realized",watchlist:"Watchlist"};
  const EL = {prices:"Prices",positions:"Positions",realized:"Realized",deposits:"Deposits",watchlist:"Watchlist",settings:"Settings"};

  return (
    <div style={{background:BG,minHeight:"100vh",color:"#e8e8ea",fontFamily:SANS}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:2px}
        input[type=number]::-webkit-inner-spin-button{opacity:.4}
        input,select,textarea{font-family:'DM Mono',monospace}
        select option{background:#1a1c22}
        @keyframes fadein{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      `}</style>

      <input ref={importRef} type="file" accept=".json" onChange={importData} style={{display:"none"}}/>

      {/* ── Header ────────────────────────────────────────────── */}
      <div style={{padding:"26px 28px 0",borderBottom:`1px solid ${LINE}`,position:"sticky",top:0,background:BG,zIndex:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
          <div>
            {!isEdit&&<div style={{fontSize:10,color:DIM,textTransform:"uppercase",letterSpacing:".15em",marginBottom:6}}>Portfolio · {data.currency?.base||"EUR"}</div>}
            <div style={{fontSize:isEdit?26:38,fontWeight:800,letterSpacing:"-.03em",lineHeight:1,fontFamily:isEdit?SANS:MONO}}>
              {isEdit?"Daily Update":fmtM(sym,data.nav.total)}
            </div>
            {!isEdit&&(
              <div style={{fontSize:13,fontWeight:600,marginTop:6,fontFamily:MONO,color:cof(navDelta)}}>
                {(navDelta>=0?"+":"")+fmtM(sym,Math.abs(navDelta))}&nbsp;
                <span style={{opacity:.5}}>today · TWR {data.twr.toFixed(2)}% · {data.snapshot}</span>
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:8,paddingTop:4,flexWrap:"wrap",justifyContent:"flex-end",alignItems:"flex-start"}}>
            {isEdit?(
              <>
                <button onClick={()=>setView("dashboard")} style={sBtn(false)}>Cancel</button>
                <button onClick={save} style={{...sBtn(true),boxShadow:`0 0 18px rgba(212,168,83,.25)`}}>Save</button>
              </>
            ):(
              <>
                {saved&&<span style={{fontFamily:MONO,fontSize:12,color:GREEN,alignSelf:"center"}}>✓ Saved</span>}
                <button onClick={()=>importRef.current?.click()} style={{...sBtn(false),fontSize:11}} title="Import JSON backup">↑ Import</button>
                <button onClick={exportData} style={{...sBtn(false),fontSize:11}} title="Export as JSON">↓ Export</button>
                <button onClick={openEdit} style={{...sBtn(true),boxShadow:`0 0 18px rgba(212,168,83,.22)`}}>✏ Update</button>
                <button onClick={reset} style={{...sBtn(false),fontSize:10,opacity:.4}}>Reset</button>
              </>
            )}
          </div>
        </div>

        {!isEdit&&(
          <div style={{display:"flex",gap:14,padding:"8px 0 14px",fontSize:11,color:DIM,flexWrap:"wrap",alignItems:"center"}}>
            <span>USD <span style={{fontFamily:MONO,color:"rgba(255,255,255,.4)"}}>{data.fx.usd.toFixed(5)}</span></span>
            {data.fx.sek&&<><span style={{opacity:.3}}>·</span><span>SEK <span style={{fontFamily:MONO,color:"rgba(255,255,255,.4)"}}>{data.fx.sek.toFixed(6)}</span></span></>}
            <span style={{opacity:.3}}>·</span>
            <span>{enriched.length} positions · {(data.history||[]).length} snapshots</span>
            {data.last_price_update&&<><span style={{opacity:.3}}>·</span><span style={{color:GREEN}}>Auto-refresh on · prices {new Date(data.last_price_update).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</span></>}
            {!data.api_key?.trim()&&<><span style={{opacity:.3}}>·</span><span style={{color:AMBER}}>Add API key in Settings for auto prices</span></>}
          </div>
        )}

        {refreshErr&&isEdit&&(
          <div style={{background:"rgba(240,96,112,.08)",border:`1px solid rgba(240,96,112,.2)`,borderRadius:8,padding:"8px 14px",marginBottom:8,fontSize:12,color:RED}}>⚠ {refreshErr}</div>
        )}

        <div style={{display:"flex",marginTop:isEdit?10:0,overflowX:"auto"}}>
          {(isEdit?ETABS:DTABS).map(t=>{
            const active=isEdit?editTab===t:tab===t;
            return <button key={t} style={sTab(active)} onClick={()=>isEdit?setEditTab(t):setTab(t)}>{(isEdit?EL:DL)[t]||t}</button>;
          })}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div style={{padding:"22px 28px 56px",maxWidth:1150,animation:"fadein .2s ease"}}>
        {isEdit?(
          <>
            {editTab==="prices"    && <EditPrices     draft={draft} setDraft={setDraft} sym={draft.currency?.symbol||"€"} onRefresh={handleRefresh} refreshState={refreshState} refreshErr={refreshErr}/>}
            {editTab==="positions" && <EditPositions   draft={draft} setDraft={setDraft} sym={draft.currency?.symbol||"€"}/>}
            {editTab==="realized"  && <EditRealized    draft={draft} setDraft={setDraft} sym={draft.currency?.symbol||"€"}/>}
            {editTab==="deposits"  && <EditDeposits    draft={draft} setDraft={setDraft} sym={draft.currency?.symbol||"€"}/>}
            {editTab==="watchlist" && <EditWatchlist   draft={draft} setDraft={setDraft}/>}
            {editTab==="settings"  && <EditSettings    draft={draft} setDraft={setDraft}/>}
          </>
        ):(
          <>
            {tab==="overview"    && <OverviewTab     data={data} enriched={enriched} lastPx={lastPx} sym={sym}/>}
            {tab==="positions"   && <PositionsTab    data={data} enriched={enriched} lastPx={lastPx} sym={sym}/>}
            {tab==="p&l"         && <PnLTrajectory   data={data} enriched={enriched} sym={sym}/>}
            {tab==="performance" && <PerformanceTab  data={data} enriched={enriched} sym={sym}/>}
            {tab==="realized"    && <RealizedTab     data={data} sym={sym}/>}
            {tab==="watchlist"   && <WatchlistTab    data={data} sym={sym}/>}
          </>
        )}
      </div>
    </div>
  );
}
