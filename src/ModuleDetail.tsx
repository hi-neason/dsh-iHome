import { useState } from 'react'
import { Knowledge } from './Knowledge'
import { RoomPreview } from './RoomPreview'
import type { ModuleId } from './modules'
import detailCss from './module-detail.css'
import knowledgeCss from './knowledge.css'

interface ModuleDetailProps {
  id: ModuleId | null
  onAsk: (prompt: string) => void
}

interface ModuleContent {
  intro: string
  checklist: string[]
  tasks: { title: string, description: string, prompt: string }[]
}

const content: Record<Exclude<ModuleId, 'knowledge' | 'design'>, ModuleContent> = {
  archive: {
    intro: '把房屋信息和家人的生活习惯放在一起，给后续设计、报价和施工一份共同依据。',
    checklist: ['准备原始户型图，注明版本与测量日期。', '按房间整理实测尺寸、门窗位置及现场照片。', '收集家人的日常习惯、收纳需求和设备清单。', '区分必须满足、可以妥协和还待讨论的需求。'],
    tasks: [
      { title: '梳理我家的居住需求', description: '从家庭成员和日常生活开始。', prompt: '请帮我建立家庭装修需求档案。先逐步询问家庭成员、房屋情况、日常习惯、收纳和设备需求，再按房间整理必须满足、可以妥协、待讨论的事项。对缺失信息保留待补充标记。' },
      { title: '整理图纸与量房资料', description: '建立房间、尺寸和照片的对应关系。', prompt: '我想整理自家的户型图和量房资料。请先问我已有资料及其日期，再帮我设计按房间归档的目录和尺寸记录表，区分实测与估算，列出仍需现场复核的信息。' },
    ],
  },
  materials: {
    intro: '先确认安装条件，再比较型号与价格。把采购时间和施工节点一起考虑。',
    checklist: ['记录候选产品的准确品牌、型号、规格和报价日期。', '核对尺寸、开孔、用电、给排水及安装预留要求。', '确认报价包含的配件、运输、安装和售后范围。', '结合现场工序，约定下单、到货、验货和安装时间。'],
    tasks: [
      { title: '比较候选产品', description: '按规格、价格和安装条件逐项对比。', prompt: '请帮我比较装修采购的候选产品。先询问品类、需求、预算、现场安装条件及候选型号。根据我提供的资料整理规格、价格与日期、配件、安装条件和售后对照表，缺少的参数标为待核实。' },
      { title: '安排采购清单', description: '把待购物品接到施工计划上。', prompt: '请先了解我的装修进度、设计方案和已购物品，再按房间整理待采购清单，标记需要提前确认的设备尺寸、水电预留、交付周期和安装前置条件。' },
    ],
  },
  quotes: {
    intro: '把团队的承包范围、工程量与材料做法对齐，再判断报价和合同是否符合你的需求。',
    checklist: ['收集各团队的承包范围、报价版本和对应图纸。', '核对工程量、计价单位、材料型号与施工做法。', '逐项确认暂估、遗漏、增项、税费和清运费用。', '核对付款节点、工期、变更确认和保修约定。'],
    tasks: [
      { title: '对齐两份装修报价', description: '找出范围差异和待商家澄清的项目。', prompt: '我想对比装修报价。请先问我项目范围及已有报价文件，再按相同施工内容对齐单位、工程量、单价、材料与工艺，区分明确差异与信息缺失。每项引用原报价条目，整理给商家的澄清问题。' },
      { title: '准备签约前的问题', description: '围绕付款、工期、增项和保修核对。', prompt: '请帮助我准备装修签约前的问题清单。先了解承包方式和已有合同，再检查付款节点、工期、材料替换、工程变更、验收及保修条款。请引用合同原文，缺失约定列为待双方确认。' },
    ],
  },
  budget: {
    intro: '分别记清已签合同、预计增减项和实际付款，才能看见还需要准备多少钱。',
    checklist: ['明确总预算覆盖的范围及可接受的预备金。', '收集合同金额、报价和已确认增减项。', '按收款方、日期、用途整理付款凭证。', '记录尚未采购的项目和接下来的付款节点。'],
    tasks: [
      { title: '分配第一版装修预算', description: '按实际范围拆分施工、设备与软装。', prompt: '请帮我制定第一版装修预算。先询问总预算、房屋面积、改造范围、承包方式、设备及家具需求。区分已知报价和估算，按类别分配预算与预备金，并核对总额。' },
      { title: '整理支出与待付款', description: '核对实付、合同余额及后续开销。', prompt: '请帮我整理装修支出。先询问合同、确认的增减项、付款凭证与待购物品，生成合同额、变更额、已付款、未付款和预计支出的对账表。避免把合同与付款重复相加，无法核实的金额单独列出。' },
    ],
  },
  site: {
    intro: '把工序、到场检查和待确认事项放进同一份计划，及时留下现场记录。',
    checklist: ['确认当前工序、下一道工序及其开工条件。', '核对人员安排、材料到货和设备安装时间。', '封槽、封板及其他覆盖前，安排验收和留照。', '记录现场问题、责任人、约定时间及复查结果。'],
    tasks: [
      { title: '整理近期施工计划', description: '把依赖条件和业主到场事项标清楚。', prompt: '请先了解我目前的施工阶段、已确认工期、材料到货及安装安排，再帮我整理近期施工计划。标注每道工序的前置条件、负责人、待确认日期和我需要到场的检查事项。' },
      { title: '整理一次现场记录', description: '让照片、问题和后续动作对应起来。', prompt: '我想整理一次装修现场记录。请先问我到场日期、房间、工序及照片信息，再整理已完成内容、发现的问题、待确认事项、责任人和复查时间。把照片对应到具体位置，并区分观察事实和待专业判断的问题。' },
    ],
  },
  handover: {
    intro: '交付时把检查结果、遗留问题和保修资料收齐，让入住后的维修有据可查。',
    checklist: ['按房间、工种和设备准备对应的验收项目。', '保存问题照片、整改约定和复验结果。', '核对钥匙、竣工图、设备说明书及检测资料。', '整理保修范围、起止日期、联系人和报修方式。'],
    tasks: [
      { title: '准备交付验收清单', description: '按实际施工和设备范围逐项核对。', prompt: '请先了解我的装修施工范围、设备清单和合同验收约定，再帮我准备交付验收清单。按房间和工种列出检查方法、所需资料与记录方式，标明需要专业人员或仪器检测的项目。具体标准注明依据与适用条件。' },
      { title: '整理保修与遗留问题', description: '记录责任人、期限和复验安排。', prompt: '请帮我整理装修交付后的遗留问题与保修台账。先询问合同、设备资料、问题照片和已有整改约定，再整理责任人、联系方式、约定期限、复查结果及保修起止日期。缺失信息列为待确认。' },
    ],
  },
}

