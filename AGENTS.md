# PaperPilot Project Instructions

本文件适用于整个 `E:/Project/PaperPilot` 仓库。默认使用中文沟通；代码、API 字段、命令和生物医学固定术语保持原文。

## Product Scope

- PaperPilot 是面向中国大陆个人生物医学研究者的响应式 Web SaaS，用于探索研究进展、证据争议、研究空白和可检验的下一步方案。
- 产品不是聊天优先工具。项目、研究运行、证据记录和报告是核心结构，报告后的追问只能基于已纳入证据。
- 产品不提供临床决策、诊断或治疗建议，不宣称生成正式 PRISMA 系统综述；所有报告必须保留研究用途免责声明。
- 首版不实现桌面端、本地模型、团队空间、自动实验、DOCX 或 Zotero 双向同步。不要主动引入 Go、微服务或 Kubernetes。

## Architecture And Stack

- Monorepo 根目录使用 npm workspaces；Web 位于 `apps/web`，Python API 与 worker 位于 `services/api`。
- Web：Next.js App Router、React、TypeScript、Tailwind CSS、Lucide。保持工作台式、安静、信息密集的界面，不创建营销首页。
- API：FastAPI、Pydantic、SQLAlchemy 2、Alembic。HTTP 合同和报告 JSON 必须显式版本化。
- 异步任务：Celery 和 Redis。阶段状态与中间结果持久化到 PostgreSQL；Redis 不保存论文正文或私密研究内容。
- 数据：PostgreSQL 是事实来源；pgvector 只用于召回，不能替代结构化 `EvidenceRecord`。
- 文件：生产使用 OSS 与 KMS；论文解析优先 GROBID，失败时使用 PyMuPDF。
- 模型：通过内部 OpenAI-compatible provider 接口调用企业级模型。只允许使用明确承诺不训练、不留存客户数据的服务。
- 本地 `demo_mode` 使用固定文献和确定性综合器，必须保持无外部 API Key 也能复现完整流程。

## Repository Map

- `apps/web/app`：页面和 App Router 路由。
- `apps/web/components`：工作台、研究表单、运行进度、报告和证据抽屉。
- `apps/web/lib`：API client、类型、阶段与报告映射；不要在页面中复制这些合同。
- `services/api/src/paperpilot/api`：HTTP 路由、认证和项目隔离。
- `services/api/src/paperpilot/connectors`：PubMed、Europe PMC、Crossref、OpenAlex 和私密材料连接器。
- `services/api/src/paperpilot/domain`：跨 API、worker 和报告使用的领域模型。
- `services/api/src/paperpilot/services`：检索、去重、证据综合和导出。
- `services/api/src/paperpilot/parsing`：GROBID/PyMuPDF 解析边界。
- `services/api/src/paperpilot/storage`：本地与 OSS 对象存储适配器。
- `services/api/alembic`：数据库迁移；持久化模型变化必须附带迁移。
- `evaluation`：至少 20 个生物医学题目的质量评测集。
- `docs` 和 `infra/aliyun`：架构、隐私和阿里云部署说明。

## Research Pipeline Invariants

- 固定流水线为：问题结构化 -> 多源检索 -> 标识归一化与去重 -> 相关性筛选 -> 全文解析 -> 证据抽取 -> 研究综合 -> 下一步建议 -> 引用审计。
- 文献标识统一处理 PMID、PMCID 和 DOI；去重优先稳定标识，再使用规范化标题。
- 在生成 Claim 或 Recommendation 前先创建不可变的 `EvidenceRecord`。正式结论不能只依赖向量相似度或模型记忆。
- 每个 Evidence Record 必须保存论文标识、原文片段、页码或章节、证据类型、置信度及其支持的结论。
- 模型返回的 evidence ID 必须属于当前 Research Run；发现未知或跨项目 ID 时拒绝结果，不能静默丢弃。
- 每个主要 Claim 必须至少关联一个 Evidence Record。引用审计后主要结论的证据覆盖率目标为 100%。
- 每份报告必须生成恰好三个 Recommendation。每项包含证据依据、可检验假设、最小验证方案、数据与资源需求、风险和停止条件。
- 运行状态仅使用 `queued/running/waiting/retrying/completed/failed/cancelled`。新增状态或阶段时同步更新后端模型、前端映射、SSE 和测试。
- 报告至少包含摘要、进展时间线、主题版图、主要结论、争议与局限、研究空白、三个下一步方案和参考文献。

