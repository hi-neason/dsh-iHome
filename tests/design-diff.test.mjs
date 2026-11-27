import test from 'node:test'
import assert from 'node:assert/strict'
import { compareDesignModels } from '../src/design-diff.ts'
test('snapshot comparison follows renamed and resized objects and counts additions and removals', () => {
  const floor = {id:'f',name:'一楼',walls:[],items:[],openings:[]}
  const model = items => ({ floors:[{...floor,items}] })
  const a = model([{id:'a',name:'沙发',width:2},{id:'b',name:'椅子'}])
  const b = model([{id:'a',name:'长沙发',width:3},{id:'c',name:'书桌'}])
  assert.deepEqual(compareDesignModels(a,b), {added:['一楼 · 书桌'],removed:['一楼 · 椅子'],changed:['一楼 · 长沙发']})
})
