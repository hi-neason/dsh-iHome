import { requestIHome } from './ihome-http'
import { validateTaskBoard, type TaskBoard } from './task-model'

export interface TaskService {
  load(): Promise<TaskBoard>
  save(next: TaskBoard): Promise<TaskBoard>
}

export function createTaskService(): TaskService {
  return {
    async load() {
      const response = await requestIHome('tasks')
      return validateTaskBoard(await response.json())
    },
    async save(next) {
      const response = await requestIHome('tasks', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next),
      })
      return validateTaskBoard(await response.json())
    },
  }
}
