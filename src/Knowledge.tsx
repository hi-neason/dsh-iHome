import { useRef } from 'react'

interface KnowledgeProps {
  onAsk?: (question: string) => void
  showHeading?: boolean
}

const guides = [
  {
    id: 'measure',
    category: '空间与尺寸',
    title: '量房，从哪里开始？',
    description: '先记下这些尺寸，再谈理想布局。',
    introduction: '带上卷尺、纸笔和手机，按房间逐一记录。所有尺寸统一用毫米，估算值单独标注。',
    items: [
      '画出房间轮廓，记录每段墙长、层高，以及梁柱的位置和尺寸。',
      '测量门窗宽高、窗台高度，以及门窗到两侧墙角的距离，并标出开门方向。',
      '拍下给排水、燃气、插座和空调孔的位置，并把照片对应到草图。',
      '大件家具进场前，再复核电梯、入户门和走道的可通行尺寸。',
    ],
    note: '给草图写上房间名和测量日期，标注照片拍摄方向，方便之后与设计师一起核对。',
    question: '我第一次给家里量房。请先问我房屋和房间的情况，再帮我整理一份量房记录表，标出需要现场复核的尺寸。',
  },
  {
    id: 'quote',
    category: '预算与合同',
    title: '看懂第一份半包报价',
    description: '从承包范围、计价方式到容易漏的项。',
    introduction: '对比报价时，把相同工程内容放在一起看。先确认施工范围，再比较单价与总价。',
    items: [
      '逐项核对项目名称、单位、工程量、单价和小计，问清面积与长度如何计算。',
      '把材料品牌、型号、规格和施工做法写入约定，明确哪些材料需要自己购买。',
      '确认拆除、清运、搬运、成品保护、找平和税费是否包含，漏项请商家书面补充。',
      '问清水电等暂估项目怎样结算，并约定增项先确认范围与价格，再施工。',
    ],
    note: '“半包”的具体范围以双方书面约定为准。未列明的费用应逐项向商家确认。',
    question: '我准备看第一份半包报价。请先了解我的房屋情况和承包范围，再帮我整理向装修公司询问的报价澄清清单。',
  },
  {
    id: 'inspect',
    category: '施工与验收',
    title: '封起来之前，检查什么？',
    description: '把隐蔽工程的检查和留照安排在前面。',
    introduction: '与施工方提前约好验收时间。需要专业仪器或专业判断的项目，安排相应人员到场。',
    items: [
      '封槽、封板前核对水电点位、线路走向和设备预留，与最终确认的图纸对应。',
      '确认给水试压、排水通畅和电气检测已完成，保存检测条件、结果及相关记录。',
      '防水覆盖前按适用规范与约定完成检查及试验，核对门口、管根等细节。',
      '按房间拍摄全景与细节，保留带尺寸的管线位置图。问题整改后复查再覆盖。',
    ],
    note: '具体检测方法与合格标准，结合工程做法、当地适用规范及合同约定确认。',
    question: '请先问我目前施工到哪个工序，再帮我准备这一阶段隐蔽工程覆盖前的检查清单，说明哪些项目需要专业人员检测。',
  },
] as const

function KnowledgeCard({ guide, onAsk }: KnowledgeProps & { guide: typeof guides[number] }) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)

  function close() {
    if (detailsRef.current) detailsRef.current.open = false
    summaryRef.current?.focus()
  }

  return (
    <details className="ih-guide" ref={detailsRef} onKeyDown={event => {
      if (event.key === 'Escape' && detailsRef.current?.open) {
        event.stopPropagation()
        close()
      }
    }}>
      <summary className="ih-guide-summary" ref={summaryRef}>
        <span className={`ih-guide-drawing ih-guide-drawing-${guide.id}`} aria-hidden="true">
          <i /><i /><i />
        </span>
        <span className="ih-guide-copy">
          <span className="ih-guide-category">{guide.category}</span>
          <span className="ih-guide-title">{guide.title}</span>
          <span className="ih-guide-description">{guide.description}</span>
        </span>
        <span className="ih-guide-arrow" aria-hidden="true">↗</span>
      </summary>
      <div className="ih-guide-content">
        <p>{guide.introduction}</p>
        <ul>{guide.items.map(item => <li key={item}>{item}</li>)}</ul>
        <p className="ih-guide-note">{guide.note}</p>
        <div className="ih-guide-actions">
          {onAsk && <button type="button" onClick={() => onAsk(guide.question)}>结合我家聊一聊 <span aria-hidden="true">↗</span></button>}
          <button type="button" className="ih-guide-close" onClick={close}>收起 <span aria-hidden="true">↑</span></button>
        </div>
      </div>
    </details>
  )
}

export function Knowledge({ onAsk, showHeading = true }: KnowledgeProps) {
  return (
    <section className="ih-knowledge" aria-label="装修知识库">
      {showHeading && <div className="ih-knowledge-heading">
        <h2>装修知识库</h2>
      </div>}
      <div className="ih-guide-grid">
        {guides.map(guide => <KnowledgeCard key={guide.id} guide={guide} onAsk={onAsk} />)}
      </div>
    </section>
  )
}
