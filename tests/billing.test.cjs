const { test } = require('node:test');
const assert = require('node:assert/strict');
const b = require('../billing.js');
test('Rakuten Cash cutoff: 25th inclusive, next year, leap day', () => {
  const p=(date,method='charge')=>b.payment({date,method},{}).month;
  assert.equal(p('2026-11-25'),'2026-12');
  assert.equal(p('2026-11-26'),'2027-01');
  assert.equal(p('2026-11-30','card'),'2026-12');
  assert.equal(p('2026-12-26'),'2027-02');
  assert.equal(p('2028-02-29'),'2028-04');
  assert.equal(b.payment({date:'2026-02-29',method:'card'},{}),null);
});
test('card-format top-up and statement month override',()=>{
  const r={id:'one',date:'2026-10-30',method:'card',merchant:'楽天ペイ残高 チャージ'};
  assert.equal(b.payment(r,{}).month,'2026-12');
  assert.deepEqual(b.payment(r,{one:{month:'2027-01'}}),{month:'2027-01',source:'statement',rule:'明細の請求月'});
  assert.equal(b.payment({...r,merchant:'マクドナルド'},{}).month,'2026-11');
  assert.equal(b.payment({...r,merchant:'マクドナルド'},{}).source,'estimate');
  assert.equal(b.payment({...r,method:'pay'},{}),null);
});
test('deduplicate IDs only, retain legitimate same-day same-amount transactions',()=>{
  const rows=[{id:'a',date:'2026-10-25',amount:1000,method:'charge'},{id:'a',date:'2026-10-25',amount:1000,method:'charge'},{id:'b',date:'2026-10-25',amount:1000,method:'charge'}];
  assert.equal(b.paymentRows(rows,'2026-11',{}).length,2);
  assert.equal(rows.length,3);
});
test('25th cutoff is limited to explicitly identified card-funded top-ups',()=>{
  const labels=['楽天ペイ残高 チャージ','楽天ペイ残高（楽天キャッシュ）へのチャージ','楽天キャッシュ チャージ','楽天キャッシュへ（カードから）','楽天カードから楽天キャッシュにチャージ','楽天ペイ残高 チャージ 123456'];
  for(const label of labels) {
    for(const field of ['merchant','memo']) {
      const record={id:'topup',method:'card',[field]:label};
      assert.equal(b.payment({...record,date:'2026-12-25'},{}).month,'2027-01',label);
      assert.equal(b.payment({...record,date:'2026-12-26'},{}).month,'2027-02',label);
      assert.equal(b.payment({...record,date:'2026-12-26'},{topup:{month:'2027-03'}}).month,'2027-03',label);
    }
  }
});
test('normal spending and ambiguous memos do not receive the top-up cutoff',()=>{
  const labels=['楽天キャッシュ','楽天キャッシュで支払い','楽天キャッシュの支払いについてのメモ','楽天キャッシュへのチャージではない','楽天キャッシュへのチャージを検討','カードから楽天キャッシュへのチャージか不明','マクドナルド モバイルオーダー'];
  for(const memo of labels) {
    for(const date of ['2026-12-25','2026-12-26','2026-12-31']) {
      const result=b.payment({id:'spend',date,method:'card',memo},{});
      assert.equal(result.month,'2027-01',memo);
      assert.equal(result.source,'estimate',memo);
    }
  }
  for(const method of ['pay','bank','cash']) {
    for(const date of ['2026-12-25','2026-12-26','2026-12-31']) {
      assert.equal(b.payment({id:'not-card',date,method,memo:'楽天キャッシュへのチャージ'},{}),null);
    }
  }
});
