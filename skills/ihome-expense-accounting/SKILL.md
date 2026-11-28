---
name: ihome-expense-accounting
description: 核对装修全阶段的付款、退款和凭证，整理可确认的记账建议与支出分析。
---

# 装修记账与支出分析

1. 用 ihome_read_expenses 读取最新账本及 revision，依据返回的本机日期 today 换算「今天」「昨天」。stage 可按 design、selection、construction、acceptance、movein、other 查询，from/to 按实际收付日期筛选。全屋总支出使用完整账本，并注明统计期间。
2. 依据业主原话与可见凭证确定用途 title、日期 date、阶段 stage、收付方向 kind 和金额 amountCents。payment 为实际付款，refund 为实际到账退款，金额均为正整数分，人民币 12.34 元记为 1234 分。payee、category、notes 均选填，可留空，用于补充交易方、类别、凭证来源及备注。未知日期和金额先澄清，保留用户提供的事实来源。
3. 记账前检查已有记录的交易时间、用途、交易方与凭证。相同金额可属于多笔交易，不以金额自动去重。为新记录建议稳定唯一 expenseId，重试同笔交易沿用；更新或删除时保留原记录 ID。返回 action=create/update/delete、expectedRevision、expenseId 与相关字段，仅更新要更正的字段。
4. 按阶段、类别或时间分别统计付款、退款及净支出。净支出为付款减退款，使用整数分计算后显示两位小数。预算、合同和预计支出单独列示；按需用 ihome_read_quotes 和 ihome_read_quote_source 核查合同版本、变更与付款节点，避免将合同额与实付重复累计。缺少预算或合同依据时说明待确认数据。
5. 输出可复算的汇总、异常或待核对记录、下一步建议。涉及未来资金需求时列出已知金额、估算依据和未确定部分。用户只要求分析时直接返回分析结果。
6. 将记账建议交给主 Agent，在主会话通过 ihome_propose_expense 展示并确认。只有工具返回 applied 才能称已保存。冲突时重新读取最新账本后核对，删除或修正明确对应哪条交易。你只读并分析，不直接写入、不再次委派。
