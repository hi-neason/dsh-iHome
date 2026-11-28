import { mountArchive } from './archive-host'
import type { ArchiveHostContext } from './archive-host'
import { mountIHomeWorkspace, type WorkspaceHostContext } from './ihome-workspace'
import { mountDesignMedia, type MediaHost } from './design-media-host'
import { mountDesignTools, type DesignToolsContext } from './design-tools'
import { mountDesigns, type DesignHostContext } from './design-host'
import type { QuoteSourceHost } from './quote-source-host'
import { mountQuotes, type QuoteHostContext } from './quote-host'
import { mountTasks, type TaskHostContext } from './task-host'
import { mountExpenses, type ExpenseHostContext } from './expense-host'
import { mountAgentSettings, type AgentSettingsHostContext } from './agent-settings-host'
import { mountExpertRequests, type ExpertRequestContext } from './expert-request'
import { mountExpertDispatch, type ExpertDispatchContext } from './expert-dispatch'

export const name = 'ihome'
export const inject = ['storageDomain', 'connection', 'attachments', 'tools', 'userQuestions', 'workspaceRegistry', 'sessionController', 'sessionPersistence', 'sessions', 'systemPrompt', 'agentPresets', 'subagents']

export async function apply(ctx: QuoteSourceHost & QuoteHostContext & ArchiveHostContext & WorkspaceHostContext & TaskHostContext & ExpenseHostContext & AgentSettingsHostContext & ExpertDispatchContext & ExpertRequestContext & DesignHostContext & DesignToolsContext & MediaHost): Promise<void> {
  await mountArchive(ctx)
  await mountTasks(ctx)
  await mountExpenses(ctx)
  await mountQuotes(ctx)
  await mountDesigns(ctx)
  await mountDesignMedia(ctx)
  await mountDesignTools(ctx)
  await mountAgentSettings(ctx)
  mountExpertDispatch(ctx)
  mountExpertRequests(ctx)
  await mountIHomeWorkspace(ctx)
}
