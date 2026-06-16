# 世界引擎 World Engine

SillyTavern 第三方扩展 — 独立 API 驱动的世界推演引擎。

对话后自动推演世界状态、注入上下文到 prompt，让 AI 角色扮演中的世界真正"活"起来：NPC 有自己的生活，事件链自行推进，势力兴衰更替，风声四起，经济波动——一切不以玩家为中心。

## 功能概览

**世界推演**
- 每轮对话后自动（或手动）调用外部 OpenAI 兼容 API 推演世界变化
- 支持「每 N 轮推演」和「按故事内时间推演」两种节奏模式
- 推演结果自动注入 prompt，AI 正文写作时能感知世界动态

**活体引擎规则**（内置 12 模块）
- 世界运转、事件链、风声传播、势力体系、声誉系统、经济系统、暗箱操作、区域突发事件等
- 骰子驱动的事件阶段推进（萌芽→发酵→逼近→爆发/消散）
- 势力权柱、凝聚力、运势的自然波动

**世界状态面板**
- 世界摘要 / 天下大势 / 区域突发 / 事件链 / 风声 / 影响链 / 声誉 / 势力 / 宿敌 / 经济 / 暗箱
- 每个模块可折叠，支持内联编辑、新增、删除
- 存档点（推演前快照）与当前状态的 a/b 双态显示

**酒馆缓存与存档**（v2.2.0）
- 跨设备实时同步：将世界状态镜像进 `chat_metadata`，随聊天文件保存到酒馆服务器
- 命名存档 + 滚动自动备份：防丢失，支持恢复/重命名/导出/导入/删除
- Lamport 计数器冲突解决，空内容护栏防止空设备覆盖真实数据
- 默认关闭，不打开则完全不写聊天文件

**后台推演世界书**
- 按聊天选择世界书条目参与推演，让推演结果贴合具体世界观设定
- 蓝绿灯触发（v2.3.0）：🔵 常驻条目恒注入、🟢 关键词条目命中近期对话才注入，跟随酒馆世界书配置，每条可单独覆写（默认关闭）

**数据导入/导出**
- JSON 格式导出完整世界状态，可跨聊天导入
- 导入时自动归一化楼层数，避免判定错乱

## 安装

### 方式一：通过 SillyTavern 扩展管理器

1. 打开 SillyTavern，进入 **扩展** 页面
2. 点击 **安装扩展**
3. 输入仓库地址：`https://github.com/DlSNlGHT/World`
4. 安装完成后刷新页面

### 方式二：手动安装

```bash
cd <SillyTavern安装目录>/data/default-user/extensions
git clone https://github.com/DlSNlGHT/World world-engine
```

刷新 SillyTavern 页面即可。

## 配置

安装后在 SillyTavern 侧边栏找到 **世界引擎** 扩展面板，进入 **设置** 页：

1. **API 配置**（必填）
   - API URL：任意 OpenAI 兼容端点（如 `https://api.openai.com/v1`）
   - API Key：对应的密钥
   - 模型名称：如 `gpt-4o`、`claude-3-5-sonnet` 等

2. **推演模式**
   - 自动：每 N 轮对话后自动推演（默认每轮）
   - 按时间：根据故事内经过的时间决定推演轮数
   - 手动：仅点击「手动推演」按钮时触发

3. **酒馆缓存与存档**（可选）
   - 跨设备实时同步：开启后世界状态随聊天跨设备同步
   - 自动滚动备份：每当轮次推进自动存一条，保留最近 3 条

## 使用

1. 配置好 API 后，正常与角色对话
2. AI 回复后，世界引擎自动推演并更新面板
3. 点击面板标题栏展开/折叠各模块查看世界全貌
4. 推演结果自动注入 prompt，AI 下一轮回复会感知世界变化

**面板分页**：世界摘要 / 天下大势 / 事件链 / 风声 / 势力 / 声誉 / 经济 / 暗箱 / 存档点 / 设置

**存档与恢复**：
- 设置页「酒馆缓存与存档」区可新建命名存档、导入外部存档
- 每条存档支持恢复（回到该时刻状态）、重命名、导出 JSON、删除
- 恢复前自动生成一条备份，可随时恢复回来

## 项目结构

```
world-engine.js           主入口：模块加载、事件绑定、注入逻辑
world-engine-core.js      核心数据结构与存储（按聊天 ID 隔离）
world-engine-store.js     存储中间层（IndexedDB + localStorage 回退）
world-engine-api.js       独立 API 调用（OpenAI 兼容格式）
world-engine-evolution.js 世界推演（活体引擎规则 + 骰子系统）
world-engine-inject.js    构建注入上下文（条件筛选关键信息）
world-engine-rules-loader.js  内置全部推演规则（12 模块）
world-engine-ledger.js    重大事件账本（记录 Lv3/4 变化）
world-engine-worldbook.js 后台推演世界书选择
world-engine-chatcache.js 酒馆缓存与存档（跨设备同步）
world-engine-ui.js        完整 UI 面板
style.css                 样式
manifest.json             SillyTavern 扩展清单
worldmap.svg              世界地图素材
```

## 技术要点

- **纯前端扩展**：10 个 JS 模块，IIFE 挂载到 `window.*` 全局变量，无构建系统
- **本地骰子 + 外部 API 双驱动**：事件阶段推进用本地 RNG，叙事生成用外部 LLM
- **按聊天隔离**：每个聊天独立存档，互不干扰
- **a/b 双态**：推演前存档点（checkpoint）+ 推演后当前状态，支持重 roll 时注入正确版本
- **安全边界**：API Key 等敏感设置绝不写入 `chat_metadata`，防止聊天文件分享导致泄露

## 许可证

[MIT](https://opensource.org/licenses/MIT)

## 作者

[Disnight](https://github.com/DlSNlGHT)