function DesignStudio({ onAsk, description, onDescriptionChange }: Pick<ModuleDetailProps, 'onAsk'> & {
  description: string
  onDescriptionChange: (value: string) => void
}) {
  return (
    <div className="ih-detail-design">
      <div>
        <p className="ih-detail-intro">从房间的尺寸和生活习惯开始，一起推敲家具摆放与动线。</p>
        <form className="ih-design-form" onSubmit={event => {
          event.preventDefault()
          onAsk(`我想规划家里的一个房间。\n${description.trim() ? `${description.trim()}\n` : ''}请先问我房间的用途、实测尺寸、门窗位置，以及家人平时怎样使用它。等关键信息齐了，再一起讨论家具摆放和动线。请明确标记仍需实测或确认的信息。`)
        }}>
          <label htmlFor="ih-room-description">描述一下你想设计的房间</label>
          <textarea id="ih-room-description" rows={5} value={description} onChange={event => onDescriptionChange(event.target.value)} placeholder="例如，客厅长 4.2 米、宽 3.6 米，南边是阳台。想放三人沙发，还想给孩子留一块玩耍的地方。" />
          <button type="submit" className="ih-detail-primary">带到对话 <span aria-hidden="true">↗</span></button>
        </form>
      </div>
      <RoomPreview />
    </div>
  )
}

function ModuleChecklist({ items, checked, onChange }: {
  items: string[]
  checked: string[]
  onChange: (item: string, completed: boolean) => void
}) {
  return (
    <section className="ih-detail-checklist" aria-label="开始前准备">
      <h2>开始前，准备这些</h2>
      <ul>{items.map(item => <li key={item}><label><input type="checkbox" checked={checked.includes(item)} onChange={event => onChange(item, event.target.checked)} /><span>{item}</span></label></li>)}</ul>
    </section>
  )
}

export function ModuleDetail({ id, onAsk }: ModuleDetailProps) {
  const [description, setDescription] = useState('')
  const [checklists, setChecklists] = useState<Partial<Record<ModuleId, string[]>>>({})

  if (id === null) return null

  let body
  if (id === 'knowledge') {
    body = <Knowledge onAsk={onAsk} showHeading={false} />
  } else if (id === 'design') {
    body = <DesignStudio onAsk={onAsk} description={description} onDescriptionChange={setDescription} />
  } else {
    const module = content[id]
    body = <>
      <p className="ih-detail-intro">{module.intro}</p>
      <div className="ih-detail-columns">
        <div className="ih-detail-tasks">
          {module.tasks.map(task => <button type="button" key={task.title} onClick={() => onAsk(task.prompt)}>
            <span><strong>{task.title}</strong><span>{task.description}</span></span>
            <span className="ih-detail-task-arrow" aria-hidden="true">↗</span>
          </button>)}
        </div>
        <ModuleChecklist items={module.checklist} checked={checklists[id] ?? []} onChange={(item, completed) => {
          setChecklists(previous => {
            const otherItems = (previous[id] ?? []).filter(value => value !== item)
            return { ...previous, [id]: completed ? [...otherItems, item] : otherItems }
          })
        }} />
      </div>
    </>
  }
  return <div className="ih-module-detail"><style>{detailCss + knowledgeCss}</style>{body}</div>
}
