import { useEffect, useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import type { DesignModel, DesignFloor, DesignItem, DesignOpening, DesignWall } from './design-model'
import { planBounds, type PlanPoint, type PlanBounds } from './design-geometry'
import { drawingLabels, drawDesignElement, findDesignElement, moveDesignElement, removeDesignElement, snapPoint, updateDesignElement, type DesignElement, type DrawingTool } from './design-edit'
import css from './design-plan.css'

export interface DesignPlanProps {
  model: DesignModel
  floorId: string
  selectedId: string | null
  onSelect(id: string | null): void
  onChange(model: DesignModel): void
  readonly?: boolean
  referenceUrl?: string
}
const tools: DrawingTool[] = ['select', 'wall', 'room', 'door', 'window', 'furniture', 'stair', 'void']
function numberLabel(value: number): string { return Number(value.toFixed(2)).toString() }

function ValueField({ label, value, onChange, disabled, min, max, step = .1 }: {
  label: string, value: number | string, onChange(value: string): void, disabled?: boolean, min?: number, max?: number, step?: number,
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  function commit() {
    if (draft !== String(value)) onChange(draft)
  }
  return <label>{label}<input type={typeof value === 'number' ? 'number' : 'text'} value={draft} disabled={disabled}
    min={min} max={max} step={step} onChange={event => setDraft(event.currentTarget.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} /></label>
}

function PropertyEditor({ floor, model, selectedId, readonly, onChange, onRemove }: {
  floor: DesignFloor, model: DesignModel, selectedId: string, readonly: boolean,
  onChange(patch: Partial<DesignElement>): void, onRemove(): void,
}) {
  const item = findDesignElement(floor, selectedId)
  if (!item) return null
  function numeric(key: string, label: string, min?: number, max?: number, step = .1) {
    const value = (item as unknown as Record<string, number>)[key]
    return <ValueField key={key} label={label} value={Number(value.toFixed(3))} min={min} max={max} step={step} disabled={readonly}
      onChange={text => { if (text.trim()) onChange({ [key]: Number(text) }) }} />
  }
  return <section className="ih-plan-properties" aria-label="对象属性">
    <div className="ih-plan-property-heading"><strong>{'x1' in item ? '墙体' : drawingLabels[item.kind]}</strong><span>尺寸单位 m</span></div>
    <ValueField label="名称" value={item.name} disabled={readonly} onChange={name => onChange({ name })} />
    <div className="ih-plan-fields">
      {'x1' in item ? <>
        {numeric('x1', '起点 X')}{numeric('z1', '起点 Z')}{numeric('x2', '终点 X')}{numeric('z2', '终点 Z')}
        {numeric('thickness', '墙厚', .05, 2, .01)}
      </> : 'wallId' in item ? <>
        {numeric('offset', '距墙起点', 0)}{numeric('width', '宽度', .1)}
        {numeric('sill', '离地高度', 0, floor.height)}{numeric('height', '高度', .1, floor.height)}
      </> : <>
        {numeric('x', '中心 X')}{numeric('z', '中心 Z')}{numeric('width', '宽度', .1)}{numeric('depth', '进深', .1)}
        {numeric('height', '高度', .01)}{numeric('rotation', '旋转角度', -360, 360, 5)}
        {item.kind === 'stair' && <label>连接楼层<select disabled={readonly} value={item.targetFloorId ?? ''}
          onChange={event => onChange({ targetFloorId: event.currentTarget.value })}>
          {model.floors.filter(value => value.elevation > floor.elevation).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
        </select></label>}
      </>}
    </div>
    {!readonly && <button className="ih-plan-remove" type="button" onClick={onRemove}>删除{item.name}</button>}
  </section>
}

function ItemShape({ item, selected }: { item: DesignItem, selected: boolean }) {
  const { width, depth } = item
  const steps = Array.from({ length: Math.max(3, Math.min(25, Math.ceil(item.height / .18))) }, (_value, index) => index)
  return <g transform={`translate(${item.x} ${item.z}) rotate(${item.rotation})`} className={`ih-plan-item ih-plan-${item.kind}`} data-selected={selected}>
    <rect x={-width / 2} y={-depth / 2} width={width} height={depth} rx={item.kind === 'furniture' ? .06 : 0} />
    {item.kind === 'stair' && <g className="ih-plan-detail">
      {steps.map(index => <path key={index} d={`M${-width / 2} ${-depth / 2 + depth * index / steps.length}h${width}`} />)}
      <path d={`M0 ${-depth * .35}v${depth * .7}m${-width * .18} ${-depth * .1}l${width * .18} ${depth * .1}l${width * .18} ${-depth * .1}`} />
    </g>}
    {item.kind === 'void' && <path className="ih-plan-detail" d={`M${-width / 2} ${-depth / 2}l${width} ${depth}m${-width} 0l${width} ${-depth}`} />}
    <text textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(.23, width / Math.max(item.name.length, 1) * 1.4)}>{item.name}</text>
    {item.kind === 'room' && <text className="ih-plan-measure" y=".34" textAnchor="middle" fontSize=".18">{numberLabel(width)} × {numberLabel(depth)} m</text>}
  </g>
}
function OpeningShape({ opening, wall, selected }: { opening: DesignOpening, wall: DesignWall, selected: boolean }) {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
  const angle = Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1) * 180 / Math.PI
  return <g className={'ih-plan-opening ih-plan-' + opening.kind} data-selected={selected}
    transform={`translate(${wall.x1 + (wall.x2 - wall.x1) * opening.offset / length} ${wall.z1 + (wall.z2 - wall.z1) * opening.offset / length}) rotate(${angle})`}>
    <rect x="0" y={-wall.thickness / 2 - .02} width={opening.width} height={wall.thickness + .04} />
    {opening.kind === 'door'
      ? <path className="ih-plan-detail" d={`M0 0v${opening.width}A${opening.width} ${opening.width} 0 0 0 ${opening.width} 0`} />
      : <path className="ih-plan-detail" d={`M0 -.035h${opening.width}M0 .035h${opening.width}`} />}
  </g>
}

export function DesignPlan({ model, floorId, selectedId, onSelect, onChange, readonly = false, referenceUrl }: DesignPlanProps) {
  const floor = model.floors.find(item => item.id === floorId)
  const svg = useRef<SVGSVGElement>(null)
  const gridId = useId().replace(/:/g, '')
  const [tool, setTool] = useState<DrawingTool>('select')
  const [view, setView] = useState<PlanBounds>(() => planBounds(floor))
  const [wallStart, setWallStart] = useState<PlanPoint>()
  const [pointer, setPointer] = useState<PlanPoint>()
  const [preview, setPreview] = useState<DesignModel>()
  const [error, setError] = useState('')
  const drag = useRef<{ id?: string, point: PlanPoint, model: DesignModel, view: PlanBounds, moved: boolean }>()
  const current = preview?.floors.find(item => item.id === floorId) ?? floor
  useEffect(() => { setView(planBounds(floor)); setWallStart(undefined); setPreview(undefined); drag.current = undefined }, [floorId])
  useEffect(() => {
    // A conversation edit or scheme/version switch invalidates in-progress gestures.
    drag.current = undefined
    setPreview(undefined)
    setWallStart(undefined)
  }, [model])
  useEffect(() => { if (readonly) { setTool('select'); setWallStart(undefined); drag.current = undefined; setPreview(undefined) } }, [readonly])
  if (!floor || !current) return <p role="status">请选择一个楼层。</p>

  function pointAt(event: PointerEvent<SVGSVGElement>): PlanPoint {
    const element = svg.current!
    const matrix = element.getScreenCTM()
    if (!matrix) return { x: 0, z: 0 }
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: point.x, z: point.y }
  }
  function commit(next: DesignModel) {
    setError('')
    try { onChange(next) } catch (cause) { setError(cause instanceof Error ? cause.message : '无法修改，请检查尺寸。') }
  }
  function add(point: PlanPoint, end?: PlanPoint) {
    if (readonly || tool === 'select') return
    try {
      const next = drawDesignElement(model, floorId, tool, point, end)
      onChange(next.model)
      onSelect(next.id)
      setError('')
      setWallStart(undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法添加对象。') }
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    const point = pointAt(event)
    const id = (event.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id') ?? undefined
    if (tool === 'select') {
      onSelect(id ?? null)
      drag.current = { id: readonly ? undefined : id, point, model, view, moved: false }
    } else {
      drag.current = { point, model, view, moved: false }
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const point = pointAt(event)
    setPointer(snapPoint(point))
    const value = drag.current
    if (!value) return
    const delta = snapPoint({ x: point.x - value.point.x, z: point.z - value.point.z })
    value.moved ||= Math.hypot(delta.x, delta.z) >= .1
    if (tool !== 'select' || !value.moved) return
    if (value.id) setPreview(moveDesignElement(value.model, floorId, value.id, delta))
    else setView({ ...view, x: view.x - (point.x - value.point.x), z: view.z - (point.z - value.point.z) })
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const value = drag.current
    drag.current = undefined
    if (!value) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const point = snapPoint(pointAt(event))
    if (tool === 'select') {
      if (value.id && value.moved) {
        commit(moveDesignElement(value.model, floorId, value.id, snapPoint({ x: point.x - value.point.x, z: point.z - value.point.z })))
      }
      setPreview(undefined)
    } else if (tool === 'wall') {
      if (wallStart) add(wallStart, point)
      else if (value.moved) add(snapPoint(value.point), point)
      else setWallStart(point)
    } else add(point)
  }
  function zoom(factor: number) {
    setView(value => {
      const width = Math.max(2, Math.min(200, value.width * factor)), depth = width * value.depth / value.width
      return { x: value.x + (value.width - width) / 2, z: value.z + (value.depth - depth) / 2, width, depth }
    })
  }
  function keyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'Escape') { setWallStart(undefined); setTool('select'); drag.current = undefined; setPreview(undefined) }
    if (!readonly && selectedId && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault(); commit(removeDesignElement(model, floorId, selectedId)); onSelect(null)
    }
  }
  const reference = floor.reference
  const elements = [...floor.walls, ...floor.openings, ...floor.items]
  const instructions = readonly ? '拖动空白处平移，选择对象查看尺寸。'
    : tool === 'select' ? '拖动对象移动，拖动空白处平移。尺寸单位 m，吸附 0.1 m。'
    : tool === 'wall' ? (wallStart ? '点击墙体终点，Esc 取消。' : '拖出一面墙，或依次点击两个端点。')
    : tool === 'door' || tool === 'window' ? '点击墙体放置，再在属性中调整尺寸。' : '点击平面放置，再拖动或编辑尺寸。'
  return <section className="ih-design-plan" aria-label="平面图编辑器">
    <style>{css}</style>
    {!readonly && <div className="ih-plan-tools" role="toolbar" aria-label="绘图工具">
      {tools.map(value => <button key={value} type="button" aria-pressed={tool === value} onClick={() => {
        setTool(value); setWallStart(undefined); setError('')
      }}>{drawingLabels[value]}</button>)}
    </div>}
    <div className="ih-plan-canvas-wrap">
      <svg ref={svg} className="ih-plan-canvas" viewBox={`${view.x} ${view.z} ${view.width} ${view.depth}`} tabIndex={0}
        aria-label={`${floor.name}平面图，${instructions}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
        onPointerCancel={() => { drag.current = undefined; setPreview(undefined) }} onKeyDown={keyDown}>
        <defs><pattern id={gridId} width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" className="ih-plan-grid" strokeWidth=".012" /></pattern></defs>
        <rect x={view.x} y={view.z} width={view.width} height={view.depth} fill={`url(#${gridId})`} />
        {reference && referenceUrl && <image href={referenceUrl} x={reference.x} y={reference.z} width={reference.width} height={reference.depth} preserveAspectRatio="none" opacity=".48" pointerEvents="none" />}
        {current.items.filter(item => item.kind === 'room').map(item => <g key={item.id} data-element-id={item.id}><ItemShape item={item} selected={selectedId === item.id} /></g>)}
        {current.walls.map(wall => <g key={wall.id} data-element-id={wall.id} className="ih-plan-wall" data-selected={selectedId === wall.id}>
          <path d={`M${wall.x1} ${wall.z1}L${wall.x2} ${wall.z2}`} strokeWidth={wall.thickness} />
          <path className="ih-plan-wall-hit" d={`M${wall.x1} ${wall.z1}L${wall.x2} ${wall.z2}`} strokeWidth={Math.max(.3, wall.thickness)} />
          <text x={(wall.x1 + wall.x2) / 2} y={(wall.z1 + wall.z2) / 2 - .2} fontSize=".19" textAnchor="middle">{numberLabel(Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1))} m</text>
        </g>)}
        {current.openings.map(opening => {
          const wall = current.walls.find(item => item.id === opening.wallId)
          return wall && <g key={opening.id} data-element-id={opening.id}><OpeningShape opening={opening} wall={wall} selected={selectedId === opening.id} /></g>
        })}
        {current.items.filter(item => item.kind !== 'room').map(item => <g key={item.id} data-element-id={item.id}><ItemShape item={item} selected={selectedId === item.id} /></g>)}
        {wallStart && <g className="ih-plan-preview" pointerEvents="none"><circle cx={wallStart.x} cy={wallStart.z} r=".09" />{pointer && <path d={`M${wallStart.x} ${wallStart.z}L${pointer.x} ${pointer.z}`} />}</g>}
      </svg>
      <div className="ih-plan-view-tools"><button type="button" aria-label="放大平面图" onClick={() => zoom(.8)}>＋</button><button type="button" aria-label="缩小平面图" onClick={() => zoom(1.25)}>−</button><button type="button" onClick={() => setView(planBounds(floor))}>适应画布</button></div>
    </div>
    <p className="ih-plan-hint">{instructions}</p>
    {error && <p className="ih-plan-error" role="alert">{error}</p>}
    {!!elements.length && <label className="ih-plan-object-picker">选择对象<select value={selectedId ?? ''} onChange={event => onSelect(event.currentTarget.value || null)}>
      <option value="">未选择</option>{elements.map(item => <option key={item.id} value={item.id}>{item.name} · {'x1' in item ? '墙体' : drawingLabels[item.kind]}</option>)}
    </select></label>}
    {selectedId && <PropertyEditor key={selectedId} floor={floor} model={model} selectedId={selectedId} readonly={readonly}
      onChange={patch => commit(updateDesignElement(model, floorId, selectedId, patch))}
      onRemove={() => { commit(removeDesignElement(model, floorId, selectedId)); onSelect(null) }} />}
  </section>
}
