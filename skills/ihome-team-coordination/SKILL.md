---
name: ihome-team-coordination
description: 在同一主对话中调度需求分析师、户型设计师、选商核价分析师、任务待办助理、财务经费专员与风水大师，汇总结果并确认本地数据修改。
---

# 专家协作与确认

1. 识别用户点名的专家及问题范围。需求、家人、空间或生活冲突交给需求分析师；布局、读图、平面或3D建模交给户型设计师；选择装修团队、报价复算和签约核查交给选商核价分析师；任务、排期、日历或完成情况交给任务待办助理；各阶段付款、退款、记账及预算分析交给财务经费专员；传统国学、住宅风水和陈设习惯交给风水大师。
2. 调用 ihome_consult_expert。expert 填 ihome-needs-analyst、ihome-floorplan-designer、ihome-quotes-analyst、ihome-task-assistant、ihome-finance-specialist 或 ihome-fengshui-master，task 写清要解决的问题，context 提供相关用户原话、已明确事实、当前日期和时区。子专家拥有独立上下文，不能假设它看到完整主对话。
3. 跨领域问题按依赖关系调度。例如先让需求分析师澄清老人夜间照明需求，再让任务待办助理整理需要业主落实的事项。仅传递完成当前委派所需的上下文。
4. 检查返回状态。完成时标明是哪位专家的建议，保留不确定性和待澄清问题。错误、取消或空结果如实说明，不能将未完成的委派描述为专家结论。
5. 在主对话中询问待澄清问题。用户要求修改数据时，重新读取对应数据，使用最新版本。需求使用 ihome_propose_need，事实或尺寸使用 ihome_propose_record，任务使用 ihome_propose_task。账务先读 ihome_read_expenses，以最新 revision 作为 expectedRevision，用 ihome_propose_expense 确认付款、退款、更新或删除。每笔新交易使用稳定唯一 expenseId，重试沿用；amountCents 为正整数分，kind 区分 payment/refund。选商先读 ihome_read_quotes，按专家查证的原件、版本和业主选择，用 ihome_propose_quote 展示本次拟保存记录，接受后生效。复报价保留为新版本。设计先用 ihome_read_design 读取方案和 revision，再用 ihome_propose_design 创建方案或局部修改。已有方案采用 edit 操作，保留无关对象和参考资料；新建独立命名副本使用 copy。家人、空间与装修决定的独立编辑仍使用工作台。
6. 每次确认展示具体变更。用户接受且工具返回 applied 才说明保存成功；拒绝或取消后保持原数据，冲突时重新读取并核对。多个变更分别确认，不把专家给出的建议视为用户接受。
7. 需求和任务分别管理。将需求衍生为待办时说明具体行动及日期依据，未知日期保持未排期。主 Agent 负责结果整合与落盘，不让内部专家发起用户确认或递归委派。

采纳设计做法时，先读所选命名方案与家庭档案 revision，用 ihome_propose_design_decision 在主会话确认后记录正式决定。提供 designId、needIds 和相关 objectIds，理由包含取舍及尚需核验的条件；工具自动记录采纳时的几何摘要、时间与指纹。替代旧决定用 supersedesId 保留历史。业主要求安排补量或现场核验时，再委派任务待办助理。附位置、对象编号、测量目的、设计影响；经主会话 ihome_propose_task 确认后才是已创建任务。

只要求画模型时，将布局文字或本轮附图交给户型设计师，按可辨认的结构直接提交修改。房间可以没有名称、用途和档案关联。保留尚不明确的部分及估算说明，跳过指认房间、传图校准和待办建议。子专家须返回实际 Three.js 楼层 source 与 create/edit 参数，主会话用 ihome_propose_design 确认后保存。第二轮修改读取当前源码并替换目标楼层，undo 撤销上一次模型编辑。不能以文字建议代替用户要求的建模产物。

已有打开的命名方案（即使楼层空白）时，首轮按图生成也使用 edit 修改当前楼层；只有用户明确要另建方案或没有方案时使用 create。提交时可用 description 简明描述实际变化和估算依据，不贴源码；工具会另外列出真实受影响楼层与动作供业主确认。
