import { Fragment, type ReactNode } from 'react'
import type { Archive, Member, Need } from './archive-model'
import tableCss from './house-tables.css'

interface TableProps {
  archive: Archive
  houseId: string
  actions: (kind: 'member' | 'room', id: string) => ReactNode
}

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })

function NeedText({ text }: { text: string }) {
  if (!text) return <span className="ih-table-empty">—</span>
  const characters: string[] = []
  for (const item of segmenter.segment(text)) {
    characters.push(item.segment)
    if (characters.length === 21) break
  }
  const preview = characters.slice(0, 20).join('').replace(/\s+/g, ' ')
  if (characters.length <= 20) return <span className="ih-table-text" title={text}>{preview}</span>
  return <details className="ih-table-detail">
    <summary title={text}>
      <span className="ih-table-preview">{preview}…</span>
      <span className="ih-table-collapse">收起全文</span>
    </summary>
    <p>{text}</p>
  </details>
}

export function MembersTable({ archive, houseId, actions, memberConfirmation }: TableProps & {
  memberConfirmation: (member: Member) => ReactNode
}) {
  return <div className="ih-table-scroll" role="region" aria-label="家人表格" tabIndex={0}>
    <style>{tableCss}</style>
    <table className="ih-records-table ih-members-table">
      <thead><tr>
        <th scope="col">称呼</th><th scope="col">性别</th><th scope="col">年龄</th>
        <th scope="col">居住时间</th><th scope="col">居住需求</th><th scope="col">操作</th>
      </tr></thead>
      <tbody>
        {!archive.members.length && <tr><td colSpan={6} className="ih-table-empty">暂无家人，点击「添加家人」开始记录。</td></tr>}
        {archive.members.map(member => {
          const needs = archive.needs.filter(need => need.houseId === houseId && need.memberIds.includes(member.id))
          const text = [member.needsText?.trim(), ...needs.map(need => need.title)].filter(Boolean).join('\n')
          const confirmation = memberConfirmation(member)
          return <Fragment key={member.id}>
            <tr>
              <th scope="row">{member.name}</th>
              <td>{member.gender || '—'}</td>
              <td>{member.age === undefined ? '—' : `${member.age} 岁`}</td>
              <td>{member.residency === '待确认' ? '—' : member.residency}</td>
              <td><NeedText text={text} /></td>
              <td className="ih-table-actions">{actions('member', member.id)}</td>
            </tr>
            {confirmation && <tr className="ih-table-confirmation"><td colSpan={6}>{confirmation}</td></tr>}
          </Fragment>
        })}
      </tbody>
    </table>
  </div>
}

function AssociatedNeeds({ needs, archive }: { needs: Need[], archive: Archive }) {
  const memberIds = new Set(needs.flatMap(need => need.memberIds))
  return <>
    <td><NeedText text={needs.map(need => need.title).join('\n')} /></td>
    <td>{archive.members.filter(member => memberIds.has(member.id)).map(member => member.name).join('、') || <span className="ih-table-empty">—</span>}</td>
  </>
}

export function RoomsTable({ archive, houseId, actions }: TableProps) {
  const rooms = archive.rooms.filter(room => room.houseId === houseId)
  const needs = archive.needs.filter(need => need.houseId === houseId)
  return <div className="ih-table-scroll" role="region" aria-label="房间或区域表格" tabIndex={0}>
    <style>{tableCss}</style>
    <table className="ih-records-table ih-rooms-table">
      <thead><tr><th scope="col">名称</th><th scope="col">关联需求</th><th scope="col">关联家人</th><th scope="col">操作</th></tr></thead>
      <tbody>
        {!rooms.length && <tr><td colSpan={4} className="ih-table-empty">暂无房间或区域，点击「添加房间或区域」开始记录。</td></tr>}
        {rooms.map(room => <tr key={room.id} className="ih-table-room">
          <th scope="row">{room.name}</th>
          <AssociatedNeeds needs={needs.filter(need => need.roomIds.includes(room.id))} archive={archive} />
          <td className="ih-table-actions">{actions('room', room.id)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}
