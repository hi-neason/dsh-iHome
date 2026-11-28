export const modules = [
  { id: 'archive', title: '需求分析师', description: '梳理家人需求，落实到房间或区域' },
  { id: 'knowledge', title: '装修知识助手', description: '随时解答疑问，读懂装修门道' },
  { id: 'documents', title: '文档资料员', description: '归集各阶段文档，查找图纸与物料' },
  { id: 'tasks', title: '任务待办助理', description: '安排装修日程，跟进待办和完成进度' },
  { id: 'design', title: '户型设计师', description: '推敲空间布局，让生活更顺手' },
  { id: 'fengshui', title: '风水大师', description: '结合传统国学，推敲居家风水布局' },
  { id: 'materials', title: '选材采购买手', description: '比较材料设备，安排采购到货' },
  { id: 'quotes', title: '选商核价分析师', description: '比较装修团队，核对报价合同' },
  // Existing budget conversations remain addressable by their persisted ID.
  { id: 'budget', title: '财务经费专员', description: '全阶段记账，核对支出与分析经费' },
  { id: 'site', title: '施工项目经理', description: '衔接施工工序，跟进现场问题' },
  { id: 'handover', title: '验收监理', description: '逐项核对交付，追踪整改复验' },
  { id: 'movein', title: '入住规划师', description: '安排搬家入住，照顾日常维护' },
] as const

export type ModuleId = typeof modules[number]['id']

export const stages = [
  { id: 'design', title: '设计阶段', agentIds: ['archive', 'design', 'fengshui'] },
  { id: 'selection', title: '选商阶段', agentIds: ['quotes'] },
  { id: 'construction', title: '施工阶段', agentIds: ['materials', 'site'] },
  { id: 'acceptance', title: '验收阶段', agentIds: ['handover'] },
  { id: 'movein', title: '入住阶段', agentIds: ['movein'] },
] as const satisfies readonly { id: string, title: string, agentIds: readonly ModuleId[] }[]
