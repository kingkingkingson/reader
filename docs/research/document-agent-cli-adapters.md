# 文档 Agent 的 CLI 工具接入可行性

研究日期：2026-10-13。范围：Issue #41 的技术调研与可实施设计，不是功能实现或发布验证。

后续状态（2026-10-14）：用户已授权实施，Codex／DeepSeek API 第一阶段及本机真实调用记录见 [实施记录](../implementation/document-agent-issue-41.md)。下文保留研究时点的结论；Claude／Kimi、其他平台及配置变化竞态不能据此视为已验证。

## 结论

建议保留 Codex / Claude Code 自己的 Agent 循环，由 Reader 的 Go 服务实现所有文档工具、授权与执行限额，再通过进程或会话范围的 MCP 暴露给 CLI。普通模型 API 则由 Reader 驱动工具调用循环。两条路径共享工具实现与证据记录，不必共享循环控制代码，也不必修改用户的全局 MCP 配置。

登录约束（2026-10-13 用户确认）：复用已有 CLI 登录，采用原设计的配置探测、逐项禁用和重启复核流程；不为文档 Agent 增加独立登录步骤，不新建需要单独认证的 CLI 环境。Reader 不读取、复制或链接用户凭证。该选择确定接入方向，不代表隔离与真实工具调用已通过验证。

这条架构在协议层面成立，但本次不能宣称三种 CLI 都已满足“只暴露当前文档的只读工具”。必须先通过隔离发布门禁：

| 适配器           | 可用接入路径                                                 | 当前证据与限制                                                                                                  | 建议                                                    |
| ---------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Codex App Server | 进程 `-c` 或 `thread/start.config` 注入 Reader MCP；原生循环 | 本机稳定 schema 有 `config`；`dynamicTools` 仅实验 schema 有。`mcp_servers={}` 不能证明清空继承的 MCP           | 优先做 MCP 适配 spike；严格隔离未通过前不启用文档 Agent |
| Claude Code      | `-p --mcp-config --strict-mcp-config --tools ""`             | 当前 `--safe-mode` 禁用 MCP；移除它后还须证明 hooks、plugins、全局上下文不会进入运行                            | 保持原生循环；对版本、登录方式和隔离能力单独探测        |
| Kimi ACP         | `session/new.mcpServers`                                     | ACP 支持 MCP；所查上游 `kimi ... acp` 没有传递 Reader 的 agent profile，而且 `tools: []` 不涵盖后加载的插件/MCP | 暂不承诺可发布，先修复并实测版本适配                    |

“原生 runtime 保留循环”与“工具在 Go 执行”可以同时成立：CLI 决定何时调用 `search_document` / `read_passage`，MCP 只传递调用，Go 执行授权、检索与限额，再返回结果让 CLI 继续推理。这不要求把搜索算法写进 Codex 或 Claude，也不要求读取其登录凭证。

## 核查范围和版本

