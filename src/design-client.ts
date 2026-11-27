import { requestIHome } from './ihome-http.ts'
import { validateDesignState, type DesignCommand, type DesignState } from './design-model.ts'

export async function loadDesigns(signal?: AbortSignal): Promise<DesignState> {
  const response = await requestIHome('designs', { signal })
  return validateDesignState(await response.json())
}
export async function changeDesign(command: DesignCommand, signal?: AbortSignal): Promise<DesignState> {
  const response = await requestIHome('designs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command), signal,
  })
  return validateDesignState(await response.json())
}
