import type * as Three from 'three'
type Kind = 'group' | 'mesh' | 'geometry' | 'material'
type Value = number | string | boolean | {
  ref: string
} | {
  ctor: string
  args: Value[]
} | {
  fields: Record<string, Value>
}
type Operation = {
  kind: 'declare'
  name: string
  value: Value
} | {
  kind: 'call'
  name: string
  path: string[]
  args: Value[]
} | {
  kind: 'assign'
  name: string
  path: string[]
  value: Value
}
const geometries = new Set(['BoxGeometry', 'PlaneGeometry', 'SphereGeometry', 'CylinderGeometry', 'ConeGeometry', 'TorusGeometry'])
const materials = new Set(['MeshStandardMaterial', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial'])
const materialFields = new Set(['color', 'emissive', 'roughness', 'metalness', 'opacity', 'transparent', 'wireframe', 'side', 'shininess', 'flatShading'])
const constants: Record<string, number> = { 'Math.PI': Math.PI, 'THREE.DoubleSide': 2, 'THREE.FrontSide': 0, 'THREE.BackSide': 1 }
const reservedWords = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function',
  'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'let', 'static', 'implements', 'interface', 'package', 'private', 'protected',
  'public', 'await', 'eval', 'arguments',
])
const fail = (message: string): never => {
  throw new Error(`楼层 Three.js 源码：${message}`)
}
/** A small parser/interpreter, never JS evaluation. It admits only constructors,
* local declarations, scene attachment, numeric arithmetic and named transforms. */
function parse(source: string) {
  if (typeof source !== 'string' || !source.trim() || source.length > 64000) {
    fail('源码须为 1–64000 字符。')
  }
  const tokens: string[] = []
  const starts: number[] = [], ends: number[] = []
  const pattern = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|[A-Za-z_$][\w$]*|\+\+|--|[{}()[\].,;:=+*/-]/gy
  let offset = 0
  while (offset < source.length) {
    pattern.lastIndex = offset
    const match = pattern.exec(source)
    if (!match) {
      fail(`位置 ${offset} 含不支持的字符。`)
    }
    const token = match![0]
    offset = pattern.lastIndex
    if (!/^\s|^\/\//.test(token) && !token.startsWith('/*')) {
      tokens.push(token)
      starts.push(offset - token.length)
      ends.push(offset)
    }
    if (tokens.length > 16000) {
      fail('源码过于复杂。')
    }
  }
  let pos = 0, count = 0, vertices = 0, depth = 0
  const peek = () => tokens[pos]
  const take = () => tokens[pos++] ?? fail('源码意外结束。')
  const expect = (token: string) => {
    if (take() !== token) {
      fail(`预期 ${token}。`)
    }
  }
  const identifier = () => {
    const token = take()
    if (!/^[A-Za-z_$][\w$]*$/.test(token) || reservedWords.has(token) || ['__proto__', 'prototype', 'constructor', 'THREE', 'Math'].includes(token)) {
      fail('变量名称无效。')
    }
    return token
  }
  const symbols = new Map<string, Kind | 'number'>(), values = new Map<string, number>()
  const operations: Operation[] = [], parents = new Map<string, string>()
  function finite(value: number): number {
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) {
      fail('数值超出范围。')
    }
    return value
  }
  function numericAtom(): number {
    if (++depth > 64) {
      fail('表达式嵌套超过64层。')
    }
    try {
      return numericAtomInner()
    } finally {
      depth--
    }
  }
  function numericAtomInner(): number {
    if (peek() === '+' || peek() === '-') {
      return (take() === '-' ? -1 : 1) * numericAtom()
    }
    if (peek() === '(') {
      take()
      const value = numeric()
      expect(')')
      return value
    }
    const token = take()
    if (/^(?:\d|\.\d)/.test(token)) {
      if (/^0[0-9]/.test(token)) fail('不支持旧式八进制或前导零数字。')
      return finite(Number(token))
    }
    if (token === 'Math' || token === 'THREE') {
      expect('.')
      const key = token + '.' + take()
      if (!(key in constants)) {
        fail('仅支持明确列出的数值常量。')
      }
      return constants[key]
    }
    if (values.has(token)) {
      return values.get(token)!
    }
    return fail('需要数值常量或已声明的数值变量。')
  }
  function numericProduct(): number {
    let value = numericAtom()
    while (peek() === '*' || peek() === '/') {
      const op = take(), next = numericAtom()
      value = finite(op === '*' ? value * next : value / next)
    }
    return value
  }
  function numeric(): number {
    let value = numericProduct()
    while (peek() === '+' || peek() === '-') {
      const op = take(), next = numericProduct()
      value = finite(op === '+' ? value + next : value - next)
    }
    return value
  }
  function args(): Value[] {
    expect('(')
    const result: Value[] = []
    if (peek() !== ')') {
      do {
        result.push(expression())
        if (peek() !== ',') {
          break
        }
        take()
      } while (peek() !== ')')
    }
    expect(')')
    return result
  }
  function expression(): Value {
    if (++depth > 64) {
      fail('表达式嵌套超过64层。')
    }
    try {
      return expressionInner()
    } finally {
      depth--
    }
  }
  function expressionInner(): Value {
    if (peek() === 'new') {
      take()
      expect('THREE')
      expect('.')
      const ctor = take()
      const result = { ctor, args: args() }
      check(result)
      return result
    }
    if (peek() === '{') {
      take()
      const fields: Record<string, Value> = Object.create(null)
      while (peek() !== '}') {
        const key = identifier()
        if (!materialFields.has(key) || Object.hasOwn(fields, key)) {
          fail('材质字段无效或重复。')
        }
        expect(':')
        fields[key] = expression()
        if (peek() !== ',') {
          break
        }
        take()
      }
      expect('}')
      return { fields }
    }
    if (peek() === 'true' || peek() === 'false') {
      return take() === 'true'
    }
    if (/^["']/.test(peek() ?? '')) {
      const token = take()
      if (token.startsWith('"')) {
        try {
          return JSON.parse(token) as string
        }
        catch {
          return fail('字符串无效。')
        }
      }
      if (/[\r\n]/.test(token)) {
        fail('字符串不能包含未转义的换行。')
      }
      if (token.includes('\\')) {
        fail('单引号字符串不支持转义，请使用 JSON 双引号字符串。')
      }
      return token.slice(1, -1)
    }
    if (symbols.has(peek()) && symbols.get(peek()) !== 'number') {
      return { ref: take() }
    }
    return numeric()
  }
  function kind(value: Value): Kind | 'number' | undefined {
    if (typeof value === 'number') {
      return 'number'
    }
    if (!value || typeof value !== 'object') {
      return undefined
    }
    if ('ref' in value) {
      return symbols.get(value.ref)
    }
    if ('ctor' in value) {
      return value.ctor === 'Group' ? 'group' : value.ctor === 'Mesh' ? 'mesh' : geometries.has(value.ctor) ? 'geometry' : materials.has(value.ctor) ? 'material' : undefined
    }
    return undefined
  }
  function check(value: {
    ctor: string
    args: Value[]
  }) {
    if (++count > 400) {
      fail('构造对象超过 400 个。')
    }
    const { ctor, args: a } = value
    if (ctor === 'Group') {
      if (a.length) {
        fail('Group 无参数。')
      }
      return
    }
    if (ctor === 'Mesh') {
      if (a.length !== 2 || kind(a[0]) !== 'geometry' || kind(a[1]) !== 'material') {
        fail('Mesh 需要几何和材质。')
      }
      return
    }
    if (materials.has(ctor)) {
      if (a.length > 1 || (a.length && (typeof a[0] !== 'object' || !('fields' in a[0])))) {
        fail('材质仅接受参数对象。')
      }
      const fields = a.length ? (a[0] as {
        fields: Record<string, Value>
      }).fields : {}
      for (const [key, val] of Object.entries(fields)) {
        if (['transparent', 'wireframe', 'flatShading'].includes(key)) {
          if (typeof val !== 'boolean') {
            fail('材质布尔字段无效。')
          }
        } else if (['color', 'emissive'].includes(key)) {
          if (!(typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 0xffffff) && !(typeof val === 'string' && /^#[\da-fA-F]{6}$/.test(val))) {
            fail('颜色请用十六进制数或 #RRGGBB。')
          }
        } else if (key === 'side' && (typeof val !== 'number' || ![0, 1, 2].includes(val))) {
          fail('材质side仅支持FrontSide、BackSide或DoubleSide。')
        } else if (typeof val !== 'number' || val < 0 || val > (key === 'side' ? 2 : key === 'shininess' ? 1000 : 1)) {
          fail('材质数值无效。')
        }
      }
      return
    }
    if (!geometries.has(ctor)) {
      fail(`不支持构造器 ${ctor}。`)
    }
    const maxArgs: Record<string, number> = { BoxGeometry: 6, PlaneGeometry: 4, SphereGeometry: 3, CylinderGeometry: 5, ConeGeometry: 4, TorusGeometry: 4 }
    if (a.length > maxArgs[ctor] || a.some(v => typeof v !== 'number')) {
      fail('几何参数无效。')
    }
    const dimensionCounts: Record<string, number> = {
      BoxGeometry: 3, CylinderGeometry: 3, PlaneGeometry: 2,
      ConeGeometry: 2, TorusGeometry: 2, SphereGeometry: 1,
    }
    const dimensions = dimensionCounts[ctor]
    for (let i = 0; i < a.length; i++) {
      const n = a[i] as number
      if (i < dimensions) {
        if (n < 0 || n > 1000 || (n === 0 && !(ctor === 'CylinderGeometry' && i < 2))) {
          fail('几何尺寸须大于0且不超过1000米。')
        }
      } else if (!Number.isInteger(n) || n < 1 || n > 64) {
        fail('几何分段须为1–64的整数。')
      }
    }
    const segments = a.slice(dimensions) as number[]
    if (ctor === 'BoxGeometry') {
      const [x, y, z] = [segments[0] ?? 1, segments[1] ?? 1, segments[2] ?? 1]
      vertices += 2 * ((x + 1) * (y + 1) + (x + 1) * (z + 1) + (y + 1) * (z + 1))
    } else if (ctor === 'PlaneGeometry') {
      vertices += (1 + (segments[0] ?? 1)) * (1 + (segments[1] ?? 1))
    } else {
      vertices += (1 + (segments[0] ?? 32)) * (1 + (segments[1] ?? 16)) * 3
    }
    if (vertices > 100000) {
      fail('几何复杂度超过100000顶点预算。')
    }
  }
  expect('export')
  expect('function')
  expect('buildFloor')
  expect('(')
  expect('THREE')
  expect(')')
  expect('{')
  while (peek() !== 'return') {
    if (!peek() || peek() === '}') {
      fail('需要 return 一个 Group。')
    }
    if (operations.length >= 1000) {
      fail('语句超过1000条。')
    }
    if (peek() === 'const' || peek() === 'let') {
      take()
      const name = identifier()
      if (symbols.has(name)) {
        fail('变量不能重复声明。')
      }
      expect('=')
      const value = expression()
      if (typeof value === 'object' && 'ref' in value) {
        fail('Three对象不能声明别名。')
      }
      const type = kind(value)
      if (!type) {
        fail('仅支持Three对象或数值声明。')
      }
      symbols.set(name, type!)
      if (typeof value === 'number') {
        values.set(name, value)
      }
      operations.push({ kind: 'declare', name, value })
    }
    else {
      const name = identifier(), type = symbols.get(name)
      if (type !== 'group' && type !== 'mesh') {
        fail('只可操作已声明的Group或Mesh。')
      }
      expect('.')
      const path = [identifier()]
      if (peek() === '.') {
        take()
        path.push(identifier())
      }
      if (peek() === '(') {
        const a = args(), method = path.join('.')
        if (method === 'add') {
          if (!a.length) {
            fail('add需要子对象。')
          }
          for (const child of a) {
            if (typeof child !== 'object' || !('ref' in child) || !['group', 'mesh'].includes(kind(child) ?? '')) {
              fail('add仅接受已声明的Group/Mesh。')
            }
            const childName = (child as {
              ref: string
            }).ref
            let ancestor: string | undefined = name
            while (ancestor) {
              if (ancestor === childName) {
                fail('分组不能形成循环。')
              }
              ancestor = parents.get(ancestor)
            }
            parents.set(childName, name)
          }
        } else if (['position.set', 'rotation.set', 'scale.set'].includes(method)) {
          if (a.length !== 3 || a.some(v => typeof v !== 'number' || Math.abs(v) > 10000)) {
            fail('变换需要3个有效数值。')
          }
        } else if (method === 'scale.setScalar') {
          if (a.length !== 1 || typeof a[0] !== 'number' || a[0] <= 0 || a[0] > 10000) {
            fail('缩放比例无效。')
          }
        } else {
          fail('不支持此方法。')
        }
        operations.push({ kind: 'call', name, path, args: a })
      } else {
        expect('=')
        const value = expression()
        if (path.length === 2 && ['position', 'rotation', 'scale'].includes(path[0]) && ['x', 'y', 'z'].includes(path[1])) {
          if (typeof value !== 'number' || Math.abs(value) > 10000) {
            fail('变换数值无效。')
          }
        } else if (path.length === 1 && path[0] === 'name') {
          if (typeof value !== 'string' || value.length > 160) {
            fail('名称无效。')
          }
        } else if (path.length === 1 && ['castShadow', 'receiveShadow'].includes(path[0])) {
          if (typeof value !== 'boolean') {
            fail('阴影属性须为布尔值。')
          }
        } else {
          fail('不支持此属性。')
        }
        operations.push({ kind: 'assign', name, path, value })
      }
    }
    if (peek() === ';') {
      take()
    }
    else if (!/[\r\n]/.test(source.slice(ends[pos - 1], starts[pos]))) {
      fail('语句之间需要分号或换行。')
    }
  }
  take()
  if (/[\r\n]/.test(source.slice(ends[pos - 1], starts[pos]))) {
    fail('return和返回对象必须在同一行。')
  }
  const result = identifier()
  if (symbols.get(result) !== 'group') {
    fail('buildFloor必须返回Group。')
  }
  if (peek() === ';') {
    take()
  }
  expect('}')
  if (peek() === ';') {
    take()
  }
  if (pos !== tokens.length) {
    fail('函数之外不能包含代码。')
  }
  return { operations, result }
}
// At most 16 successful programs (each limited to 64k source characters).
// Cache only immutable parser products, never Three instances or failed inputs.
const programs = new Map<string, ReturnType<typeof parse>>()
function compiled(source: string): ReturnType<typeof parse> {
  const cached = programs.get(source)
  if (cached) {
    programs.delete(source)
    programs.set(source, cached)
    return cached
  }
  const program = parse(source)
  if (programs.size >= 16) {
    programs.delete(programs.keys().next().value!)
  }
  programs.set(source, program)
  return program
}
export function validateFloorSource(source: string): void {
  compiled(source)
}
export function buildFloorSource(source: string, THREE: typeof Three): Three.Group {
  const program = compiled(source), locals = new Map<string, any>(), resources: {
    dispose(): void
  }[] = []
  function value(v: Value): any {
    if (typeof v !== 'object') {
      return v
    }
    if ('ref' in v) {
      return locals.get(v.ref)
    }
    if ('fields' in v) {
      return Object.fromEntries(Object.entries(v.fields).map(([key, item]) => [key, value(item)]))
    }
    const Constructor = THREE[v.ctor as keyof typeof THREE] as new (...args: any[]) => any
    const instance = new Constructor(...v.args.map(value))
    if (typeof instance.dispose === 'function') {
      resources.push(instance)
    }
    return instance
  }
  try {
    for (const op of program.operations) {
      if (op.kind === 'declare') {
        locals.set(op.name, value(op.value))
        continue
      }
      let target = locals.get(op.name)
      for (const key of op.path.slice(0, -1)) {
        target = target[key]
      }
      const key = op.path.at(-1)!
      if (op.kind === 'call') {
        target[key](...op.args.map(value))
      } else {
        target[key] = value(op.value)
      }
    }
    const group = locals.get(program.result) as Three.Group
    // Unattached declarations are legal but must not leak GPU resources.
    const used = new Set<unknown>()
    group.traverse((node: any) => {
      if (node.geometry) {
        used.add(node.geometry)
      }
      if (node.material) {
        used.add(node.material)
      }
    })
    for (const resource of resources) {
      if (!used.has(resource)) {
        resource.dispose()
      }
    }
    return group
  } catch (error) {
    for (const resource of resources) {
      resource.dispose()
    }
    throw error
  }
}
