import { useEffect, useRef, useState, type FormEvent } from 'react'
import { requestIHome } from './ihome-http'
import type { AgentPresetSettingsView } from './agent-presets'
import css from './agent-settings.css'

function PresetEditor({ initial }: { initial: AgentPresetSettingsView }) {
  const [saved, setSaved] = useState(initial)
  const [instructions, setInstructions] = useState(initial.instructions)
  const [enabledSkills, setEnabledSkills] = useState(initial.enabledSkills)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const changed = instructions !== saved.instructions || enabledSkills.length !== saved.enabledSkills.length
    || enabledSkills.some(id => !saved.enabledSkills.includes(id))

  function accept(value: AgentPresetSettingsView) {
    setSaved(value)
    setInstructions(value.instructions)
    setEnabledSkills(value.enabledSkills)
    setConflict(false)
  }

  async function update(reset = false) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await requestIHome('agent-settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: saved.id, revision: saved.revision,
          ...(reset ? { reset: true } : { instructions, enabledSkills }) }),
      })
      accept(await response.json())
      setNotice(reset ? '已恢复默认配置。' : '配置已保存。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '配置保存失败，请重试。')
      setConflict((cause as { status?: number })?.status === 409)
    } finally { pending.current = false; setBusy(false) }
  }

  async function reload() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setNotice('')
    try {
      const response = await requestIHome('agent-settings')
      const { presets }: { presets: AgentPresetSettingsView[] } = await response.json()
      const latest = presets.find(preset => preset.id === saved.id)
      if (!latest) throw new Error('此专家配置暂时不可用，请重新打开设置。')
      accept(latest)
      setError('')
      setNotice('已载入最新配置。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取最新配置，请重试。')
    } finally { pending.current = false; setBusy(false) }
  }

  function submit(event: FormEvent) { event.preventDefault(); if (changed && !conflict) void update() }
  return <form className="ih-agent-editor" onSubmit={submit} aria-label={`${saved.title}配置`}>
    <header><h3>{saved.title}</h3><p>{saved.description}</p></header>
    <details className="ih-agent-base"><summary>查看基础提示词</summary><p>{saved.basePrompt}</p></details>
    <fieldset disabled={busy}>
      <label className="ih-agent-instructions">附加提示词
        <textarea rows={5} value={instructions} maxLength={20000}
          placeholder="例如，每次只问一个问题，优先处理影响近期安排的事项。"
          onChange={event => { setInstructions(event.target.value); setNotice('') }} />
      </label>
      <p className="ih-agent-help">补充沟通方式和关注重点。档案与待办修改会在专家团主对话中由你确认。</p>
      <div className="ih-agent-skills" role="group" aria-label="技能">
        <h4>技能</h4>
        {saved.skills.map(skill => <label key={skill.id}>
          <input type="checkbox" checked={enabledSkills.includes(skill.id)}
            onChange={event => {
              const enabled = event.currentTarget.checked
              setEnabledSkills(current => enabled ? [...current, skill.id] : current.filter(id => id !== skill.id))
              setNotice('')
            }} />
          <span><strong>{skill.title}</strong><small>{skill.description}</small></span>
        </label>)}
      </div>
    </fieldset>
    {error && <div className="ih-agent-feedback" role="alert"><p>{error}</p>
      {conflict && <><p>当前输入已保留。重新载入会用最新配置替换当前输入。</p>
        <button type="button" disabled={busy} onClick={() => void reload()}>放弃当前输入并载入最新配置</button></>}
    </div>}
    {notice && <p role="status" className="ih-agent-feedback">{notice}</p>}
    <footer>
      <button className="ih-agent-save" type="submit" disabled={busy || !changed || conflict}>{busy ? '正在处理…' : '保存配置'}</button>
      <button type="button" disabled={busy || conflict} onClick={() => void update(true)}>恢复默认</button>
      {changed && <small>有未保存的修改</small>}
    </footer>
  </form>
}

export function AgentSettings() {
  const [presets, setPresets] = useState<AgentPresetSettingsView[]>()
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void requestIHome('agent-settings', { signal: controller.signal })
      .then(response => response.json())
      .then((value: { presets: AgentPresetSettingsView[] }) => {
        if (controller.signal.aborted) return
        setPresets(value.presets)
        setSelected(value.presets[0]?.id ?? '')
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取专家配置。') })
    return () => controller.abort()
  }, [attempt])
  return <section className="ih-agent-settings" aria-label="iHome 专家配置">
    <style>{css}</style>
    <h2>专家设置</h2>
    <p className="ih-agent-intro">设置保存在本机。主 Agent 从下一轮对话生效，内部专家从下一次委派生效。</p>
    {error && <div className="ih-agent-feedback" role="alert"><p>{error}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>}
    {!presets && !error && <p role="status">正在读取专家配置…</p>}
    {presets?.length === 0 && <p>暂无可配置的专家。</p>}
    {!!presets?.length && <>
      {presets.length > 1 && <label className="ih-agent-select">专家
        <select value={selected} onChange={event => setSelected(event.target.value)}>
          {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.title}</option>)}
        </select>
      </label>}
      {presets.map(preset => <div key={preset.id} hidden={selected !== preset.id}><PresetEditor initial={preset} /></div>)}
    </>}
  </section>
}
