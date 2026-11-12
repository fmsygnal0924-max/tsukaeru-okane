// Run with Playwright installed. Browser tests never connect to live sync.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const injection=`window.__test = {
  set(data) { settings={...EMPTY_SETTINGS,...(data.settings||{})}; state={...EMPTY_STATE,...(data.state||{}),overrides:JSON.parse(JSON.stringify(data.state?.overrides||{}))}; hist=data.history||buildHist(data.log||[],[]); },
  run(date) {const now=new Date(date+'T12:00:00');maybeRollover(now);return compute(now);},
  get(){return JSON.parse(snapshot());}, matchesSub, isSubscription, spendingSummary, billSummary, billingMeta, paymentOf, cardCheckRows, applyServer, flattenLog, buildHist, render,
  confirm(ym,amount){billingMeta().statements[ym]={amount};},
  actual(id,month){billingMeta().transactions[id]={month};},
  paid(ym,value){state.overrides[ym]={card:value};}
};\n`;
const {JSDOM, VirtualConsole}=require('jsdom');
(async()=>{
 const errors=[]; const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
 const w=dom.window;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.alert=()=>{};
 w.eval(fs.readFileSync(path.join(root,'billing.js'),'utf8'));
 const script=html.match(/<script>\n([\s\S]*?)<\/script>/)[1].replace('  // ---------- boot ----------',injection+'  // ---------- boot ----------');
 w.eval(script);
 const page={evaluate:async(fn,arg)=>JSON.parse(JSON.stringify(w.eval('('+fn.toString()+')')(arg))??'null')};
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
 // UI event handlers: month correction cancel/repeat, zero statement, comparison-only save.
 await set({...fixture,state:{...fixture.state,cycleYm:'2026-11'},log:[row('ui','2026-11-26',5000,'charge')]});
 w.document.getElementById('billing-month').value='2027-01';w.__test.render();
 const button=()=>w.document.querySelector('#billing-log button');
 w.prompt=()=>null;button().click();assert.equal(w.__test.get().state.overrides.billing.transactions.ui,undefined);
 w.prompt=()=> '2027-02';button().click();assert.equal(w.__test.get().state.overrides.billing.transactions.ui.month,'2027-02');
 w.prompt=()=> '';button().click();assert.equal(w.__test.get().state.overrides.billing.transactions.ui,undefined);
 const el=w.document.getElementById('in-fixed');el.value='0';el.dispatchEvent(new w.Event('input',{bubbles:true}));w.document.getElementById('save').click();
 const currentYm=new Date().toISOString().slice(0,7);assert.equal(w.__test.get().state.overrides.billing.statements[currentYm].amount,0);
 const beforeCompare=w.__test.get();w.document.getElementById('check-month').value='2027-01';w.document.getElementById('check-basis').value='billing';
 const chk=w.document.getElementById('in-cardapp');chk.value='0';chk.dispatchEvent(new w.Event('input',{bubbles:true}));w.document.getElementById('save').click();
 assert.equal(w.__test.get().state.cardChecks.at(-1).basis,'billing');assert.equal(w.__test.get().state.balance,beforeCompare.state.balance);assert.equal(w.__test.get().state.asOf,beforeCompare.state.asOf);
 // Migration with a legacy total lacking an as-of date does not double count old logs.
 await set({...fixture,state:{...fixture.state,cardCurrent:5000,asOf:'2026-11-20'},log:[row('older','2026-11-10',3000)]});c=await run('2026-11-25');assert.equal(c.pace.livingUsed,5000);
 // ID-less old records remain readable but cannot share a correction key.
 await set({...fixture,log:[{date:'2026-11-26',amount:1000,method:'charge'}]});w.document.getElementById('billing-month').value='2027-01';w.__test.render();assert.equal(w.document.querySelector('#billing-log button').disabled,true);
 // Broad vendor names and amount equality must never identify a subscription.
 await set({...fixture,settings:{...fixture.settings,subs:[{id:'prime',name:'Amazon Prime',amount:600},{id:'icloud',name:'iCloud',amount:150},{id:'one',name:'1Password',amount:800}]},log:[{...row('prime','2026-11-03',600),merchant:'アマゾンプライムカイヒ'},{...row('shop','2026-11-04',5380),merchant:'AMAZON.CO.JP'},{...row('apple','2026-11-04',800),merchant:'APPLE COM BILL',cat:'サブスク'}]});
 assert.equal(w.__test.matchesSub({merchant:'APPLE COM BILL',amount:800,cat:'サブスク'},{id:'icloud',name:'iCloud',amount:150}),false);
 assert.equal(w.__test.matchesSub({merchant:'AMAZON.CO.JP',amount:600},{id:'prime',name:'Amazon Prime',amount:600}),false);
 assert.equal(w.__test.matchesSub({merchant:'SONY',amount:1990},{id:'ps',name:'PSN',amount:1990}),false);
 let spend=w.__test.spendingSummary('2026-11');assert.equal(spend.subsTotal,1400);assert.equal(spend.otherTotal,5380);assert.equal(spend.total,6780);
 w.__test.render();assert.equal(w.document.querySelector('#subs-actual').textContent,'1,400円');assert.equal(w.document.querySelector('#other-actual').textContent,'5,380円');
 // Explicit future bill confirmation, not a comparison checkpoint, updates the statement.
 w.document.getElementById('check-month').value='2027-01';w.document.getElementById('check-basis').value='billing';w.document.getElementById('check-confirmed').checked=true;
 chk.value='12345';chk.dispatchEvent(new w.Event('input',{bubbles:true}));w.document.getElementById('save').click();assert.equal(w.__test.get().state.overrides.billing.statements['2027-01'].amount,12345);
 // Reservation starts before billing day; actual replaces forecast once, canceled plans stay historical.
 const subFixture={settings:{...fixture.settings,reserveSubsInBudget:true,subs:[{id:'s',name:'Example subscription',amount:1000,day:20},{id:'ended',name:'Ended',amount:15000,day:6,active:false,endedOn:'2026-11-05'}]},state:fixture.state,log:[]};
 await set(subFixture);c=await run('2026-11-01');assert.equal(c.pace.subsReserved,1000);assert.equal(c.pace.livingLeft,69000);
 await set({...subFixture,log:[{...row('actual','2026-11-20',1200),merchant:'Example subscription'}]});c=await run('2026-11-21');assert.equal(c.subsExpectedTotal,0);assert.equal(c.pace.subsReserved,1200);assert.equal(c.pace.livingLeft,68800);assert.equal(c.futureBills[0].amount,1200);
 await set(subFixture);c=await run('2026-12-01');assert.equal(c.pace.subsReserved,1000);
 assert.equal(w.__test.matchesSub({merchant:'U-NEXT',amount:1400},{id:'un',name:'U-NEXT',amount:2189,monthlyMatchExact:true}),false);
 // Real snapshot is optional, kept outside repository and never committed.
 if(process.env.YOHAKU_PRIVATE_FIXTURE){const live=JSON.parse(fs.readFileSync(process.env.YOHAKU_PRIVATE_FIXTURE));await set(live);const before=await page.evaluate(()=>JSON.stringify(__test.flattenLog()));c=await run('2026-11-11');await page.evaluate(()=>__test.render());const after=await page.evaluate(()=>JSON.stringify(__test.flattenLog()));assert.equal(before,after);assert.equal((await page.evaluate(()=>__test.get())).settings.subs.filter(s=>s.name==='1Password').length,1);console.log('Live fixture:',JSON.stringify({livingUsed:c.pace.livingUsed,currentBill:c.lines.find(x=>x.key==='fixed').amt,currentSummary:await page.evaluate(()=>{const b=__test.billSummary('2026-11');return {recorded:b.recorded,forecast:b.forecast}}),future:c.futureBills.map(b=>({month:b.ym,recorded:b.recorded,forecast:b.forecast})),records:live.log.length}));}
 assert.deepEqual(errors,[]); console.log('PASS: app integration scenarios in jsdom, no JS errors.');dom.window.close();
})().catch(e=>{console.error(e);process.exit(1);});