- Reader worktree：`/Users/jfs/.codex/worktrees/issue-41-agent-design/reader`，分支 `codex/issue-41-agent-design`，基线 `3aa18a5976f2d39217667699ebbd500e56d95064`。开始核查时工作区干净。
- 本机 PATH 的 `codex --version`：`codex-cli 0.162.0-alpha.17.2`。
- 本机 `claude --version`：`2.1.191 (Claude Code)`。
- 本机 PATH 未安装 `kimi`，没有完成 Kimi 启动、协议或推理测试。
- Codex 上游源码快照：[`73bbb654b3b9796b11624914b3be908ab8a0551f`](https://github.com/openai/codex/tree/73bbb654b3b9796b11624914b3be908ab8a0551f)。它用于解释代码语义，不等同于本机二进制版本。
- Kimi 上游源码快照：[`9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82`](https://github.com/MoonshotAI/kimi-cli/tree/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82)。官方站点存在 `kimi-cli` / `kimi-code` 两组文档，不能混用版本结论；本报告以下游实际二进制探测为最终验收依据。

本次只执行了版本、帮助查询，并在空临时工作目录生成 Codex App Server 的稳定与实验 JSON schema；没有启动推理，没有调用付费模型，没有读取用户配置或凭证，没有改动 CLI 全局配置。临时 schema 用于确认安装版本的协议形状，不作为业务功能通过证明。

## Reader 现状

当前实现有意将 CLI 收窄为文本生成器：

- [`codex.go`](../../apps/server/internal/reader/codex.go) 启动独立 `codex app-server --listen stdio://`，关闭 shell、unified exec、hooks、plugins、apps、多 Agent、code mode、图片工具和 web search，设置 `mcp_servers={}`；`thread/start` 使用 `ephemeral: true`、只读 sandbox 和 `approvalPolicy: never`。所有服务端主动 RPC 一律返回不支持，因此尚不能承接 `item/tool/call`。
- [`claude.go`](../../apps/server/internal/reader/claude.go) 使用 `--safe-mode --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}'`，保留 `--setting-sources user` 让 CLI 自己处理用户的网关、模型与认证设置。
- [`cli.go`](../../apps/server/internal/reader/cli.go) 给 Kimi 写 `reader.md`，包含 `tools: []`、`subagents: []` 的 Markdown frontmatter，执行 `kimi --agent-file ... --skills-dir ... acp`，`session/new` 传空 `mcpServers`，不声明客户端 filesystem/terminal capability，并拒绝全部权限请求。
- [`codex_chat.go`](../../apps/server/internal/reader/codex_chat.go) 已有按文档和已提交历史复用的进程会话缓存，失败、取消、未保存等情况会清理。新工具会话也必须遵守这套提交边界，不能在换文档后复用旧授权。

因此新增 Agent 能力不是只放开一个开关：还需工具注册、能力检测、调用记录、引用来源、预算、取消传播和阶段化流式输出。

## Codex：优先 MCP，dynamicTools 留作可选适配

### 接入方式

本机生成的稳定 `ThreadStartParams` 包含 `config: object | null`，不包含顶层 `mcpServers`、`dynamicTools`；实验 schema 才包含 `dynamicTools`。官方文档也明确 `dynamicTools` 与对应的 `item/tool/call` 需要 `initialize.capabilities.experimentalApi = true`。MCP 路径则沿现有配置接口注入服务定义。不要把 ACP 的 `mcpServers` 直接照搬到 Codex 的 `thread/start`。[Codex App Server](https://learn.chatgpt.com/docs/app-server)

初始实施可让一个 Reader 文档会话对应一个独立 App Server 子进程，把 Reader MCP 的 URL、工具 allowlist、启动/调用超时作为该进程的参数；临时 token 只放入子进程环境，由 `bearer_token_env_var` 引用。若选 `thread/start.config`，须先核验该版本对 dotted key 的解析，以及会话创建前是否已初始化别的 MCP。多文档共享一个进程不是第一阶段目标。

MCP 服务可使用现有 Go loopback 服务上的 Streamable HTTP endpoint。Codex 的 MCP 配置支持 URL、环境变量 bearer token、`enabled_tools`、`disabled_tools`、`required` 与超时；`required=true` 可避免 Reader 工具初始化失败后模型仍继续无证据回答。只读标记有助于 runtime 处理，但实际只读权限仍由 Go 强制。[Codex MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

概念参数如下，**不是已验证可直接发布的完整命令**：

```text
codex app-server --listen stdio://
  -c mcp_servers.reader.url="http://127.0.0.1:<port>/agent/mcp"
  -c mcp_servers.reader.bearer_token_env_var="READER_MCP_TOKEN"
  -c mcp_servers.reader.enabled_tools=["get_outline","search_document","read_passage"]
  -c mcp_servers.reader.required=true
  ...经固定版本验证的内置工具禁用参数...
```

实现应构造参数数组而不是拼接 shell；`READER_MCP_TOKEN` 是 Reader 自己签发的短期能力 token，不能复用 Reader 管理 API 的全权限 token，也不涉及 Codex 登录 token。

### `mcp_servers={}` 不是严格清空策略

所查 Codex 上游 [`config/src/merge.rs`](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/config/src/merge.rs) 对 TOML table 递归合并：overlay table 逐键覆盖；空 table 没有要覆盖的键，base table 中的旧项会保留。配置加载器将 CLI overrides 作为一层合并，而不是默认删除所有低优先级字段。[配置层加载源码](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/config/src/loader/mod.rs)

据此，当前代码的 `mcp_servers={}` **不能用作“没有继承用户 MCP”的证据**。同理，在 table 下加 `reader` 也不会自动删除其他服务器；`--profile` 的本机 help 说明它叠加在基础用户配置之上，不能当作全新空白环境。`--strict-config` 仅针对未知配置键，不等于 MCP allowlist。

采用下节的枚举和进程覆盖流程，复用原有认证环境。通过受支持配置接口提取继承服务器名称，为每项设置 `enabled=false`，再注入 Reader MCP。须验证禁用在首次连接和执行任何无关 hook/MCP **之前**生效，并检查管理配置、插件来源及配置变化时机。当前资料未证明本机版本存在一键严格 MCP 开关，也不能仅靠一次列表检查宣称完全隔离。

独立配置／认证环境及额外登录不作为本功能的备选。若某个版本／环境无法在既有登录下满足边界，应报告具体不兼容原因，暂不开放其文档 Agent；不能自动切换到新的登录流程或悄悄扩大工具权限。

`mcpServerStatus/list` 能提供服务器及工具清单，可用作验证证据；但“连接后发现多了一个服务器，再停止”只能阻止继续推理，不能撤销那个服务器启动时的副作用。实现应拒绝不符合能力档案的版本/环境，并保留普通聊天入口，不能悄悄放开整个 Codex。[MCP 状态接口](https://learn.chatgpt.com/docs/app-server)

### 可立即实施的隔离 spike：先枚举，再重启

进一步检查同一固定源码快照后，可以把下一步收敛为以下具体流程，而非先改全局配置。这是有源码依据的候选实现，尚未执行真实二进制 smoke：

1. 在 Reader 控制的空临时目录启动**探测进程**，从进程启动参数关闭 hooks、plugins、apps、shell、code mode 等已验证能力；不发送 `thread/start`、`thread/resume`、工具调用或模型请求。
2. `initialize → initialized → config/read {includeLayers:false, cwd:<同一临时目录>}`。读取有效配置中的 `mcp_servers` 键名；对所有值做丢弃处理，仅在内存保存名称及必要的非敏感能力布尔值，然后退出探测进程。`includeLayers:false` 仅省略逐层内容，**不是脱敏开关**；完整 effective config 仍可能包含用户填入的敏感配置，不能输出原始 RPC、写诊断日志或持久化它。若产品边界不允许经过这份配置响应，就不能采用此路线。
3. 构造**工作进程**参数：对每个继承服务器精确设置 `mcp_servers.<名称>.enabled=false`，使用无冲突的 Reader 服务器名，再注入 Reader URL/token 环境变量引用与三个只读工具。服务器名称必须使用该版本支持的 TOML 路径编码，不把未经编码的名称拼进 dotted key；含特殊字符时不能猜测解析规则。
4. 工作进程重复 `initialize → config/read`，确认名称集合和禁用状态与预期一致、功能关闭状态有效，再创建文档 thread。检测到新服务器、管理策略冲突或配置警告时结束工作进程并重新探测；不得带着未识别项继续。
5. 创建 thread 后再做运行时清单核验，确认 Reader 工具确实可见。这个核验是第二道检查，不能替代创建 thread 前的关闭操作；随后才允许用户问题进入模型。
6. 禁止主动请求配置 reload；将配置变更、CLI版本变化和新增服务器作为重建进程的原因。最终成文进程采用同样枚举/禁用流程，但不启用 Reader MCP。

支持这一流程的源码依据：[`McpManager::new_with_extensions`](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/core/src/mcp.rs) 只保存依赖和建立缓存；[`ConfigManager::read`](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/app-server/src/config_manager_service.rs) 加载、合并并序列化配置，没有调用 MCP 连接；[`MessageProcessor::new`](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/app-server/src/message_processor.rs) 创建空 thread manager，插件启动任务由 [`plugins_enabled` 守卫](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/core-plugins/src/manager.rs)控制。探测阶段不要调用 `mcpServerStatus/list`：其[实现](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/app-server/src/request_processors/mcp_processor.rs)会收集工具/资源 snapshot，不能当作纯配置名称读取接口。

这条路线保留官方认证：Reader 不改配置文件、不改变认证存储路径，App Server 仍通过自己的 AuthManager 获取登录状态。但 [`run_main_with_transport_options`](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/app-server/src/lib.rs) 会加载认证/云配置、初始化状态数据库与后台服务，所以“没有建 thread”不代表整个启动过程零网络、零本地状态副作用。这里仅得到配置探测路径不主动创建 MCP runtime 的源码证据，仍需用隔离夹具验证本机对应版本的实际启动行为。

尚未解决的严格边界是配置变更竞态：`config/read` 与 `thread/start` 使用的配置并非同一个可锁定 snapshot，工作进程可能在两者之间或后续重载时看到新服务器。有限次复核能检测普通漂移，不能数学上消除该窗口。因此可以据此制作可运行 spike、验证保留登录与进程级注入，但严格发布仍需证明配置快照/持续 allowlist 约束。验证不通过时按具体版本／环境限制文档 Agent 支持，不以额外登录替代该验证。

没有找到可作为替代的公开开关：所查 CLI 的 [app-server 分派](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/cli/src/main.rs) 向运行入口传入 `LoaderOverrides::default()`；[`ignore_user_config` / `ignore_project_config`](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/config/src/state.rs) 存在于内部 Rust loader options，未在这个命令的公开参数暴露。测试专用环境变量或内部嵌入接口不能当成生产 CLI 合约。所查[配置 schema](https://github.com/openai/codex/blob/73bbb654b3b9796b11624914b3be908ab8a0551f/codex-rs/core/config.schema.json)也未证明存在一个能同时覆盖所有内置/插件/MCP工具的稳定全局工具 allowlist；每服务器 `enabled_tools` 只约束对应服务器。

### dynamicTools 的价值与代价

动态工具会让 App Server 把工具调用作为 `item/tool/call` 发回 Reader；Reader 校验并直接调用 Go dispatcher，再返回结果。它减少一个 MCP transport/连接层，但不解决继承工具、hooks 或 sandbox 边界。它也不意味着 Reader 接管模型循环。[动态工具协议](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental)

它适合作为版本固定后的可选优化：必须处理请求 ID、重复请求、取消、超时、工具参数解析、错误返回和进程重启；当前“主动 RPC 全拒绝”要改成只接受明确工具调用，其他请求仍拒绝。由于它是实验字段，不能把它作为跨 CLI 工具层的唯一标准。先用 MCP 打通统一工具接口，再评估是否值得增加这个分支。

## Claude Code：严格 MCP 配置可用，safe mode 需要重新设计

本机 `2.1.191 --help` 与官方 CLI 文档均将 `--safe-mode` 描述为关闭 MCP、hooks、plugins、CLAUDE.md 等自定义内容；因此不能保留当前 safe mode 并假设 `--mcp-config` 一定重新启用 Reader MCP。[Claude CLI 参数](https://code.claude.com/docs/en/cli-reference)

各参数职责必须分开：

| 参数                                   | 负责什么                         | 不能据此推断什么                                     |
| -------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| `--mcp-config <Reader 临时 JSON 文件>` | 为这次调用加载 Reader MCP        | 单独使用不能排除其他 MCP                             |
| `--strict-mcp-config`                  | 只使用显式传入的 MCP 配置        | 不等于关闭 hooks、skills、plugins 或全部自定义上下文 |
| `--tools ""`                           | 关闭内置工具集                   | 当前官方文档说明不影响 MCP 工具                      |
| `--allowedTools <精确工具名>`          | 允许这些工具免交互执行           | 不是工具可见性 allowlist                             |
| `--permission-mode dontAsk`            | 无人值守时拒绝需要额外授权的操作 | 不能替代工具移除与服务端授权                         |
| `--disable-slash-commands`             | 关闭 skills                      | 不替代其他配置隔离                                   |
| `--no-session-persistence`             | 不保存 CLI 会话                  | 不代表 Go 可以在 provider 未完成时保存答案           |

表中参数语义以[官方 CLI 文档](https://code.claude.com/docs/en/cli-reference)和[权限文档](https://code.claude.com/docs/en/permissions)为依据；本机只查帮助，没有真实工具调用验证。工具名应为 `mcp__reader__search_document` 等精确名称，不给宽泛 `mcp__*` 的免审批许可。

候选运行形态：

```text
claude -p --output-format stream-json --verbose --include-partial-messages
  --tools "" --strict-mcp-config --mcp-config <临时 reader-mcp.json>
  --allowedTools mcp__reader__get_outline mcp__reader__search_document mcp__reader__read_passage
  --permission-mode dontAsk --disable-slash-commands --no-session-persistence
  ...经验证的配置/自定义内容隔离参数...
```

临时配置权限 `0600`、目录 `0700`，HTTP header 可引用 Reader token 的环境变量；传文件路径可避免把完整 token 放进进程参数。进程结束撤销 token，再清理文件。默认使用当前文档临时工作目录，始终不使用原文件所在目录。

移除 safe mode 后的选择：

- **API key 用户**：评估 `--bare`。官方说明它跳过自动发现的自定义项，显式 `--mcp-config` 仍可加载；但 Anthropic 认证限于环境 API key 或通过 `--settings` 的 apiKeyHelper，不使用订阅 OAuth 或系统钥匙串，所以它不能作为所有现有 Claude 订阅用户的直接替代。云厂商凭证另按其官方路径处理。[程序化运行 / bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)
- **保留 CLI 官方登录的用户**：需要针对支持版本验证独立配置隔离组合。当前在线文档提供 `--restricted`（至少 `2.1.248`），只读取 managed settings 和显式 `--settings`，可作为后续候选；本机 `2.1.191` 的 help 未列出，不能写成已支持。还要验证它对原有网关/model defaults 的影响、MCP 和登录可用性。不要凭参数名称推断安全边界。[restricted 参数](https://code.claude.com/docs/en/cli-reference)
- **保留 `--setting-sources user` 的宽兼容方案**：不能直接获批为严格文档 Agent。必须逐项验证用户 hooks、plugins、CLAUDE.md、memory、connectors 不会被载入或执行。空 object 不是“关闭一切”的通用覆盖法。

企业 managed MCP 可能禁止动态配置。官方文档说明可解析的 `managed-mcp.json` 会使工作站上的动态 `--mcp-config` / strict 配置失败；Reader 应展示具体不可用原因，不能修改管理策略或改用绕过权限模式。[managed MCP 与动态配置](https://code.claude.com/docs/en/managed-mcp#servers-passed-with-mcp-config-or-strict-mcp-config)

在线文档已包含比本机新的行为（例如部分 MCP 等待逻辑从 `2.1.221` 才生效），最低支持版本必须由测试矩阵确定，不能只读最新版文档后宣称 `2.1.191` 兼容。

## Kimi ACP：协议正确，现有启动/profile 假设需重验

ACP v1 的 `session/new` 可直接携带 `mcpServers`；stdio 是协议要求支持的 transport，HTTP/SSE 要通过 `initialize` 的能力协商确认。Reader 的 `clientCapabilities={}` 只表示不提供客户端文件/终端工具，不等于阻止 Kimi 自己执行本机工具。[ACP 会话创建](https://agentclientprotocol.com/protocol/v1/session-setup)、[ACP 初始化](https://agentclientprotocol.com/protocol/v1/initialization)

所查 Kimi 源码存在以下具体边界：

1. [`cli/__init__.py`](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/cli/__init__.py) 的主 callback 在 `ctx.invoked_subcommand != None` 时直接返回；`acp()` 子命令单独调用 `acp_main()`。因此 Reader 的 `kimi --agent-file ... --skills-dir ... acp` 不能靠主 callback 将这些选项带入运行。
2. [`acp/server.py`](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/acp/server.py) 的 `new_session` 将客户端 MCP 转换后传给 `KimiCLI.create(..., mcp_configs=[...], ui_mode="acp")`，没有传入 Reader 的 `agent_file`；[`app.py`](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/app.py) 在缺省 agent file 时选择默认 agent。这是所查快照的源码结论，尚未用安装二进制复现。
3. [`agentspec.py`](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/agentspec.py) 读取 YAML `version` / `agent`，要求 system prompt path；Reader 的 Markdown frontmatter 格式不符合该路径。正确形式应按实际支持版本使用完整 YAML 和独立 system prompt 文件，不能只换后缀。
4. [`soul/agent.py`](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/soul/agent.py) 先加载 agent 内置 tools，之后单独加载 plugin tools 和 MCP tools。`tools: []` 只证明第一步为空，不能证明全体工具为空。
5. [`acp/mcp.py`](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/acp/mcp.py) 有 HTTP、SSE 和 stdio 转换分支，但同一快照 initialize 宣告 `http=True, sse=False`；客户端必须按协商能力选择，不能仅凭转换函数推定 SSE 可用。

另一个易错点：该快照普通 CLI 路径只有 `mcp_config_file` 为空时才补入默认 MCP 文件，而后追加字符串 `--mcp-config`；因此只传 `--mcp-config '{"mcpServers":{}}'` 并不能在那条路径排除默认文件。这与 ACP 的 session MCP 路径是两回事，不能混用推论。[CLI 加载源码](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/cli/__init__.py)

Kimi 的实施门禁应是：选择支持显式 profile 且能禁用插件/其他内置工具的官方启动路径和版本，验证 `initialize → session/new → 工具清单 → 只读检索`，再启用。不要为赶齐 provider 数量放开默认 Agent；在此之前可以将该 provider 的文档 Agent 标为不可用，原有聊天兼容性另行修复和验证。

## 中间文字和最终答案必须分开

开启原生工具循环后，“我先查看方法章节”这样的顶层 assistant 文本会先于工具调用出现。当前 [`codex.go`](../../apps/server/internal/reader/codex.go) 拼接全部 `agentMessage`，[`claude.go`](../../apps/server/internal/reader/claude.go) 拼接全部顶层 `text_delta`，都不能原样用于工具模式。Claude 当前还比较最终 result 与所有拼接文本是否完全一致，工具轮中间文本会使这一假设失效。

Codex 本机 schema 的 `item/started` 与 `item/completed` 中 `agentMessage` 都有可空 `phase`，值包含 `commentary` / `final_answer`；`item/agentMessage/delta` 自身没有 phase。只有已收到且确认 phase 的 item 才能按 phase 分流；不能默认 null 就是 final，也不能保证每个模型在首个 delta 之前都给出非空 phase。[Codex 消息类型](https://learn.chatgpt.com/docs/app-server#items)

Claude 官方流式顺序允许同一模型消息先发 text block、再发 tool_use block，`message_delta` 才给 stop reason，随后执行工具并开启下一次模型消息。因此首个 text delta 到来时，不能根据它最终的 `stop_reason=tool_use/end_turn` 做可靠预判。[Claude 流式事件顺序](https://code.claude.com/docs/en/agent-sdk/streaming-output)

推荐先使用以下明确的兼容路径：

1. **读取阶段**：原生 CLI 自主调用工具；用户看到 Go 生成的简洁活动状态（例如“检索正文”“读取第 8 页”），工具轮文字不追加到最终答案。Go 保存成功工具返回的原文证据、定位与引用 ID，并强制轮次/调用数、总时间和返回字数预算。
2. **生成阶段**：读取阶段正常完成后，另开明确禁用工具的生成会话，传入问题、必要已提交历史，以及 Go 收集的有界原文证据与引用账本，流式输出最终回答。不要把第一阶段模型自行写的摘要当作唯一证据；若证据不足，最终回答必须明确缺口。

这会增加一次收尾模型请求和可能的上下文重放成本，但不增加第二个规划 Agent，也没有让 Go 模拟 CLI 的每个推理步骤。读取阶段已是原生循环；最后一步只负责引用已有证据进行表达。

本机稳定 Codex `TurnStartParams` 无 `tools` / `dynamicTools` / `config` 字段，因此“同一个 thread 下一 turn 关闭全部工具”不是可直接依赖的接口。`thread/start` / `resume` 的配置不等于任意当前 turn 可变工具集。第二阶段优先用新无工具会话；若未来要复用上下文，需另做工具撤销、缓存清除和历史恢复验证。

“无工具生成会话”本身也须通过前述隔离门禁，不能继续依赖 `mcp_servers={}` 的错误假设。Codex phase 可靠时可优化为单个原生循环直出 final phase；这应是通过版本/模型 smoke 后的优化，不是普遍协议保证。

取消、网络失败、超时、provider failed/interrupted 不得被这两阶段结构包装成成功：用户取消必须结束两阶段；失败不保存答案。预算耗尽应是显式的“证据获取未完成”状态，不能把 provider error 当 normal completion，也不能在已经展示最终片段后追加另一条替代回答。

## Go 工具层和生命周期

以下是设计建议，不是 CLI 内置保证：

- Reader 创建 `DocumentAgentSession`，绑定文档 ID、内容/索引版本、Reader chat ID、请求 ID、有效期和工具 allowlist。工具参数不接受任意文件路径，也不能靠模型传入另一个 document ID 切换授权。
- MCP endpoint 只绑定 loopback，要求每会话能力 token；若使用 stdio，则提供很薄的 Reader 受控桥接进程，由它转发到已认证 Go dispatcher。MCP server 无须拥有独立的模型凭证。
- 每次工具调用仍重新检查会话是否有效、文档是否删除/改变、输入长度、返回上限和累计预算；`readOnlyHint` / `openWorldHint` 只是协议提示。
- Go 工具直接复用同一检索/定位模块：MCP adapters 与 API function-call adapters 不应各写一套搜索。
- 工具活动事件由 Go 根据真实调用产生；工具参数中的论文原文、token、绝对磁盘路径不写入普通诊断日志。
- 取消先撤销能力，再向 provider 发 interrupt/cancel，取消正在执行的检索并按超时关闭子进程。不能只关闭 SSE，把后台 Agent 留着继续读取。
- 换文档、内容版本改变、删除文档、退出 Reader、未完成/未保存回答均销毁或重建会话；缓存身份要覆盖工具 schema 版本和检索索引版本。
- 只持久化最终答案、必要证据和可审计调用摘要；不依赖 CLI 自己的 transcript 成为 Reader 历史的权威来源。

## 发布门禁与后续真实 smoke

本次已经完成：Reader 现有代码阅读、本机 CLI 版本/help 查询、Codex 稳定/实验 schema 对比、官方文档和固定上游源码核对。以下全部是**后续实施与验证步骤，尚未执行**：

1. **无推理能力探测**：固定目标 CLI 版本，运行 MCP handshake、tools/list 和必要 schema 探测；分别记录“协议支持”“工具可见”“严格隔离通过”，不能合并成一个 connected=true。
2. **隔离夹具**：在专用测试 OS 用户或容器配置假全局 MCP、假项目 MCP、插件、hooks 和 CLAUDE.md/AGENTS.md；它们只能向临时 sentinel 文件写计数，不能接触真实用户资料。验证所有非 Reader 项既未启动也未暴露。测试 Codex 空 map merge 的实际行为与最终修正后的行为。
3. **授权负例**：两份含不同随机标记的文档 A/B；A 的 token 搜索 B、读 B 的 chunk、传任意路径、过期 token、删除 A 后继续调用，全部必须被 Go 拒绝。伪造 tool arguments 不能扩大范围。
4. **一次真实原生循环**：用户选定已登录 provider 后，问一个答案分布在前后章节的合成测试问题；记录 CLI 发出的真实工具调用和 Go 返回来源，确认无需手动载入上下文。不能把模型说“我搜索过”当作执行证据。
5. **流式证据**：捕获一次“中间说明 → 至少两次工具调用 → 最终回答”的协议序列；Codex 验证 item started/phase/delta 顺序及 null phase；Claude 验证 text/tool_use 同消息、result success 与 intermediate text 的关系；只有最终阶段文字进入答案流。
6. **停止/错误**：在检索执行中、工具结果返回后、最终文字输出中分别取消；模拟 MCP 崩溃、provider EOF、权限失败、超时和预算耗尽。确认无后台读取、无半答保存、无流式后回退答案，重试不会复用失败会话。
7. **零污染**：测试前后对测试账号的 CLI 全局配置做内容比较，证明 Reader 不写入全局 MCP 项。测试账号由官方登录配置，不复制真实账号凭证。
8. **平台与版本矩阵**：至少覆盖实际要发布的 macOS/Windows 版本；不同 CLI 版本独立声明可用。当前没有 Kimi 本机验证，也没有 Windows 实测。

只有隔离、证据与生命周期门禁通过的适配器才启用文档 Agent。否则保留已知兼容能力，并清楚标记该 CLI 版本暂不支持自动检索；不要把未验证的 native tools 能力暴露给论文中的不可信文本。
