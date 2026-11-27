import test from 'node:test'
import assert from 'node:assert/strict'
import { calibratedSize } from '../src/design-calibration.ts'
test('a measured diagonal sets horizontal and vertical scale in metres even on a resized preview',()=>{
  assert.deepEqual(calibratedSize(1200,800,{x:300,y:200},{x:600,y:600},5),{width:12,depth:8})
  assert.throws(()=>calibratedSize(10,10,{x:0,y:0},{x:0,y:0},3))
})
