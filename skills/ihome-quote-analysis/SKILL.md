---
name: ihome-quote-analysis
description: 按业主提供的商家资料、报价和合同核查证据、核对金额与范围，整理澄清问题及选商依据。
---

# 选商、比价与签约核查

按业主的问题选择下列步骤。先用 ihome_read_quotes 读取当前资料和 revision。比单张报价时按 quoteId 读取，梳理一家团队时按 vendorId 读取。需要档案索引时用 ihome_read_archive 查选商阶段资料。

1. **筛选候选商家。** 记录业主要求的地区、承包方式、工期及范围。逐家区分商家自述、证照原件、业主反馈和待核查事项。资质、诉讼、口碑等结论须能指向具体主体、资料与日期；同名线索先核实身份。
2. **提取报价。** 给每行明细保留商家、版本、日期、工程项目、单位、数量、单价、金额、材料工艺及页码、行号或原话。附件模糊或当前只读到目录时标出缺口，请业主提供对应页或粘贴原文。新增报价保留既有版本。
3. **复核和比较。** 对有完整数量及单价的项目复算金额，核对小计、税费、管理费、折扣和清运范围。比较前对齐房间、规格、工艺、单位和计量边界。暂估、按实结算、业主自购、明确排除、未报价分别列明，空值保持未知。给不可比项列出缺什么资料、要问哪家。
4. **核验价格参照。** 保留每份询价或样本的城市、日期、数量、规格、工艺、税费、安装与运费条件和出处。仅在条件相当时计算差额并说明依据。孤立报价或促销截图不足以推定本地市场价。
5. **签约核查与决策。** 对照报价承诺及合同原文核对付款节点、工期、换料、变更、验收和保修。逐条给出原文位置、影响及需商家书面答复的问题。根据业主的优先级说明取舍，保留其最终决定及未解决事项。

将可验证的结论、引用、复算过程、待确认问题、建议写入的记录及读取版本返回主 Agent。主 Agent 使用 ihome_propose_quote 展示具体改动，经业主确认后保存。

## 向主会话交付可登记的明细

业主要求登记资料时，先读取当前记录，返回 expectedRevision、collection 和单条 record。关联已有记录时使用读取到的编号。补充候选团队资料时返回完整记录，保留原有字段。缺少必填依据时先列出要向业主核实的信息。

- vendors 使用 id、name，可填 city、contact、scope、credentials、visit、source。credentials 保留资质核验到哪一步，visit 记录考察事实。
- quotes 使用 id、vendorId、version、date（YYYY-MM-DD）、source、scope、statedTotal、lines。每行包含 key、label、unit、quantity、unitPrice、amount、spec、status、source。key 对应业主认可的可比项目，label 保留原行名称。status 使用 included、excluded、allowance、owner 或 unknown。原件没列的数量、单价或合价填 null；总额未列时 statedTotal 填 null。复报价用新 id、新版本名称。
- references 使用 id、key、city、date、source、unit、spec、scope、unitPrice。币种、含税、运输和安装等口径写入 scope；缺少可追溯价格时先询价。
- reviews 使用 id、quoteId、topic、question、source、answer、answerSource、status。source 记录待核对条款及出处。没有书面答复时 answer 和 answerSource 为空字符串，status 为 open；收到答复后同时填写原文和出处，确认解决后为 answered。
- decisions 使用 id、quoteId、comparedQuoteIds、reason。仅在业主明确选定商家及具体报价版本后交付这项变更。quoteId 须在参与本次比较的 comparedQuoteIds 内，每家最多一版。reason 保留业主取舍依据，报告由宿主在确认保存时生成并冻结。业主只要求推荐或调研时，交付比较和未决问题。
