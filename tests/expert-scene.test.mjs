import assert from 'node:assert/strict'
import test from 'node:test'
import { createExpertCrew } from '../src/expert-figures.ts'
import { stages } from '../src/modules.ts'

test('each visible expert has one figure whose pose depends only on scene time', () => {
  const { group, animate } = createExpertCrew()
  const expected = [...stages.flatMap(stage => stage.agentIds), 'knowledge', 'documents', 'tasks']
  assert.deepEqual(group.children.map(node => node.userData.expertId).sort(), expected.sort())

  const poseAt = time => {
    animate(time)
    group.updateMatrixWorld()
    return group.children.map(figure => {
      const transforms = []
      figure.traverse(part => { if (part.isMesh) transforms.push(...part.matrixWorld.elements) })
      return transforms
    })
  }
  const initial = poseAt(0)
  for (const [i, pose] of poseAt(1.5).entries()) {
    assert.ok(pose.every(Number.isFinite))
    assert.notDeepEqual(pose, initial[i])
  }
  assert.deepEqual(poseAt(0), initial)
})
