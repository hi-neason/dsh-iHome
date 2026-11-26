import { mountArchive } from './archive-host'
import type { ArchiveHostContext } from './archive-host'

import { mountIHomeWorkspace, type WorkspaceHostContext } from './ihome-workspace'
import { mountTasks, type TaskHostContext } from './task-host'

export const name = 'ihome'
export const inject = ['storageDomain', 'connection', 'attachments', 'tools', 'userQuestions', 'workspaceRegistry', 'sessionController', 'sessionPersistence', 'sessions', 'systemPrompt']

export async function apply(ctx: ArchiveHostContext & WorkspaceHostContext & TaskHostContext): Promise<void> {
  await mountArchive(ctx)
  await mountTasks(ctx)
  await mountIHomeWorkspace(ctx)
}
