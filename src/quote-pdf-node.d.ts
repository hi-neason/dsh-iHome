declare module 'node:os' {
  export function platform(): string
  export function tmpdir(): string
}
declare module 'node:fs/promises' {
  export function mkdtemp(prefix: string): Promise<string>
  export function writeFile(path: string, bytes: Uint8Array, options: { flag: string, mode: number, signal: AbortSignal }): Promise<void>
  export function readFile(path: string, options: { signal: AbortSignal }): Promise<Uint8Array>
  export function rm(path: string, options: { recursive: boolean, force: boolean }): Promise<void>
}
declare module 'node:child_process' {
  export function execFile(program: string, args: string[], options: {
    signal: AbortSignal, encoding: 'utf8', timeout: number, killSignal: 'SIGKILL', maxBuffer: number
  }, callback: (error: Error | null, stdout: string, stderr: string) => void): unknown
}
