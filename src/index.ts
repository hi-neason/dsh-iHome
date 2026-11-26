import { mountArchive } from './archive-host'
import type { ArchiveHostContext } from './archive-host'
import { mountIHomeWorkspace, type WorkspaceHostContext } from './ihome-workspace'
import { mountTasks, type TaskHostContext } from './task-host'
import { mountAgentSettings, type AgentSettingsHostContext } from './agent-settings-host'
import { mountExpertRequests, type ExpertRequestContext } from './expert-request'
import { mountExpertDispatch, type ExpertDispatchContext } from './expert-dispatch'

export const name = 'ihome'
export const inject = ['storageDomain', 'connection', 'attachments', 'tools', 'userQuestions', 'workspaceRegistry', 'sessionController', 'sessionPersistence', 'sessions', 'systemPrompt', 'agentPresets', 'subagents']

export async function apply(ctx: ArchiveHostContext & WorkspaceHostContext & TaskHostContext & AgentSettingsHostContext & ExpertDispatchContext & ExpertRequestContext): Promise<void> {
  await mountArchive(ctx)
  await mountTasks(ctx)
  await mountAgentSettings(ctx)
  mountExpertDispatch(ctx)
  mountExpertRequests(ctx)
  await mountIHomeWorkspace(ctx)
}
