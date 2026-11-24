declare module 'node:os' { export function homedir(): string }
declare module 'node:path' { export function join(...parts: string[]): string }
declare module 'node:fs/promises' {
  export function mkdir(path: string, options: { recursive: true }): Promise<string | undefined>
}
