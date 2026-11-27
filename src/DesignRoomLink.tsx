import { useEffect, useState } from 'react'
import type { ArchiveService } from './archive-model'

export function DesignRoomLink({ archive, value, disabled, change }: {
  archive: ArchiveService, value?: string, disabled: boolean, change: (id?: string) => void,
}) {
  const [rooms, setRooms] = useState<{ id: string, name: string }[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    archive.load().then(data => { if (active) setRooms(data.rooms) }).catch(err => {
      if (active) setError(String(err.message ?? err))
    })
    return () => { active = false }
  }, [archive])
  return <div className="ih-design-bar"><label>关联家庭档案中的房间或区域 <select disabled={disabled || !rooms} value={value ?? ''} onChange={e => change(e.target.value || undefined)}>
    <option value="">未关联</option>
    {value && rooms && !rooms.some(room => room.id === value) && <option value={value}>原档案房间已移除</option>}
    {rooms?.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
  </select></label>{error && <p role="alert">{error}</p>}</div>
}
