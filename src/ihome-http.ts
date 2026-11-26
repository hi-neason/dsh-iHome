type HostFetch = (input: string | URL, init: RequestInit) => Promise<Response>

/** Send plugin requests over the authenticated DSH desktop bridge or web session. */
export async function requestIHome(path: string, init: RequestInit = {}): Promise<Response> {
  const globals = globalThis as typeof globalThis & { __DSH_TRANSPORT__?: { fetch?: HostFetch } }
  const options: RequestInit = { credentials: 'same-origin', ...init }
  const url = 'api/ihome/' + path
  const response = globals.__DSH_TRANSPORT__?.fetch
    ? await globals.__DSH_TRANSPORT__.fetch(url, options)
    : await globalThis.fetch(url, options)
  if (response.ok) return response
  let message = response.status === 413 && path.startsWith('file?')
    ? '附件超过当前 DSH 宿主的请求大小上限，请拆分文件后上传。'
    : `iHome 暂时无法连接（${response.status}）。`
  try {
    const body = await response.json()
    if (typeof body?.error === 'string') message = body.error
  } catch { /* A bridge error can have a plain-text response. */ }
  throw Object.assign(new Error(message), { status: response.status })
}
