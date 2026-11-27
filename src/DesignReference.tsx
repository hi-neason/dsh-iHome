import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ArchiveDialog } from './ArchiveDialog'
import type { ArchiveService } from './archive-model'
import type { DesignFloor, DesignReference } from './design-model'
import { DesignPlan, type DesignPlanProps } from './DesignPlan'
import { calibratedSize } from './design-calibration'
import { storeDesignAsset, readDesignAsset } from './design-media-client'

export function ReferencedPlan(props: DesignPlanProps) {
  const id = props.model.floors.find(floor => floor.id === props.floorId)?.reference?.assetId
  const [image, setImage] = useState<{ id: string, url?: string, error?: string }>()
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    let url: string | undefined
    readDesignAsset(id, controller.signal).then(blob => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      setImage({ id, url })
    }).catch(error => { if (!controller.signal.aborted) setImage({ id, error: String(error.message ?? error) }) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [id])
  return <>{image?.id === id && image?.error && <p role="alert">{image.error}</p>}
    <DesignPlan {...props} referenceUrl={image?.id === id ? image?.url : undefined} /></>
}

export function DesignReferenceEditor({ floor, archive, disabled, save }: {
  floor: DesignFloor, archive: ArchiveService, disabled: boolean, save: (ref?: DesignReference) => Promise<boolean>,
}) {
  const [open, setOpen] = useState(false)
  return <div className="ih-design-bar">
    <button disabled={disabled} onClick={() => setOpen(true)}>{floor.reference ? '更换或校准底图' : '导入户型底图'}</button>
    {floor.reference && <><span>{floor.reference.name} · {floor.reference.width.toFixed(2)} × {floor.reference.depth.toFixed(2)} m</span>
      <button disabled={disabled} onClick={() => void save(undefined)}>移除底图</button></>}
    {open && <ReferenceDialog archive={archive} original={floor.reference} save={save} close={() => setOpen(false)} />}
  </div>
}

type Point = { x: number, y: number }
function ReferenceDialog({ archive, original, save, close }: {
  archive: ArchiveService, original?: DesignReference, save: (ref: DesignReference) => Promise<boolean>, close: () => void,
}) {
  const [source, setSource] = useState<{ blob: Blob, name: string, id?: string }>()
  const [url, setUrl] = useState('')
  const [files, setFiles] = useState<{ id: string, name: string }[]>([])
  const [points, setPoints] = useState<Point[]>([])
  const [distance, setDistance] = useState('')
  const [x, setX] = useState(String(original?.x ?? 0)), [z, setZ] = useState(String(original?.z ?? 0))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const img = useRef<HTMLImageElement>(null)
  const sequence = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    const ticket = sequence.current
    archive.load().then(data => {
      if (!controller.signal.aborted) setFiles(data.attachments.filter(doc => (!doc.stage || doc.stage === 'original') && /\.(png|jpe?g|webp)$/i.test(doc.file.name)).map(doc => ({ id: doc.id, name: doc.name })))
    }).catch(err => { if (!controller.signal.aborted) setError(String(err.message ?? err)) })
    if (original) readDesignAsset(original.assetId, controller.signal).then(blob => {
      if (sequence.current === ticket && !controller.signal.aborted) setSource({ blob, name: original.name, id: original.assetId })
    }).catch(err => { if (sequence.current === ticket && !controller.signal.aborted) setError(String(err.message ?? err)) })
    return () => { controller.abort(); sequence.current++ }
  }, [archive, original])
  useEffect(() => {
    setPoints([]); setDistance('')
    if (!source) { setUrl(''); return }
    const next = URL.createObjectURL(source.blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [source])
  async function chooseArchive(id: string) {
    const ticket = ++sequence.current
    const file = files.find(value => value.id === id)
    if (!file) return
    setSource(undefined); setError('')
    try {
      const blob = await archive.downloadFile(id)
      if (ticket === sequence.current) setSource({ blob, name: file.name })
    } catch (err) { if (ticket === sequence.current) setError(String(err)) }
  }
  function mark(event: MouseEvent<HTMLImageElement>) {
    const image = event.currentTarget, rect = image.getBoundingClientRect()
    if (!image.naturalWidth) return
    const point = { x: (event.clientX - rect.left) * image.naturalWidth / rect.width, y: (event.clientY - rect.top) * image.naturalHeight / rect.height }
    setPoints(previous => previous.length === 1 ? [...previous, point] : [point])
  }
  async function commit() {
    if (!source || !img.current || busy || points.length !== 2) return
    setBusy(true); setError('')
    try {
      const size = calibratedSize(img.current.naturalWidth, img.current.naturalHeight, points[0], points[1], Number(distance))
      const assetId = source.id ?? await storeDesignAsset(source.blob, source.name)
      if (await save({ assetId, name: source.name, x: Number(x), z: Number(z), ...size })) close()
      else setError('底图未保存，请核对当前草稿后重试。')
    } catch (err) { setError(err instanceof Error ? err.message : '底图保存失败。') }
    finally { setBusy(false) }
  }
  return <ArchiveDialog title="校准本层户型图" busy={busy} onDismiss={close}><form className="ih-design-form" onSubmit={e => { e.preventDefault(); void commit() }}><fieldset disabled={busy}>
    <label>本地图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
      const file = e.target.files?.[0]
      if (file) { sequence.current++; setError(''); setSource({ blob: file, name: file.name }) }
    }} /></label>
    {!!files.length && <label>家庭档案原图<select defaultValue="" onChange={e => void chooseArchive(e.target.value)}>
      <option value="">选择已归档的图片</option>{files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}
    </select></label>}
    {source && url && <><span>依次点击一段已知长度的两个端点。</span>
      <div className="ih-reference-points"><img ref={img} src={url} alt="待校准的户型底图" onClick={mark}
        onError={() => setError('图片无法解码，请选择 PNG、JPEG 或 WebP。')} />
        {points.map((point, index) => <i key={index} aria-hidden style={{ left: 100 * point.x / img.current!.naturalWidth + '%', top: 100 * point.y / img.current!.naturalHeight + '%' }} />)}
      </div>
      <label>两点实际距离（米）<input required type="number" step="any" min=".001" value={distance} onChange={e => setDistance(e.target.value)} /></label>
      <label>图纸左上角 X（米）<input type="number" required step="any" value={x} onChange={e => setX(e.target.value)} /></label>
      <label>图纸左上角 Z（米）<input type="number" required step="any" value={z} onChange={e => setZ(e.target.value)} /></label>
      <button disabled={points.length !== 2 || !(Number(distance) > 0)}>使用这张底图</button></>}
    {error && <p role="alert">{error}</p>}
  </fieldset></form></ArchiveDialog>
}
