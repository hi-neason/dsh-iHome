import type { ArchiveTool } from './archive-host'

export function createRecordProposalTool(execute: ArchiveTool['execute']): ArchiveTool {
  return {
    name: 'ihome_propose_record',
    description: '在当前对话展示生活事实或量房尺寸的修改，用户接受后直接保存到本地档案。houseId 默认为当前房屋。kind=fact 记录生活习惯，people 为涉及的家人称呼，修改已有事实前先读取它并传 targetFactId。kind=measurement 记录房间或区域的尺寸、来源和测量日期，调整原值前先读取并传 previousMeasurementId。adopted 表示是否作为当前采用值。quote 保留用户原话，缺少信息先追问。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        houseId: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'measurement'] }, quote: { type: 'string' },
        text: { type: 'string', description: 'kind=fact 时必填，生活事实的内容。' },
        people: { type: 'array', items: { type: 'string' }, description: 'kind=fact 时必填，至少一位相关家人的称呼。' },
        targetFactId: { type: 'string' },
        room: { type: 'string', description: 'kind=measurement 时必填，填写一个房间或区域的名称。' },
        label: { type: 'string', description: 'kind=measurement 时必填，测量项目名称。' },
        value: { type: 'number', description: 'kind=measurement 时必填，大于零的测量值。' },
        unit: { type: 'string', enum: ['mm', 'cm', 'm'], description: 'kind=measurement 时必填。' },
        source: { type: 'string', enum: ['实测', '图纸', '估算'], description: 'kind=measurement 时必填。' },
        date: { type: 'string', description: 'kind=measurement 时必填，测量日期 YYYY-MM-DD。' },
        adopted: { type: 'boolean', description: 'kind=measurement 时必填，是否建议用户采信。' },
        previousMeasurementId: { type: 'string' },
      },
      required: ['kind', 'quote'],
    },
    output: {
      schema: {},
      render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
    },
    execute,
  }
}
