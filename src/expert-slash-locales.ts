export const expertSlashLocales = {
  zh: {
    group: 'iHome专家团',
    needs: '需求分析师',
    'needs.description': '梳理家人的居住需求与装修决定',
    design: '户型设计师',
    'design.description': '通过对话设计平面、3D户型及多层空间',
    quotes: '选商核价分析师',
    'quotes.description': '筛选装修团队，核查报价、合同与价格依据',
    tasks: '任务待办助理',
    'tasks.description': '安排装修任务、日期与完成进度',
    unavailable: '请在 iHome工作区的主会话中选择专家。',
    questionRequired: '请在专家名称后填写想咨询的问题，再发送。',
  },
  en: {
    group: 'iHome Expert Team',
    needs: 'Needs Analyst',
    'needs.description': 'Clarify household needs and renovation decisions',
    design: 'Floor Plan Designer',
    'design.description': 'Design floor plans, 3D homes and multiple levels',
    quotes: 'Contractor and Quote Analyst',
    'quotes.description': 'Compare contractors, quotes and contract terms',
    tasks: 'Task Assistant',
    'tasks.description': 'Plan renovation tasks, dates and progress',
    unavailable: 'Choose an expert in a main conversation in the iHome workspace.',
    questionRequired: 'Add your question after the expert name before sending.',
  },
} as const

export type ExpertSlashKey = keyof typeof expertSlashLocales.zh
