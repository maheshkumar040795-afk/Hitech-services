import { amountToWords, fmtDate } from './format'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Opens a print window with an A4 cash bill. bill: { bill_number, bill_date, customer_name, address, items[], total_amount } */
export function printBill(bill, company) {
  const items = [...(bill.items || [])]
  while (items.length < 10) items.push({})
  const total = Number(bill.total_amount || 0)
  const c = company || {}
  const rows = items.map((r, i) => `<tr><td class="c">${i + 1}</td><td class="l">${esc(r.particulars)}</td><td class="c">${esc(r.quantity)}</td><td class="c">${r.rate ? esc(Number(r.rate).toFixed(2)) : ''}</td><td class="c">${r.amount ? esc(Number(r.amount).toFixed(2)) : ''}</td></tr>`).join('')

  const html = `<!DOCTYPE html><html><head><title>Bill ${esc(bill.bill_number)}</title><style>
  *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#111}
  @page{size:A4 portrait;margin:10mm 12mm}
  .bill{border:2.5px solid #1a3a7a;min-height:270mm;display:flex;flex-direction:column}
  .hd{border-bottom:2px solid #1a3a7a;padding:14px 18px;display:grid;grid-template-columns:70px 1fr;gap:14px;align-items:center}
  .logo{width:64px;height:64px;border:2px solid #1a3a7a;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:900;color:#1a3a7a}
  .co{text-align:center;color:#1a3a7a}.co h1{font-size:26px;letter-spacing:2px}.co p{font-size:12px;margin-top:3px}
  .badge{display:inline-block;background:#1a3a7a;color:#fff;font-size:12px;font-weight:700;letter-spacing:2px;padding:3px 22px;border-radius:20px;margin-top:6px}
  .meta{display:flex;justify-content:space-between;padding:8px 18px;border-bottom:1.5px solid #1a3a7a;font-size:13px;font-weight:700;color:#1a3a7a}
  .meta span{color:#111}.cust{padding:6px 18px;border-bottom:1.5px solid #1a3a7a;font-size:13px}
  .cust div{display:flex;gap:8px;padding:4px 0}.cust b{color:#1a3a7a;min-width:70px}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #1a3a7a;font-size:12px;padding:7px 6px;height:30px}
  th{color:#1a3a7a}.c{text-align:center}.l{text-align:left;padding-left:10px}
  .tot td{font-weight:800;background:#f0f4ff}
  .ft{margin-top:auto;border-top:1.5px solid #1a3a7a;padding:12px 18px;font-size:13px}
  .words{border-bottom:1px dotted #999;padding-bottom:6px;font-style:italic}.words b{color:#1a3a7a;font-style:normal;margin-right:8px}
  .sig{display:flex;justify-content:flex-end;margin-top:24px;text-align:center;color:#1a3a7a;font-size:12px;font-weight:700}
  .sig div div{margin-top:34px;border-top:1px solid #1a3a7a;padding-top:3px;font-weight:400;font-size:11px}
  </style></head><body><div class="bill">
  <div class="hd"><div class="logo">${esc((c.company_name || 'H')[0])}</div>
  <div class="co"><h1>${esc(c.company_name)}</h1><p>${esc(c.company_address)}</p>
  ${c.company_phone || c.company_gstin ? `<p>${c.company_phone ? 'Ph: ' + esc(c.company_phone) : ''}${c.company_phone && c.company_gstin ? ' · ' : ''}${c.company_gstin ? 'GSTIN: ' + esc(c.company_gstin) : ''}</p>` : ''}
  <div class="badge">CASH BILL</div></div></div>
  <div class="meta"><div>No. <span>${esc(bill.bill_number || '—')}</span></div><div>Date: <span>${esc(fmtDate(bill.bill_date, { day: '2-digit', month: '2-digit', year: 'numeric' }))}</span></div></div>
  <div class="cust"><div><b>Name</b>: ${esc(bill.customer_name)}</div><div><b>Address</b>: ${esc(bill.address)}</div></div>
  <table><thead><tr><th style="width:50px">S. No.</th><th class="l">Particulars</th><th style="width:80px">Qty</th><th style="width:110px">Rate</th><th style="width:120px">Amount</th></tr></thead>
  <tbody>${rows}<tr class="tot"><td colspan="4" style="text-align:right;padding-right:14px;color:#1a3a7a">TOTAL</td><td class="c">${total.toFixed(2)}</td></tr></tbody></table>
  <div class="ft"><div class="words"><b>Rupees</b>${esc(amountToWords(total))}</div>
  <div class="sig"><div>FOR ${esc(c.company_name)}<div>Authorised Signatory</div></div></div></div>
  </div></body></html>`

  const win = window.open('', '_blank', 'width=900,height=1100')
  if (!win) { alert('Please allow pop-ups to print the bill'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}
