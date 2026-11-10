/* Payment-month estimates only. Utilization dates and amounts are never changed.
   Rakuten: https://support.rakuten-card.jp/faq/show/9?site_domain=guest */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YohakuBilling = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const monthValid = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
  const shiftMonth = (ym, n) => {
    if (!monthValid(ym)) return '';
    const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const cardLike = (r) => !r.method || r.method === 'card' || r.method === 'charge';
  function cashCharge(r) {
    // In Yohaku, method=charge explicitly means a card-funded Rakuten Cash top-up.
    // A pay/bank record, or a memo merely mentioning Rakuten Cash, is not one.
    if (r.method === 'charge') return true;
    if (r.method !== 'card') return false;
    const labels = [r.merchant, r.memo].map((v) => String(v || '').normalize('NFKC').replace(/[\s　]+/g, ''));
    return labels.some((label) => /^(?:楽天ペイ残高(?:\(楽天キャッシュ\))?|楽天キャッシュ)(?:への?|に)?チャージ(?:[0-9]{1,10})?$/.test(label)
      || /^楽天キャッシュへ\((?:楽天)?カードから\)$/.test(label)
      || /^楽天カードから楽天(?:キャッシュ|ペイ残高)(?:へ|に)チャージ$/.test(label));
  }
  function payment(r, transactions) {
    if (!cardLike(r)) return null;
    const date = String(r.date || '');
    const ym = date.slice(0, 7), day = Number(date.slice(8, 10));
    if (!monthValid(ym) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || day < 1 || day > new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate()) return null;
    const explicit = transactions && transactions[String(r.id)];
    const statementMonth = explicit && explicit.month || r.billingMonth;
    if (monthValid(statementMonth)) return { month: statementMonth, source: 'statement', rule: '明細の請求月' };
    const cash = cashCharge(r);
    return { month: shiftMonth(ym, cash && day > 25 ? 2 : 1), source: 'estimate', rule: cash ? 'カードから楽天キャッシュへチャージ・25日締め' : '通常の月末締め' };
  }
  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter((r) => { if (!r.id) return true; const id = String(r.id); if (seen.has(id)) return false; seen.add(id); return true; });
  }
  function paymentRows(rows, month, transactions) {
    return uniqueRows(rows).filter((r) => { const p = payment(r, transactions); return p && p.month === month; });
  }
  return { monthValid, shiftMonth, cardLike, cashCharge, payment, uniqueRows, paymentRows };
});