## API And Tenancy Rules

- 所有项目、运行、报告、证据和上传接口必须按认证用户隔离。查询资源时同时验证资源 ID 与 `user_id`，不能先返回资源再做授权判断。
- 上传票据必须绑定用户、项目、文件名、最大尺寸和 15 分钟有效期；上传时校验 MIME、大小与 `%PDF-` 文件签名。
- API 改动应保持 Pydantic schema、SQLAlchemy model、Alembic migration、前端 TypeScript 类型和测试一致。
- Celery 任务必须可重试、可取消并可从持久化阶段恢复；不要依赖仅存在于 worker 内存中的关键状态。
- SSE 只发送阶段、进度、状态和安全错误摘要，不发送论文正文、提示词或模型完整响应。

## Privacy And Security

- 原始 PDF 在任务完成后最多保留 24 小时；Beat 清理逻辑与 `PAPERPILOT_UPLOAD_RETENTION_HOURS` 保持一致。
- 项目删除必须级联清除对象、正文、向量、模型缓存和任务中间产物，目标在 15 分钟内完成。
- 解析文本和 Evidence Record 可以随项目加密保留；生产 OSS 对象必须请求 KMS 加密并使用用户/项目隔离的对象键。
- 日志和监控只能记录标识符、阶段、耗时与错误类别。严禁记录研究问题、论文正文、证据片段、完整提示词、模型响应、密钥或令牌。
- 模型调用只发送当前阶段必要的结构化 brief、论文标题和选定证据片段，禁止一次性发送整个私密项目。
- `.env`、上传文件、数据库文件、缓存、测试截图、构建产物和模型输出不得提交 Git。

## Frontend Requirements

- 保持响应式项目工作台：首页直接展示项目与运行，不增加 landing page。
- 常用流程必须覆盖新建研究、可选 PICO/日期/类型/关键词、PDF 上传、九阶段进度、报告阅读、证据展开、Markdown 下载、打印/PDF 和项目删除。
- 所有证据入口必须能打开对应 Evidence Record；不要显示无法追溯来源的结论。
- 使用 Lucide 图标和既有 CSS 变量，保持 8px 以下圆角、稳定控件尺寸、清晰焦点状态和可访问名称。
- 修改界面后检查桌面与移动视口，尤其确认长标题、三个建议卡、证据抽屉和移动底部导航无重叠、横向溢出或截断。

## Development Commands

在仓库根目录启动 API：

```powershell
$env:PYTHONPATH = "services/api/src"
.\.venv\Scripts\python.exe -m uvicorn paperpilot.api.app:app --reload --port 8000
```

在另一个终端启动 Web：

```powershell
npm run dev
```

完整容器环境：

```powershell
docker compose up --build
```

需要 GROBID 时使用 `docker compose --profile fulltext up --build`。本地 Web 为 `http://localhost:3000`，API 文档为 `http://localhost:8000/docs`。

## Verification

- 后端测试：`cd services/api; ..\..\.venv\Scripts\python.exe -m pytest -q`
- 后端 lint：`cd services/api; ..\..\.venv\Scripts\python.exe -m ruff check --no-cache src tests`
- 前端单测：`npm test`
- 前端 lint：`npm run lint --workspace @paperpilot/web`
- 生产构建与 TypeScript：`npm run build`
- 桌面与移动 E2E：先启动 API 和 Web，再运行 `npm run test:e2e`
- Compose 配置：`docker compose config --quiet`

根据改动范围运行相关命令。数据库模型、共享领域合同、研究流水线、隐私删除或用户主流程发生变化时，必须运行完整验证。无法执行的项目要在交付说明中明确列出。

## Change Discipline

- 先阅读相关实现与测试，复现问题并定位根因，再做最小范围修改。
- 保护用户已有改动，不回退、不覆盖、不顺带重构无关代码。
- 仅在能够减少实际复杂度或匹配既有边界时新增抽象。
- 只有用户明确要求时才执行 commit、push、PR、merge 或发布。禁止未经确认使用 `git reset --hard`、强制推送或破坏性清理。
