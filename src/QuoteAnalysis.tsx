import { useState } from 'react'
import type { QuoteBoard } from './quote-model'
import { compareQuotes, quoteVersions } from './quote-analysis'
import { quoteStatusLabels } from './quote-version'

const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })
const amountText = (amount: number | null) => amount === null ? '未提供' : currency.format(amount)

export function QuoteAnalysis({ board }: { board: QuoteBoard }) {
  const [selected, setSelected] = useState<Record<string, string>>({})
  const { quotes, rows, comparableCount, subtotals } = compareQuotes(board, selected)
  const names = new Map(board.vendors.map(vendor => [vendor.id, vendor.name]))
  return <section aria-label="同口径比价" className="ih-quote-panel">
    <h2>同口径比价</h2>
    {board.quotes.length === 0 ? <p>录入两家商家对同一项目的报价后，可在这里比较。</p> : <>
      <div className="ih-quote-fields">{board.vendors.map(vendor => {
        const versions = quoteVersions(board, vendor.id)
        if (!versions.length) return null
        return <label key={vendor.id}>{vendor.name}<select value={quotes.find(quote => quote.vendorId === vendor.id)?.id ?? ''}
          onChange={event => setSelected({ ...selected, [vendor.id]: event.target.value })}>
          <option value="">不参与比较</option>
          {versions.map(version => <option key={version.id} value={version.id}>{version.version} · {version.date || '日期未填'}</option>)}
        </select></label>
      })}</div>
      {quotes.length < 2 ? <p>请选择至少两家不同商家的报价。</p> : <>
        <p>共 {rows.length} 项，其中 {comparableCount} 项的工程量、单位、规格和承包口径一致。</p>
        <div className="ih-quote-table-wrap" style={{ overflowX: 'auto' }}><table><thead><tr><th scope="col">项目</th>
          {quotes.map(quote => <th scope="col" key={quote.id}>{names.get(quote.vendorId)}<br/><small>{quote.version} · {quote.scope || '承包口径待确认'}</small></th>)}
          <th scope="col">最高与最低差额</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.label}<br/><small>{row.key}</small>
            {row.scopeItem && <><br/><small>业主底稿 · {row.scopeItem.quantity ?? '工程量待定'} {row.scopeItem.unit} · {row.scopeItem.spec || '规格待定'}<br/>{row.scopeItem.source}</small></>}</th>
            {row.cells.map((cell, index) => <td key={quotes[index].id}>{!cell.lines.length ? '未列项' : cell.lines.map((line, itemIndex) => <div key={itemIndex}>
              {quoteStatusLabels[line.status]}{cell.lines.length === 1 && cell.amount !== null && ` · ${amountText(cell.amount)}`}
              <br/><small>{line.spec || '规格待确认'} · {line.quantity ?? '？'} {line.unit || '单位待确认'}</small>
              {line.source && <><br/><small>{line.source}</small></>}
            </div>)}{cell.scopeIssues.length > 0 && <small>{cell.scopeIssues.join('、')}</small>}</td>)}
            <td>{row.issues.length ? row.issues.join('、') : amountText(row.spread)}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">可比分项小计（{comparableCount} 项）</th>{subtotals.map((total, index) => <td key={quotes[index].id}>{total === null ? '暂无可比项' : amountText(total)}</td>)}<td>{comparableCount > 0 && amountText(Math.max(...subtotals.map(n => n!)) - Math.min(...subtotals.map(n => n!)))}</td></tr>
            <tr><th scope="row">商家原报总额</th>{quotes.map(quote => <td key={quote.id}>{amountText(quote.statedTotal)}{quote.source && <><br/><small>{quote.source}</small></>}</td>)}<td>含各自报价范围</td></tr></tfoot>
        </table></div>
      </>}
    </>}
  </section>
}
