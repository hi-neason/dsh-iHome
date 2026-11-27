import type { DesignState } from './design-model'

/** DSH rc.5's durable image reference. Bytes stay in the local attachment store;
 * the configured multimodal adapter resolves them only for a model request. */
export interface DesignImageRef {
  attachmentId: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  bytes: number
  width: number
  height: number
  name?: string
  originalDimensions?: { width: number, height: number }
}
export interface DesignReferenceAccess {
  readDesign(): DesignState
  readMedia(id: string, signal: AbortSignal): Promise<{ data: Uint8Array, name: string, mime: string }>
  saveImage(input: { data: Uint8Array, mediaType: DesignImageRef['mediaType'], name?: string }): Promise<DesignImageRef>
}
interface ReferenceOutput {
  description: string
  image?: DesignImageRef
}

export function createDesignReferenceTool(access: DesignReferenceAccess) {
  return {
    name: 'ihome_read_design_reference',
    description: '查看旧工程已保存的参考图片及米制范围。仅在 ihome_read_design 显示该层有 reference 且需要这张图片时调用。普通会话附图直接可用，文字建模也可独立进行。',
    parameters: { type: 'object', additionalProperties: false, required: ['floorId'], properties: {
      floorId: { type: 'string' }, designId: { type: 'string' },
    } },
    output: {
      schema: {},
      render(_args: unknown, raw: unknown): ({ type: 'text', text: string } | { type: 'image', attachment: DesignImageRef })[] {
        const value = raw as ReferenceOutput
        const message = { type: 'text' as const, text: value.description }
        return value.image ? [message, { type: 'image', attachment: value.image }] : [message]
      },
    },
    async execute(raw: unknown, execution: { signal: AbortSignal }): Promise<ReferenceOutput> {
      execution.signal.throwIfAborted()
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('底图读取参数必须是对象。')
      const args = raw as Record<string, unknown>
      if (Object.keys(args).some(key => !['designId', 'versionId', 'floorId'].includes(key)) ||
        typeof args.floorId !== 'string' || !args.floorId.trim() ||
        ['designId', 'versionId'].some(key => args[key] !== undefined && (typeof args[key] !== 'string' || !(args[key] as string).trim()))) throw new Error('请提供有效的方案和楼层编号。')
      const state = access.readDesign()
      const design = state.designs.find(value => value.id === (args.designId ?? state.activeId))
      if (!design) throw new Error('方案不存在，请重新读取设计目录。')
      const version = args.versionId === undefined ? undefined : design.versions.find(value => value.id === args.versionId)
      if (args.versionId !== undefined && !version) throw new Error('指定历史版本不存在。')
      const floor = (version?.model ?? design.model).floors.find(value => value.id === args.floorId)
      if (!floor) throw new Error('指定楼层不存在。')
      const reference = floor.reference
      if (!reference) return { description: JSON.stringify({
        designId: design.id, floorId: floor.id, reference: null,
        note: '按当前布局描述、会话附图或已有模型继续建模。',
      }) }
      const media = await access.readMedia(reference.assetId, execution.signal)
      execution.signal.throwIfAborted()
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(media.mime)) throw new Error('底图素材不是支持的图片。')
      const image = await access.saveImage({ data: media.data, mediaType: media.mime as DesignImageRef['mediaType'], name: media.name })
      execution.signal.throwIfAborted()
      return { description: JSON.stringify({
        revision: state.revision, designId: design.id, designName: design.name,
        floorId: floor.id, floorName: floor.name, elevation: floor.elevation, height: floor.height,
        sourceAssetId: reference.assetId, referenceName: reference.name,
        calibration: { unit: 'metre', origin: 'top-left', x: reference.x, z: reference.z, width: reference.width, depth: reference.depth },
        image: { width: image.width, height: image.height, ...(image.originalDimensions ? { originalDimensions: image.originalDimensions } : {}) },
        note: '图中标注和校准范围用于设计参考；不可据此推断承重、实测精度或未标注尺寸。',
      }), image }
    },
  }
}
