# PaperPilot Rust 桌面工作台设计

## 目标

为 Windows 11 构建本地优先的 PaperPilot 桌面客户端。应用使用 Tauri 2、Rust、React、TypeScript 和 Vite。项目、PDF、对话、Evidence Record 与报告只在本机持久化，云端只处理当前阶段必需的最小推理请求且不留存客户内容。

## 产品体验

- 启动页展示本地项目和历史运行，不增加营销页。
- 进入项目后使用固定双栏工作台：左侧占 42%，持续显示用户消息、模型回复和研究操作；右侧占 58%，初始为等待态，引用审计完成后原位显示完整报告。
- 新研究从左侧对话输入框启动。PICO、日期、研究类型、关键词与 PDF 位于可展开参数区。
- 右侧在首份完整报告生成前不显示零散草稿。报告修订期间继续显示旧版本及“更新中”标记，只有新版本通过引用审计并原子保存后才替换。
- 报告完成后的消息先识别为 `discuss` 或 `revise_report`。解释性追问只返回有证据依据的回复；新增约束、纠错或方案调整自动生成报告新版本。无效、超时或不确定时默认 `discuss`。
- 点击 Claim 或 Recommendation 的证据入口时，在右侧内部打开 Evidence Drawer，不遮住左侧对话。

默认窗口为 1440×900，最小窗口为 1180×720。首版不增加第三栏，不实现登录、跨设备同步、团队空间、OCR、本地模型、自动更新或应用商店发布。

## 桌面架构

新增 `apps/desktop` npm workspace：

- React/Vite renderer 负责项目首页、双栏工作台、参数区、消息时间线、等待态、报告与证据抽屉。
- Tauri commands 是 renderer 访问本地数据与系统能力的唯一入口。
- Rust 核心负责 SQLite、加密、文件保留、检索连接器、PDFium 解析、九阶段研究流水线、报告版本与导出。
- Rust `serde` 类型是桌面合同的事实来源，并通过 `ts-rs` 生成 TypeScript 类型。

Tauri commands：

- `create_project(input) -> Project`
- `list_projects() -> Project[]`
- `start_run(project_id, brief) -> ResearchRun`
- `cancel_run(run_id) -> ResearchRun`
- `resume_run(run_id) -> ResearchRun`
- `send_message(run_id, content) -> MessageResult`
- `get_run_snapshot(run_id) -> RunSnapshot`
- `get_report(run_id, version?) -> Report`
- `get_evidence(run_id, evidence_id) -> EvidenceRecord`
- `export_report(run_id, format) -> ExportResult`
- `delete_project(project_id) -> void`

`paperpilot://run-event` 包含 `contract_version`、`run_id`、`sequence`、`status`、`stage`、`progress`、`operation` 与安全摘要。运行状态严格限制为 `queued/running/waiting/retrying/completed/failed/cancelled`。

## 本地数据与隐私

- SQLite 明文保存非敏感 ID、状态、序号与时间；研究问题、对话、Evidence Record 片段、解析正文和报告 JSON 使用 AES-256-GCM 字段加密。
- 每个加密值使用独立随机 nonce；Windows 使用 DPAPI 保护主密钥。测试环境允许显式注入内存密钥。
- 原始 PDF 加密保存在应用数据目录，最长保留 24 小时。项目删除级联清除数据库、附件、解析文本与中间产物。
- PDFium 本地提取分页文本与 locator；用户可选连接本机 GROBID。扫描型 PDF 在 MVP 中返回明确的“不支持 OCR”错误。
- 日志只记录 ID、阶段、耗时和错误类别，禁止记录研究问题、正文、证据片段、提示词、模型响应或凭据。

## 研究流水线

Rust 按固定顺序执行：

1. 问题结构化
2. 多源检索
3. 标识归一化与去重
4. 相关性筛选
5. 全文解析
6. Evidence Record 创建
7. 研究综合
8. 下一步建议
9. 引用审计

每个阶段开始与完成前都持久化检查点，然后发布安全事件。应用异常退出后，未完成运行在下次启动时进入 `waiting`，用户可恢复或取消。阶段必须幂等，不能重复创建 Evidence Record。

Claim 或 Recommendation 生成前必须存在不可变 Evidence Record。模型只能引用当前运行允许的 evidence ID；未知或跨运行 ID 使阶段失败。主要 Claim 的证据覆盖率必须为 100%，每份报告必须恰好包含三个 Recommendation。

`demo_mode` 使用固定文献和确定性综合器，不需要云端 Key，并能复现完整流程。

## 瞬时推理网关

现有 Web SaaS 和 Python API 保留。新增独立、版本化的桌面推理路由，继续复用内部 provider 边界：

- 网关只接收当前阶段所需的结构化 brief、论文标题、选定证据片段和允许使用的 evidence IDs。
- 网关不写 PostgreSQL、Redis、模型缓存或敏感日志。
- 请求携带幂等 `request_id`。重复请求返回同一进程内的短期结果；进程重启后客户端可安全重试。
- 客户端首次启动静默获取安装级访问令牌，仅用于认证与限流，不创建云端项目身份。令牌存入 Windows Credential Manager。
- 网络失败使本地运行进入 `retrying`；超过重试上限后停在可恢复的 `waiting`。

## 错误与恢复

- PDF 解析失败显示文件名与安全原因；扫描件提示暂不支持 OCR。
- 数据库解密失败、磁盘不足、evidence ID 校验失败或报告审计失败时，不写入或展示不完整报告。
- 报告修订失败时保留上一完整版本。
- 项目删除失败时保持可重试的本地清理记录，直到数据库和文件均已删除。

## 验收

- Rust：合同、加密、标识归一化、去重、24 小时 PDF 清理、阶段恢复、取消、Evidence Record 不变量、报告版本和三个 Recommendation。
- React：对话启动、流式时间线、等待/完成/修订状态、旧报告保留、Evidence Drawer 与导出。
- 网关：最小请求、未知 evidence ID 拒绝、幂等请求、无数据库写入和敏感日志检查。
- Windows：创建项目、文本型 PDF、运行恢复、完整报告、自动修订、Markdown/打印导出、项目级联删除与安装包冒烟测试。
