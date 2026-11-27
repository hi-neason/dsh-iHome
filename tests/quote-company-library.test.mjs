import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/QuoteCompanyDocuments.tsx'], bundle: true, platform: 'node',
  format: 'esm', write: false, define: { 'process.env.NODE_ENV': '"production"' } })
const { companyDocumentSeries, suggestedVersion } = await import('data:text/javascript;base64,' +
  Buffer.from(bundle.outputFiles[0].text).toString('base64'))

test('company files group by category and title and retain older revisions under the latest upload', () => {
  const date = '2026-11-27T00:00:00.000Z'
  const base = { vendorId: 'first', kind: 'quote', title: '半包清单', uploadedAt: date }
  const docs = [
    { ...base, id: 'old', version: 'V1' },
    { ...base, id: 'other-company', vendorId: 'second', version: 'V1' },
    { ...base, id: 'signed', kind: 'contract', version: '签约版' },
    { ...base, id: 'new', version: 'V3' },
  ]
  const rows = companyDocumentSeries({ documents: docs }, 'first')
  assert.deepEqual(rows.map(group => group.map(d => d.id)), [['new', 'old'], ['signed']])
  assert.equal(suggestedVersion(rows[0]), 'V4')
  assert.equal(suggestedVersion([]), 'V1')
  assert.deepEqual(companyDocumentSeries({ documents: docs }, 'second').map(group => group[0].id), ['other-company'])
  assert.deepEqual(docs.map(d => d.id), ['old', 'other-company', 'signed', 'new'])
})

test('退出公司仍保留旧档案，早期客户端编辑资料不自动恢复候选', async () => {
  const { changeQuoteBoard, parseQuoteBoard } = await import('../src/quote-model.ts')
  let board = parseQuoteBoard({ revision: 0, vendors: [{ id: 'a', name: '甲装饰' }] })
  const save = data => changeQuoteBoard(board, { expectedRevision: board.revision, collection: 'vendors', record: data })
  assert.equal(board.vendors[0].withdrawn, undefined)
  board = save({ ...board.vendors[0], withdrawn: true })
  assert.equal(board.vendors[0].withdrawn, true)
  const repeated = changeQuoteBoard(board, { expectedRevision: 0, collection: 'vendors', record: board.vendors[0] })
  assert.equal(repeated.revision, board.revision)
  board = parseQuoteBoard(JSON.parse(JSON.stringify(board)))
  board = save({ id: 'a', name: '甲装饰', contact: '旧客户端更新联系人' })
  assert.equal(board.vendors[0].withdrawn, true)
  board = save({ ...board.vendors[0], withdrawn: false })
  assert.equal(board.vendors[0].withdrawn, undefined)
  assert.equal(board.vendors[0].contact, '旧客户端更新联系人')
  assert.throws(() => save({ ...board.vendors[0], withdrawn: 'false' }), /候选状态/)
})

test('新审核选择各资料系列仍在使用的最新版本，全部停用的系列不入选', async () => {
  const bundled = await build({ entryPoints: ['src/CompanyAssessment.tsx'], bundle: true, platform: 'node',
    format: 'esm', write: false, define: { 'process.env.NODE_ENV': '"production"' } })
  const { initialSelection } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
  const base = { vendorId: 'a', kind: 'quote', title: '半包', uploadedAt: '2026-11-27T02:00:00.000Z' }
  const docs = [{ ...base, id: 'old' }, { ...base, id: 'new', inactive: true },
    { ...base, id: 'invalid', kind: 'design', inactive: true }, { ...base, id: 'other', vendorId: 'b' }]
  const board = { documents: docs, research: [], quotes: [] }
  assert.deepEqual(initialSelection(board, 'a').documentIds, ['old'])
  board.documents = docs.map(doc => doc.id === 'new' ? { ...doc, inactive: false } : doc)
  assert.deepEqual(initialSelection(board, 'a').documentIds, ['new'])
})
