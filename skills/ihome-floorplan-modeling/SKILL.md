---
name: ihome-floorplan-modeling
description: 结合家庭需求，通过对话生成和修改可编辑的平面与3D户型，支持平层、复式和别墅。
---

# 对话户型设计

先用 ihome_read_design 读取当前方案目录、选中方案及其 revision。要讨论旧版时明确指定 designId 和 versionId。按当前房间或区域用 ihome_read_archive 查询家人的需求、采信的尺寸和原始资料。档案里的房间 ID 可以写入对应 room 对象的 roomId，保留关联。

从用户提供的图纸或描述建立草模。核对图纸楼层、比例、门窗位置和尺寸来源。原图缺少可靠尺度时说明假设，并请用户提供一段关键实测长度；可以按已说明的假设生成待校准草模。图纸颜色和墙体粗细不足以证明承重性质。资料模糊处列出待确认点，不编造精确尺寸。

模型以米为单位，x/z 是平面，elevation 是楼层标高，height 是层高。平面和3D共用同一份模型。每层包含 walls、openings 和 items。

- 墙包含 id、name、x1、z1、x2、z2、thickness。
- 门窗包含 id、name、wallId、kind（door/window）、offset、width、sill、height。offset 沿墙起点到终点量至洞口起边，门 sill 通常为 0。
- 空间或物件包含 id、name、kind（room/furniture/stair/void）、x、z、width、depth、height、rotation。x/z 表示中心，rotation 单位为度。roomId 可关联家庭档案空间。
- stair 用 targetFloorId 连接目标楼层，void 表示该层楼板开口。检查楼梯到达位置及上下层开口对应关系。

给空白方案生成完整 model。已有模型用稳定 ID 表达局部操作，按 entity（floor/wall/opening/item）、action（upsert/remove）、floorId、id 和 value 修改。upsert 的 value 只包含要改变的字段，创建楼层需提供 name/elevation/height，创建其他对象需提供完整几何字段。删除墙前明确处理关联门窗，删除楼层前处理指向它的楼梯。不得意外替换其他楼层、家具、参考底图或外部模型。

例如用户要求桌子转 90 度，先读取桌子原 rotation，再给出它所在 floorId、对象 id 和新 rotation。移动门窗时同步检查洞口是否仍落在墙长与层高范围内。改变墙端点会影响附着门窗的位置，需要说明影响。多处修改合成一批 operations，以同一个读取 revision 提交，避免半完成状态。

用户探索另一种布局时，建议从当前方案或指定版本 copy 出独立方案。需要保留里程碑时用 snapshot 保存命名版本，版本名称描述主要变化。正式采用某种装修做法时，向主 Agent 提交决定及理由，由主对话处理采纳。

作为子专家，把可执行建议、读取 revision、designId、依据和待澄清问题交回主 Agent。主 Agent 使用 ihome_propose_design 展示实际改动，业主接受后保存到本机。查看实际结果后再声称已保存。需要补量或核验时，写清位置、测量目的和会影响哪项设计，交给任务待办助理安排。
