import { useId, useState } from 'react'
import roomImage from './assets/living-room.webp'
import previewCss from './room-preview.css'

function RoomPlan() {
  const hatch = useId()
  return (
    <svg className="ih-plan" viewBox="0 0 460 300" role="img" aria-label="客厅布局俯视示意，长窗在左，沙发靠后墙，茶几和单椅围绕地毯布置。"
      fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(36)">
          <path d="M0 0v6" stroke="currentColor" strokeWidth="1" opacity=".45" />
        </pattern>
      </defs>
      {/* Cut walls and the four-panel window along the left edge. */}
      <path d="M61 249V46h328v8H69v195z" fill="currentColor" />
      <path d="M63 74v144h5V74z" strokeWidth="1" fill="var(--ih-board)" />
      <path d="M62 110h7m-7 36h7m-7 36h7" />
      <path d="M69 249h320V54" strokeDasharray="5 4" opacity=".55" />
      {/* Sofa, rug, low table and a reading chair, seen from above. */}
      <rect x="125" y="96" width="213" height="122" rx="3" fill={`url(#${hatch})`} strokeOpacity=".6" />
      <g fill="var(--ih-board)">
        <rect x="154" y="65" width="205" height="66" rx="6" />
        <rect x="162" y="70" width="187" height="13" rx="4" />
        <rect x="161" y="83" width="57" height="39" rx="5" />
        <rect x="220" y="83" width="62" height="39" rx="5" />
        <rect x="284" y="83" width="66" height="39" rx="5" />
        <rect x="199" y="147" width="89" height="43" rx="21.5" />
        <path d="m249 157 17 3-2 13-17-3z" />
        <g transform="rotate(25 140 193)">
          <rect x="117" y="165" width="44" height="56" rx="6" />
          <rect x="123" y="170" width="32" height="34" rx="5" />
          <rect x="121" y="205" width="36" height="11" rx="4" />
        </g>
        <circle cx="108" cy="88" r="16" />
        <path d="M108 72c9-8 17-1 15 5 12 1 13 14 5 19 2 10-12 15-19 10-8 8-18 2-18-7-9-5-8-18 1-21 0-7 9-11 16-6Z" />
        <path d="m99 97 14-20m-9 13 12 4m-10-8-6-6" opacity=".6" />
      </g>
      <g strokeWidth="1" opacity=".6">
        <path d="M61 29h328M61 24v12m328-12v12M407 46v203m-5-203h11m-11 203h11" />
        <path d="m58 32 6-6m322 6 6-6m12 23 6-6m-6 209 6-6" />
      </g>
    </svg>
  )
}

function ViewIcon({ plan }: { plan: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round">
      {plan ? <path d="M3.5 3.5h13v13h-13zM9 3.5v5.8h7.5M9 12v4.5" /> :
        <path d="m10 2 7 4v8l-7 4-7-4V6zM3 6l7 4 7-4m-7 4v8" />}
    </svg>
  )
}

export function RoomPreview() {
  const [view, setView] = useState<'model' | 'plan'>('model')
  return (
    <figure className="ih-preview">
      <style>{previewCss}</style>
      <div className="ih-board">
        <div className="ih-registers" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="ih-exhibit" key={view}>
          {view === 'model'
            ? <img className="ih-model" src={roomImage} width="1536" height="1024" alt="客厅剖面模型，落地窗的光照在浅色沙发、椭圆茶几与休闲椅上。" draggable={false} />
            : <RoomPlan />}
        </div>
      </div>
      <figcaption className="ih-preview-caption">
        <span className="ih-figure-label"><i aria-hidden="true" />客厅布局示例</span>
        <span className="ih-views" role="group" aria-label="示例视图">
          <button type="button" aria-pressed={view === 'model'} onClick={() => setView('model')}><ViewIcon plan={false} />空间</button>
          <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}><ViewIcon plan />平面</button>
        </span>
      </figcaption>
    </figure>
  )
}
