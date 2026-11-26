export const expertSlashLocales = {
  zh: {
    group: 'iHome专家团',
    needs: '需求分析师',
    'needs.description': '梳理家人的居住需求与装修决定',
    tasks: '任务待办助理',
    'tasks.description': '安排装修任务、日期与完成进度',
    unavailable: '请在 iHome工作区的主会话中选择专家。',
    questionRequired: '请在专家名称后填写想咨询的问题，再发送。',
  },
  en: {
    group: 'iHome Expert Team',
    needs: 'Needs Analyst',
    'needs.description': 'Clarify household needs and renovation decisions',
    tasks: 'Task Assistant',
    'tasks.description': 'Plan renovation tasks, dates and progress',
    unavailable: 'Choose an expert in a main conversation in the iHome workspace.',
    questionRequired: 'Add your question after the expert name before sending.',
  },
} as const

export type ExpertSlashKey = keyof typeof expertSlashLocales.zh
