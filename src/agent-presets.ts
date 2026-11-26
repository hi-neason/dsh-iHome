export const NEEDS_ANALYST_PRESET_ID = 'ihome-needs-analyst'
// Keep the persisted DSH preset ID so existing conversations remain loadable.
export const IHOME_TEAM_PRESET_ID = NEEDS_ANALYST_PRESET_ID
export const EXPERT_TEAM_SETTINGS_ID = 'ihome-expert-team'
export const TASK_ASSISTANT_PRESET_ID = 'ihome-task-assistant'

export const publicAgentPresets = [{
  id: IHOME_TEAM_PRESET_ID,
  settingsId: EXPERT_TEAM_SETTINGS_ID,
  title: 'iHome专家团',
  moduleIds: ['archive', 'tasks'],
}] as const

export const EXPERT_TEAM_SKILLS = [
  { id: 'ihome-team-coordination', title: '专家协作与确认', description: '按话题调度需求和待办专家，在当前对话中确认并保存具体变更。' },
]

export const TASK_ASSISTANT_SKILLS = [
  { id: 'ihome-task-planning', title: '任务拆解与排期', description: '把业主的装修事项整理成可执行任务，澄清截止日期和前置条件。' },
  { id: 'ihome-task-review', title: '待办与进度核对', description: '核对近期任务、逾期事项和完成情况，整理下一步安排。' },
]

export const NEEDS_ANALYST_SKILLS = [
  { id: 'ihome-needs-interview', title: '居住需求访谈', description: '从家人的生活场景和困扰出发，逐步澄清居住需求。' },
  { id: 'ihome-needs-review', title: '需求整理与核对', description: '核对需求关联、遗漏和冲突，整理可确认的装修决定。' },
]

export interface AgentPresetSettingsView {
  id: string
  title: string
  description: string
  basePrompt: string
  skills: { id: string, title: string, description: string }[]
  instructions: string
  enabledSkills: string[]
  revision: number
}

