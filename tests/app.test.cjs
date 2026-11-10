// Run with Playwright installed. Browser tests never connect to live sync.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const injection=`window.__test = {
  set(data) { settings={...EMPTY_SETTINGS,...(data.settings||{})}; state={...EMPTY_STATE,...(data.state||{}),overrides:JSON.parse(JSON.stringify(data.state?.overrides||{}))}; hist=data.history||buildHist(data.log||[],[]); },
  run(date) {const now=new Date(date+'T12:00:00');maybeRollover(now);return compute(now);},
  get(){return JSON.parse(snapshot());}, billSummary, billingMeta, paymentOf, cardCheckRows, applyServer, flattenLog, buildHist, render,
  confirm(ym,amount){billingMeta().statements[ym]={amount};},
  actual(id,month){billingMeta().transactions[id]={month};},
  paid(ym,value){state.overrides[ym]={card:value};}
};\n`;
const server=http.createServer((req,res)=>{
 const name=req.url.split('?')[0];
 if(name.includes('..')){res.writeHead(403).end();return;}
 const file=path.join(root,name==='/'?'index.html':name);
 try{let raw=fs.readFileSync(file);if(file.endsWith('index.html')) raw=raw.toString().replace('  // ---------- boot ----------',injection+'  // ---------- boot ----------');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(raw);}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({timezoneId:'Asia/Tokyo',viewport:{width:390,height:844},serviceWorkers:'block'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-11-11T03:00:00Z')});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const row=(id,date,amount,method='card')=>({id,date,amount,method});
 const fixture={settings:{subs:[],salary:0,rent:0,livingBudget:70000},state:{balance:100000,cycleYm:'2026-11',cardFixedSource:'estimate'},log:[row('a','2026-11-25',10000,'charge'),row('b','2026-11-26',20000,'charge'),row('c','2026-11-30',3000)]};
 const set=async data=>page.evaluate(d=>__test.set(d),data);
 const run=async date=>page.evaluate(d=>__test.run(d),date);
 await set(fixture);let c=await run('2026-11-30');assert.equal(c.pace.livingUsed,33000);assert.equal(c.available,67000);
 c=await run('2026-12-01');assert.equal(c.pace.livingUsed,0);assert.equal(c.available,67000);assert.equal(c.lines.find(x=>x.key==='fixed').amt,13000);
 await page.evaluate(()=>__test.confirm('2026-12',12000));c=await run('2026-12-01');assert.equal(c.available,68000);
 await page.evaluate(()=>__test.confirm('2026-12',0));c=await run('2026-12-01');assert.equal(c.available,80000);
 await page.evaluate(()=>__test.confirm('2026-12',12000));await page.evaluate(()=>__test.paid('2026-12',true));c=await run('2026-12-01');assert.equal(c.available,80000);
 await page.evaluate(()=>__test.paid('2026-12',false));c=await run('2026-12-01');assert.equal(c.available,68000);
 await set(fixture);await page.evaluate(()=>__test.actual('c','2027-01'));c=await run('2026-12-01');assert.equal(c.lines.find(x=>x.key==='fixed').amt,10000);assert.equal(c.futureBills[0].amount,23000);assert.equal(c.available,67000);
 await set(fixture);c=await run('2027-01-01');assert.equal(c.lines.find(x=>x.key==='fixed').amt,20000);assert.equal((await page.evaluate(()=>__test.get())).history['2026-11'].spends.length,3);
 await set({...fixture,log:[row('a','2026-11-25',10000,'charge'),row('p','2026-11-26',2000,'pay')]});c=await run('2026-11-27');assert.equal(c.pace.livingUsed,10000);assert.equal(c.available,90000);
 await set({...fixture,settings:{...fixture.settings,subs:[{name:'Example subscription',amount:1000,day:5}]},log:[{...row('s','2026-11-05',1000),memo:'Example subscription'}]});c=await run('2026-11-27');assert.equal(c.pace.livingUsed,0);assert.equal(c.futureBills[0].amount,1000);
 await set(fixture);await page.evaluate(()=>{__test.actual('c','2027-01');__test.confirm('2026-12',0);});c=await run('2026-11-30');
 const snap=await page.evaluate(()=>__test.get());const flattened=await page.evaluate(()=>__test.flattenLog());await page.evaluate(d=>__test.applyServer(d),{ok:true,settings:snap.settings,state:snap.state,log:flattened,entries:[]});
 assert.equal((await page.evaluate(()=>__test.get())).state.overrides.billing.transactions.c.month,'2027-01');assert.equal((await page.evaluate(()=>__test.get())).state.overrides.billing.statements['2026-12'].amount,0);
 await set({...fixture,state:{...fixture.state,cardCurrent:5000,cardCurrentAsOf:'2026-11-20'},log:[]});await run('2026-12-01');assert.equal((await page.evaluate(()=>__test.cardCheckRows('2026-11'))).base,5000);
 // Real snapshot is optional, kept outside repository and never committed.
 if(process.env.YOHAKU_PRIVATE_FIXTURE){const live=JSON.parse(fs.readFileSync(process.env.YOHAKU_PRIVATE_FIXTURE));await set(live);const before=await page.evaluate(()=>JSON.stringify(__test.flattenLog()));c=await run('2026-11-11');await page.evaluate(()=>__test.render());const after=await page.evaluate(()=>JSON.stringify(__test.flattenLog()));assert.equal(before,after);assert.equal((await page.evaluate(()=>__test.get())).settings.subs.filter(s=>s.name==='1Password').length,1);console.log('Live fixture:',JSON.stringify({livingUsed:c.pace.livingUsed,currentBill:c.lines.find(x=>x.key==='fixed').amt,future:c.futureBills.map(b=>({month:b.ym,recorded:b.recorded,forecast:b.forecast})),records:live.log.length}));}
 await page.locator('[data-go="history"]').first().click().catch(()=>{});
 await page.evaluate(()=>{document.querySelectorAll('.tab').forEach(e=>e.hidden=e.dataset.tab!=='history');});
 await page.screenshot({path:process.env.YOHAKU_SCREENSHOT||'/tmp/yohaku-billing.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: 14 app integration scenarios, no JS errors.');
 await context.close();
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
