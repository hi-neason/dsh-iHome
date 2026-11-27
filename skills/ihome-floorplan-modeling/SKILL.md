---
name: ihome-floorplan-modeling
description: 从对话文字或普通户型附图生成、修改并保存可编辑的 Three.js 楼层源码。
---

# 对话源码建模

先 ihome_read_design 读取当前命名方案及各楼层 source。按需 ihome_read_archive 查看家人需求。直接使用本轮附图和文字，不要求 GLB、事先上传底图或校准。已校准底图可由 ihome_read_design_reference 读取。图纸无尺度时说明采用的估算（例如门宽假设），提供能调整的草模；不把推测当实测，不据图纸颜色判定承重。

每个楼层 source 是自包含字符串，格式为 `export function buildFloor(THREE) { ... return group; }`。必须输出实际源码，而非“已生成”或待执行说明。局部 x/z 为平面，y 为高度，单位米；楼层 elevation 在渲染时统一应用，源码不要再次叠加标高。

支持的语法与 API：
- const/let 变量；new THREE.Group、Mesh、BoxGeometry、PlaneGeometry、SphereGeometry、CylinderGeometry、ConeGeometry、TorusGeometry。
- MeshStandardMaterial、MeshBasicMaterial、MeshLambertMaterial、MeshPhongMaterial；可在 Mesh 参数中内联 new。
- group.add(...objects)；position/rotation/scale.set(...)、scale.setScalar(...)；position/rotation/scale.x/y/z 赋值；name、castShadow、receiveShadow 赋值。
- 数值 + - * /、Math.PI、十六进制颜色。材质对象字段 color、roughness、metalness、opacity、transparent、wireframe、side（THREE.DoubleSide 等）。
- 无循环、导入、任意函数、eval 或网络资源。把重复物件写为显式声明和 add；每个物件用 name 标注用途。

例如一面墙：
```javascript
export function buildFloor(THREE) {
  const group = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.8, 0.15), new THREE.MeshStandardMaterial({ color: 0xe6dfd3, roughness: 0.8 }));
  wall.name = "客厅北墙";
  wall.position.set(0, 1.4, -2);
  group.add(wall);
  return group;
}
```

门窗开口用门洞两侧和上方多个墙块构成，避免实墙遮住洞口；多层通过各自 elevation/height 和源码台阶表达空间关系。缺少楼梯净高和洞口尺寸时注明待核验。用不同命名物件表达家具、窗框等可调整细节。

创建方案返回 model.floors，每层 id/name/elevation/height/source，walls/openings/items 为 []。编辑已有方案时先读源码，再用 operations:[{entity:"floor", action:"upsert", id:楼层ID, value:{source:完整修改后源码}}]。此操作替代该层旧结构化墙、门窗与 items，保留 reference/assets 及无关楼层；只改标高时 value 仅给 elevation。不要全量重画其他楼层。撤销上次模型修改用 undo；探索另一布局用 copy，重命名用 rename。

子专家返回实际 source/operations、designId、读取 revision、来源与估算依据。主 Agent 用 ihome_propose_design 在当前对话确认后直接写入，读取 applied 才能宣称保存。补量事项说明位置、单位及设计影响，交任务待办助理。采纳做法用 ihome_propose_design_decision，关联方案并自动保存采纳时的来源。

已有打开的命名方案（即使楼层空白）时，首轮按图生成也使用 edit 修改当前楼层；只有用户明确要另建方案或没有方案时使用 create。提交时可用 description 简明描述实际变化和估算依据，不贴源码；工具会另外列出真实受影响楼层与动作供业主确认。

已有导入 GLB/旧工程素材不是可推测的源码。读取对应 floor.assets 后，用 entity:"asset"、floorId、既有实例 id、action:"upsert"、value 中的 name/x/y/z/scale/rotation 调整，或 action:"remove" 移除实例。存储 assetId 保持原样，不创建新实例、不伪造几何源码代替原素材。源码楼层也可调整其保留素材。
