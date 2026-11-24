# iHome

iHome 是面向智能装修与家居的 DeepSeek Harness 插件。首页提供家庭档案、装修知识、设计、选材采购、选商报价与合同、预算、施工现场、验收交付与保修八个入口。界面跟随系统明暗外观，首页分六步展示同一间房从毛坯到布置完成的过程，每步 1 秒，每轮 6 秒，支持暂停。开启系统的减少动态效果后，首页显示装修完成的静态画面。开发基准为桌面端 `0.2.2-rc.5`。

## 从源码构建

在仓库根目录使用 Node.js 22 和 npm 构建插件。

```sh
npm ci
npm run build
```

构建会先检查 TypeScript 类型，再将宿主和客户端入口输出到 `dist/`。React 由桌面端提供。

## 在桌面端加载

1. 构建完成后，在仓库根目录运行 `pwd`，复制仓库的绝对路径。安装目录应包含 `package.json`。
2. 在 DeepSeek Harness 打开 **插件 → 添加插件 → 安装第三方插件**，将路径粘贴到「包名或地址」，确认安装。
3. 在「已安装」中打开 **iHome**，确认组件显示「运行中」。点击侧栏的 **iHome** 可打开装修工作台。选择模块即可查看清单、阅读指南或描述房间。在已选工作区内使用模块的对话入口，可编辑草稿后发送。

## 开发入口

| 文件 | 用途 |
| --- | --- |
| `package.json` | 声明包名 `dsh-ihome`、兼容版本范围和组合包入口 |
| `cordis.patch.yml` | 将组件 `ihome` 加入宿主配置 |
| `src/index.ts` | 宿主插件的 Cordis 生命周期入口 |
| `src/client.tsx` | 侧栏入口、面板注册及对话草稿对接 |
| `src/Home.tsx`、`src/HouseExhibit.tsx` | 首页导航、住宅主视觉与动效 |
| `src/modules.ts`、`src/ModuleDetail.tsx` | 模块目录、准备清单和对话入口 |
| `src/RoomPreview.tsx`、`src/Knowledge.tsx` | 设计工作室示例和装修知识指南 |
| `scripts/build.mjs` | 将 TSX 打包为桌面端模块加载器使用的客户端格式 |
| `locale/en.json`、`locale/zh.json` | 设置插件管理页的英文和中文名称与简介 |
