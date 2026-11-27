import type { DesignModel } from './design-model.ts'

/** Stable object IDs survive snapshots and forks, even after an object is renamed. */
export function compareDesignModels(before: DesignModel, after: DesignModel) {
  function entries(model: DesignModel) {
    const result = new Map<string, { label: string, value: string }>()
    for (const { walls, items, openings, assets, ...floor } of model.floors) {
      result.set(floor.id, { label: floor.name, value: JSON.stringify(floor) })
      for (const obj of [...walls, ...items, ...openings, ...(assets ?? [])]) {
        result.set(obj.id, { label: floor.name + ' · ' + obj.name, value: JSON.stringify([floor.id, obj]) })
      }
    }
    return result
  }
  const old = entries(before), next = entries(after)
  const added: string[] = [], removed: string[] = [], changed: string[] = []
  for (const [id, obj] of next) {
    const previous = old.get(id)
    if (!previous) added.push(obj.label)
    else if (previous.value !== obj.value) changed.push(obj.label)
  }
  for (const [id, obj] of old) if (!next.has(id)) removed.push(obj.label)
  return { added, removed, changed }
}
