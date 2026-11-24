import type { CSSProperties } from 'react'
import shell from './assets/renovation/shell.webp'
import utilities from './assets/renovation/utilities.webp'
import finishes from './assets/renovation/finishes.webp'
import cabinetry from './assets/renovation/cabinetry.webp'
import furniture from './assets/renovation/furniture.webp'
import styled from './assets/renovation/styled.webp'
import exhibitCss from './house-exhibit.css'

const stages = [
  { name: '毛坯交付', image: shell, wipe: '0' },
  { name: '水电布线', image: utilities, wipe: '0 100% 0 0' },
  { name: '墙地面完工', image: finishes, wipe: '0 0 100% 0' },
  { name: '柜体安装', image: cabinetry, wipe: '100% 0 0 0' },
  { name: '家具进场', image: furniture, wipe: '0 0 0 100%' },
  { name: '灯光与软装', image: styled, wipe: '0' },
]

export function HouseExhibit() {
  return (
    <div className="ih-house-exhibit" role="img" aria-label={`同一间房的装修过程：${stages.map(stage => stage.name).join('、')}。`}>
      <style>{exhibitCss}</style>
      {stages.map((stage, index) => (
        <div key={stage.name} className="ih-renovation-stage"
          style={{ '--ih-stage-index': index, '--ih-entry-inset': stage.wipe } as CSSProperties}
          aria-hidden="true">
          <img className="ih-renovation-image" src={stage.image} alt="" draggable={false} />
          <div className="ih-renovation-caption">
            <span className="ih-renovation-count">{String(index + 1).padStart(2, '0')} / 06</span>
            <span>{stage.name}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
