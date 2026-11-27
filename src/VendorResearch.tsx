import { useState, type FormEvent } from 'react'
import type { QuoteBoard, QuoteVendor } from './quote-model'
import { researchIdentities, researchSourceKinds, vendorResearchPrompt, type QuoteVendorResearch } from './vendor-research'

function ResearchReport({ report }: { report: QuoteVendorResearch }) {
  const matched = report.sources.filter(source => source.identity === 'matched').length
  return <article aria-label={'网上评价调研 ' + report.date}>
    <h3>{report.date} · {report.company}</h3><small>{[report.city, report.branch].filter(Boolean).join(' · ')}</small>
    <h4>调研发现</h4><p className="ih-quote-report">{report.summary}</p>
    <h4>原文依据</h4>
    {report.sources.length ? <><p>查阅 {report.sources.length} 条原文，其中 {matched} 条与目标相符。</p>
      <ol>{report.sources.map((source, index) => <li key={index}>
        <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
        <div>{researchSourceKinds[source.kind]} · {researchIdentities[source.identity]}</div>
        <small>{source.author && source.author + ' · '}{source.published ? '发布于 ' + source.published : '发布日期未披露'} · 查阅于 {source.accessed}</small>
        <blockquote>{source.excerpt}</blockquote><p>归属依据：{source.basis}</p>
      </li>)}</ol></> : <p>本次没有取得可引用的原文。</p>}
    <h4>调研局限</h4><p className="ih-quote-report">{report.limitations}</p>
    {report.questions.length > 0 && <><h4>向公司核实</h4><ul>{report.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></>}
  </article>
}

export function VendorResearch({ board, vendor, onAsk }: { board: QuoteBoard, vendor: QuoteVendor, onAsk: (request: string) => void }) {
  const [city, setCity] = useState(vendor.city)
  const [branch, setBranch] = useState('')
  const [focus, setFocus] = useState('')
  const [links, setLinks] = useState('')
  const [error, setError] = useState('')
  const reports = board.research.filter(report => report.vendorId === vendor.id).reverse().sort((a, b) => b.date.localeCompare(a.date))
  function ask(event: FormEvent) {
    event.preventDefault()
    setError('')
    try { onAsk(vendorResearchPrompt(vendor, city, branch, focus, links)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法生成调研请求。') }
  }
  return <section aria-label="公司网上评价">
    <h2>网上评价</h2>
    <form className="ih-company-editor" data-quote-pristine onSubmit={ask}>
      <fieldset><legend>调研{vendor.name}</legend>
        <div className="ih-company-fields">
          <label>调研城市<input required maxLength={100} value={city} onChange={e => setCity(e.target.value)} /></label>
          <label>门店或区域（选填）<input maxLength={200} value={branch} onChange={e => setBranch(e.target.value)} /></label>
        </div>
        <label>关注事项（选填）<textarea rows={2} maxLength={1000} value={focus} placeholder="例如增项如何确认，报修后多久有人处理" onChange={e => setFocus(e.target.value)} /></label>
        <label>网页线索（选填，每行一个链接）<textarea rows={2} maxLength={24008} value={links} onChange={e => setLinks(e.target.value)} /></label>
        <small>在对话中发送请求后，分析师会查阅公开网页。确认报告后，可在这里回看。</small>
        {error && <p role="alert">{error}</p>}
        <div className="ih-quote-actions"><button type="submit">生成调研请求</button></div>
      </fieldset>
    </form>
    <h3>已归档的调研（{reports.length}）</h3>
    {!reports.length && <p>这家公司还没有已确认的调研报告。</p>}
    {reports.map((report, index) => index === 0 ? <ResearchReport report={report} key={report.id}/> :
      <details key={report.id}><summary>{report.date} · {report.company} · {report.branch || report.city}</summary><ResearchReport report={report}/></details>)}
  </section>
}
