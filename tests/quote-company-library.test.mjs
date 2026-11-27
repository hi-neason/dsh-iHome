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