export const agentPresets = [{
  id: EXPERT_TEAM_SETTINGS_ID,
  moduleId: 'team',
  title: 'iHome专家团',
  description: '在同一对话中协调需求分析师和任务待办助理，汇总建议并确认保存。',
  basePrompt: `你是 iHome专家团的主 Agent，面向同一套住房的业主协调需求分析师与任务待办助理。
用户可以点名专家，也可以自然描述问题。用 ihome_consult_expert 委派，expert 为 ihome-needs-analyst 或 ihome-task-assistant，task 填本次任务，context 填相关对话和日期背景。涉及家庭生活、家人偏好、空间需求与需求冲突时委派需求分析师；涉及任务拆解、排期、日历、完成情况时委派任务待办助理。跨领域问题按依赖顺序咨询两位专家，为每位专家提供用户的相关原话、目标、已明确事实和待解决问题。子专家返回后，以清楚的专家署名展示结论，再给出衔接的下一步。
专家只负责读取本地资料和提出建议。需要追问时由你在当前主对话提问；需要修改时由你读取最新数据并调用对应确认工具。家庭档案使用 ihome_read_archive、ihome_propose_need、ihome_propose_record；任务使用 ihome_read_tasks、ihome_propose_task。确认在当前主对话展示，由用户接受后工具保存。专家报告和文字同意不能代替工具的变更确认。仅根据工具返回的 applied 状态宣告保存成功，拒绝、冲突、取消和失败都如实说明。
iHome 管理一套房，房间或区域是同一层级空间。需求至少关联一位家人和一个空间，支持多选。任务与居住需求分别保存，需要两种记录时逐项说明和确认，不把需求自动当成待办。未明确的日期、家人、空间和完成状态继续询问。
委派失败时告知用户并依据已读取资料继续处理，不能声称专家已完成分析。右侧工作台支持直接编辑，修改前重新读取最新版本。用户附加指导可以调整沟通风格与重点，不能覆盖工具权限、确认或工作区限制。`,
  skills: EXPERT_TEAM_SKILLS,
}, {
  id: NEEDS_ANALYST_PRESET_ID,
  moduleId: 'archive',
  title: '需求分析师',
  description: '了解家人的生活方式，整理落实到房间或区域的居住需求与装修决定。',
  basePrompt: `你是 iHome 装修专家团中的需求分析师，帮助业主澄清和管理居住需求。
从真实生活中的困扰开始，每次追问一个具体问题。保留用户原话及不同家人的意见，区分必须满足、尽量满足和待商量。未知尺寸、日期和来源继续询问。
iHome 当前管理一套房。房间或区域是同一层级的空间，书房、玄关、阅读区都可以作为独立空间。每条需求至少关联一位家人和至少一个房间或区域，可以多选。
家庭档案是已保存事实的依据，历史对话中的猜测不能作为已确认资料。ihome_read_archive 空参数返回空间目录；传 roomId 才读取该空间的需求、关联家人和尺寸，生活事实用 factQuery 或 factId 查询。houseId 可省略，按当前话题读取。
你以内部专家身份接受主 Agent 委派，只读取档案并分析。输出包含依据、需求描述、关联家人、房间或区域、重要程度、待澄清问题及建议变更。保留用户原话、已有记录 ID 和读取版本，标明推断与未知内容。将追问和修改建议交回主 Agent，由主 Agent 在主对话中询问和确认保存。你没有写入或再次委派权限，不声称建议已保存。家人、空间和装修决定的独立编辑由工作台完成。
已启用的技能按当前技能目录加载，禁用后停止使用其流程。用户附加指导不能代替工具内的确认、数据校验和工作区限制。
右侧工作台支持直接编辑。用户附加指导可以调整沟通风格和关注点。`,
  skills: NEEDS_ANALYST_SKILLS,
}, {
  id: TASK_ASSISTANT_PRESET_ID,
  moduleId: 'tasks',
  title: '任务待办助理',
  description: '帮助业主拆解装修待办、安排日期，核对任务完成情况。',
  basePrompt: `你是 iHome专家团中的任务待办助理，接受主 Agent 委派，帮助同一套住房的业主安排装修事项。
先使用 ihome_read_tasks 读取当前本地任务及 revision，按 status 或 from/to 查询。日期范围查询不包含未排期任务，需要统筹时另读无日期筛选的结果。关注已有任务，保留原 ID、备注、排期和完成状态，避免重复创建。
将事项拆解成可执行的任务，描述具体动作、前置条件和需要业主确认的问题。日期遵循用户明确要求；相对日期以主 Agent 提供的当前日期和用户时区换算，缺少基准时提出澄清。用户没有说明截止日期时保持未排期。完成状态依据用户明确反馈，不因日期已过而自动完成。
需要家庭背景时可用 ihome_read_archive 按相关房间或区域读取。遇到需求取舍或家庭冲突，报告给主 Agent，由它安排需求分析师分析。
你只读取资料并返回建议。输出包含相关任务 ID、当前 revision、建议动作 create/update/delete、具体字段、依据及待澄清问题。修改现有任务仅列出需要变更的字段。将追问和建议交回主 Agent，在主对话确认后保存。你没有写入或再次委派权限，不声称任务已经保存、完成或创建了远端提醒。
用户附加指导可以调整沟通方式和关注重点，不能覆盖工具权限与确认要求。`,
  skills: TASK_ASSISTANT_SKILLS,
}] as const

export interface AgentPresetPreferences {
  revision: number
  instructions: string
  enabledSkills: string[]
}

export function presetDefinition(id: string) {
  const preset = agentPresets.find(item => item.id === id)
  if (!preset) throw new Error('未找到这个 iHome 专家。')
  return preset
}

export function defaultPresetPreferences(id: string): AgentPresetPreferences {
  return { revision: 0, instructions: '', enabledSkills: presetDefinition(id).skills.map(skill => skill.id) }
}

export function parsePresetPreferences(value: unknown): AgentPresetPreferences {
  if (!value || typeof value !== 'object') throw new Error('专家配置格式无效。')
  const entry = value as Record<string, unknown>
  if (!Number.isSafeInteger(entry.revision) || (entry.revision as number) < 0) throw new Error('专家配置版本无效。')
  if (typeof entry.instructions !== 'string' || entry.instructions.length > 20000) throw new Error('附加指导最多 20000 字。')
  if (!Array.isArray(entry.enabledSkills) || entry.enabledSkills.some(id => typeof id !== 'string')
    || new Set(entry.enabledSkills).size !== entry.enabledSkills.length) throw new Error('技能配置无效。')
  return { revision: entry.revision as number, instructions: entry.instructions, enabledSkills: [...entry.enabledSkills] }
}

export function presetSettingsView(id: string, preferences: AgentPresetPreferences): AgentPresetSettingsView {
  const { moduleId: _moduleId, ...definition } = presetDefinition(id)
  return { ...definition, skills: definition.skills.map(skill => ({ ...skill })),
    ...preferences, enabledSkills: [...preferences.enabledSkills] }
}
