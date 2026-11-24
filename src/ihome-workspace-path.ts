import { homedir } from 'node:os'
import { join } from 'node:path'

/** Shared host-only location for the single iHome workspace. */
export function iHomeWorkspacePath(): string {
  return join(homedir(), 'iHome工作区')
}

/** DSH RC.5 supplies agent.session in tool activation and execution contexts. */
export interface IHomeToolContext {
  agent?: { session: { header: { cwd?: string } } }
}

export function isIHomeToolContext(context: IHomeToolContext): boolean {
  return context.agent?.session?.header?.cwd === iHomeWorkspacePath()
}
