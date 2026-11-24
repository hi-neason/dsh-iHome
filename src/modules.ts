export const modules = [
  { id: 'archive', title: '家庭档案库', description: '整理户型、尺寸与家人需求' },
  { id: 'knowledge', title: '装修知识库', description: '读懂术语，掌握装修要点' },
  { id: 'design', title: '设计工作室', description: '推敲房间布局与生活动线' },
  { id: 'materials', title: '选材与采购', description: '对比材料，安排采购安装' },
  { id: 'quotes', title: '选商、报价与合同', description: '比较团队，核对报价条款' },
  { id: 'budget', title: '预算与记账', description: '分配预算，理清装修支出' },
  { id: 'site', title: '施工计划与现场', description: '梳理工序，跟进现场事项' },
  { id: 'handover', title: '验收、交付与保修', description: '核对交付，整理售后资料' },
] as const

export type ModuleId = typeof modules[number]['id']
