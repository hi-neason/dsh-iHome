import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { validateTaskBoard, prepareTaskChange, queryTasks } from '../src/task-model.ts'
import { iHomeWorkspacePath } from '../src/ihome-workspace-path.ts'

const bundle = await build({entryPoints:['src/task-host.ts'],bundle:true,platform:'node',format:'esm',write:false})
const { mountTasks } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const context = (cwd = iHomeWorkspacePath(), controller = new AbortController()) => ({signal:controller.signal,agent:{session:{header:{cwd}}}})
const accept = async ({questions:[q]}) => ({answers:[{id:q.id,selected:['接受']}]})
const create = {action:'create',expectedRevision:0,title:'约量房',dueDate:'2026-11-28',notes:'带原始户型图'}

async function fixture(ask = accept, beforeUpdate) {
  let board, route, cleanup, reads = 0, writes = 0, closed = false
  const registered = []
  const table = {get(){reads++;return board},async put(_,value){board=value;writes++},async update(_,transform){await beforeUpdate?.();const next=transform(board);board=next;writes++;return board}}
  await mountTasks({
    storageDomain:{async open(spec){assert.equal(spec.name,'ihome_tasks');return {table:()=>table,async close(){closed=true}}}},
    effect:async setup=>{cleanup=await setup()},userQuestions:{ask},
    connection:{fetch:{register(value){route=value;return ()=>{route=undefined}}}},
    tools:{register(tool,options){const value={tool,options};registered.push(value);return ()=>registered.splice(registered.indexOf(value),1)}},
  })
  return {table,registered,counts:()=>[reads,writes],board:()=>board,closed:()=>closed,cleanup:()=>cleanup(),
    run:(name,args,execution=context())=>registered.find(item=>item.tool.name===name).tool.execute(args,execution),
    http:(body,signal)=>route.fetch(new Request('http://localhost/api/ihome/tasks',body===undefined?{signal}:{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'},signal})),
  }
}

test('task model validates exact dates and identity while retaining unscheduled tasks', () => {
  const task = {id:'one',title:'准备量房',dueDate:'',notes:'',completed:false}
  assert.deepEqual(validateTaskBoard({revision:0,tasks:[task]}),{revision:0,tasks:[task]})
  for (const date of ['2026-02-29','2026-04-31','2026-13-01','0000-01-01','tomorrow',null]) {
    assert.throws(()=>validateTaskBoard({revision:0,tasks:[{...task,dueDate:date}]}),/日期/)
  }
  assert.equal(validateTaskBoard({revision:0,tasks:[{...task,dueDate:'2028-02-29'}]}).tasks[0].dueDate,'2028-02-29')
  assert.throws(()=>validateTaskBoard({revision:0,tasks:[task,task]}),/编号重复/)
  assert.throws(()=>validateTaskBoard({revision:-1,tasks:[]}),/版本/)
  for (const raw of [{title:''},{title:'x'.repeat(241)},{completed:null},{notes:null},{dueDate:null}]) {
    assert.throws(()=>prepareTaskChange({revision:0,tasks:[]},{...create,...raw}))
  }
})

test('task updates preserve other fields and allow completion, reopening, rescheduling and deletion', () => {
  const first=prepareTaskChange({revision:0,tasks:[]},create)
  assert.equal(first.next.tasks[0].completed,false)
  const board={...first.next,revision:1}
  const id=first.taskId
  assert.equal(prepareTaskChange(board,create).changed,false,'retry after commit does not duplicate')
  const completed=prepareTaskChange(board,{action:'update',taskId:id,expectedRevision:1,completed:true})
  assert.deepEqual(completed.next.tasks[0],{...board.tasks[0],completed:true})
  assert.match(completed.summary,/更新前[\s\S]*待完成[\s\S]*更新后[\s\S]*已完成/)
  const reopened=prepareTaskChange({...completed.next,revision:2},{action:'update',taskId:id,expectedRevision:2,completed:false,dueDate:''})
  assert.deepEqual(reopened.next.tasks[0],{...board.tasks[0],dueDate:''})
  const deleted=prepareTaskChange(reopened.next,{action:'delete',taskId:id,expectedRevision:2})
  assert.equal(deleted.next.tasks.length,0)
  assert.equal(prepareTaskChange({...deleted.next,revision:3},{action:'delete',taskId:id,expectedRevision:2}).changed,false)
  assert.throws(()=>prepareTaskChange(board,{action:'update',taskId:id,expectedRevision:0,completed:true}),/已有更新/)
})

test('date and status filters include boundary dates and exclude unscheduled tasks from dated queries', () => {
  const base={title:'任务',notes:'',completed:false}
  const board={revision:8,tasks:[{...base,id:'a',dueDate:'2026-11-28'},{...base,id:'b',dueDate:'2026-11-29',completed:true},{...base,id:'c',dueDate:''}]}
  assert.deepEqual(queryTasks(board,{status:'pending'}).tasks.map(t=>t.id),['a','c'])
  assert.deepEqual(queryTasks(board,{from:'2026-11-28',to:'2026-11-29'}).tasks.map(t=>t.id),['a','b'])
  assert.deepEqual(queryTasks(board,{status:'completed'}).tasks.map(t=>t.id),['b'])
  for(const args of [{from:''},{to:'2026-02-30'},{from:'2026-12-01',to:'2026-11-01'},{status:'bad'}]) assert.throws(()=>queryTasks(board,args))
})

test('task HTTP persists revisions and rejects stale, invalid and aborted writes', async () => {
  const f=await fixture()
  assert.deepEqual(await(await f.http()).json(),{revision:0,tasks:[]})
  const payload=prepareTaskChange(f.board(),create).next
  const results=await Promise.all([f.http(payload),f.http(payload)])
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
  assert.equal(f.board().revision,1)
  const prior=f.board()
  assert.equal((await f.http({...prior,tasks:[{...prior.tasks[0],dueDate:'invalid'}]})).status,400)
  const controller=new AbortController();controller.abort()
  assert.equal((await f.http({...prior,tasks:[]},controller.signal)).status,400)
  assert.equal(f.board(),prior)
  await f.cleanup();assert.equal(f.registered.length,0);assert.equal(f.closed(),true)
})

test('task tools accept in the same conversation and deduplicate confirmed retries', async () => {
  const execution=context(),questions=[]
  const f=await fixture(async request=>{assert.equal(request.agent,execution.agent);assert.equal(request.signal,execution.signal);questions.push(request.questions[0]);return accept(request)})
  assert.equal((await f.run('ihome_propose_task',create,execution)).status,'applied')
  assert.equal(questions.length,1)
  assert.match(questions[0].detail,/约量房[\s\S]*2026-11-28[\s\S]*待完成[\s\S]*带原始户型图/)
  assert.equal((await f.run('ihome_propose_task',create,execution)).status,'unchanged')
  assert.equal(questions.length,1)
  const read=await f.run('ihome_read_tasks',{})
  assert.equal(read.revision,1)
  assert.equal((await f.run('ihome_propose_task',{action:'update',taskId:read.tasks[0].id,expectedRevision:1,completed:true},execution)).status,'applied')
  assert.equal((await f.run('ihome_read_tasks',{status:'completed'})).tasks.length,1)
})

test('task tools enforce workspace boundary before reads or writes', async () => {
  const f=await fixture(),counts=f.counts()
  for(const {tool,options} of f.registered) {
    for(const execution of [context('/tmp'),context(iHomeWorkspacePath()+'/child'),{signal:new AbortController().signal}]) {
      assert.equal(options.when(execution),false)
      await assert.rejects(tool.execute(create,execution),/仅在 iHome工作区/)
    }
  }
  assert.deepEqual(f.counts(),counts)
})

test('decline and custom feedback never save; unavailable questions leave task storage intact', async () => {
  for(const reply of [q=>({answers:[]}),q=>({answers:[{id:q.id,selected:['不接受']}]}),q=>({answers:[{id:q.id,selected:['接受'],custom:'改到下周'}]}),q=>({answers:[{id:'wrong',selected:['接受']}]}),q=>({answers:[{id:q.id,selected:['接受','不接受']}]})]) {
    const f=await fixture(async({questions:[q]})=>reply(q))
    assert.equal((await f.run('ihome_propose_task',create)).status,'not_applied')
    assert.equal(f.board().tasks.length,0)
  }
  const f=await fixture(async()=>{throw new Error('NO_PROVIDER')})
  await assert.rejects(f.run('ihome_propose_task',create),/NO_PROVIDER/)
  assert.equal(f.board().revision,0)
})

test('stale task proposal and edits made while waiting cannot overwrite current data', async () => {
  const asked=Promise.withResolvers(),answer=Promise.withResolvers()
  const f=await fixture(async({questions:[q]})=>{asked.resolve(q);return answer.promise})
  const pending=f.run('ihome_propose_task',create)
  const q=await asked.promise
  assert.equal(f.board().tasks.length,0)
  await f.table.update('home',current=>({...current,revision:1}))
  answer.resolve({answers:[{id:q.id,selected:['接受']}]})
  assert.equal((await pending).status,'conflict')
  assert.deepEqual(f.board(),{revision:1,tasks:[]})
  assert.equal((await f.run('ihome_propose_task',create)).status,'conflict')
})

test('cancellation and storage failure cannot apply accepted task changes', async () => {
  for(const phase of ['ask','write','storage']) {
    const controller=new AbortController()
    const f=await fixture(async request=>{if(phase==='ask')controller.abort();return accept(request)},()=>{if(phase==='write')controller.abort();if(phase==='storage')throw new Error('disk unavailable')})
    await assert.rejects(f.run('ihome_propose_task',create,context(iHomeWorkspacePath(),controller)),phase==='storage'?/disk unavailable/:{name:'AbortError'})
    assert.deepEqual(f.board(),{revision:0,tasks:[]})
  }
})
