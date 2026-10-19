# 文档 Agent：检索方案与参考项目调研

调研日期：2026-10-13。范围：Reader #41 的技术调研与可实施设计；本次不实现 Agent，不调用模型，不读取真实书库或 provider 凭证。Reader 源码基线为 `3aa18a5976f2d39217667699ebbd500e56d95064`，对应本任务 worktree 的起点；不把主目录其他提交或未提交修改当成本报告的事实。

本文区分三类证据：**源码事实**、**文档描述**、**设计建议**。只有下文 SQLite 小实验属于本次执行验证；参考项目没有在本机部署或做效果评测。选择它们是因为存在可核查的实现与文档，不以 star 数、厂商宣传或不相同的评测证明“在 Reader 上效果成熟”。

首版具体取舍与工具契约以 [主设计](./document-agent-design.md) 为准；本文的 regex、向量、可恢复的长时全文遍历是候选能力，不表示首版全部实现。

## 建议取舍

先建立**可按位置读取的全文证据库**，再提供块级词法检索、精确查找、目录与连续阅读工具。首期基线使用已有 SQLite：英文等有词边界的文本用 FTS5/BM25，中文使用显式子串检索并评估 trigram 加速；保留一、二字查找的有界扫描。向量召回作为可替换的第二路，必须以中文问英文论文、同义表达等失败集的结果决定是否进入首期，不把向量数据库变成所有用户启用 Agent 的前置条件。这是结合当前单文档、本地桌面应用范围的设计判断。

“RAG、正则、向量”不是三个互斥选项。RAG 描述找到外部证据再生成答案的方式；词法、精确匹配、正则、向量可以分别承担其中的检索任务。Agent 的关键能力是能根据已有证据继续搜索、读相邻段落、核查跨章内容，而不是在发给模型之前只增加一次固定 top-k 检索。

必须明确三个不同承诺：

- **全文可访问**：所有已成功提取的正文都能经工具到达，未提取页、失败章节和非文本内容有明确状态。
- **针对问题选取上下文**：局部事实问答先检索再阅读，没必要每问都把整篇塞进上下文。
- **全文总结或穷尽性问题**：有遍历范围与覆盖记录，长文采用分章阅读和逐步归纳；固定 top-k 不能证明覆盖全文。LlamaIndex 的默认 `SummaryIndexRetriever` 返回所有节点，和向量 top-k 检索是不同路径，可作为分流设计的参考。[SummaryIndex 固定源码][llama-list]

## Reader 已有的基础和缺口

| 源码事实                                                                                                                                                                                                                                                               | 对 #41 的影响                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `search_index` 是 `fts5(document_id UNINDEXED, href UNINDEXED, content, tokenize='unicode61')`。导入时只有 EPUB 的 `prepareEPUB` 产出 `texts` 并写入该表。[Store](../../apps/server/internal/reader/store.go)、[导入路径](../../apps/server/internal/reader/server.go) | 可复用 SQLite/FTS5 依赖，但不能称现有索引已覆盖 PDF。现有索引按 EPUB 资源 `href` 存储，不是独立证据段落。                             |
| `search` 将输入作为一个转义的 FTS phrase，随后执行带 `ESCAPE` 的 `LIKE` 子串补充，按 `href` 去重，最多返回 100 项；没有 BM25 排序，返回的 location 固定为 EPUB。[搜索实现](../../apps/server/internal/reader/server.go)                                                | 中文并非完全无法搜索，已有回退。不能直接把此端点改名为 Agent 搜索便声称支持跨格式、相关性排序和精确引用。                             |
| EPUB 正文块已有 `id/text/label/location`，按 manifest `readingOrder` 读取已清洗 HTML；location 带 `href`、DOM 范围、quote、UTF-16 范围和 block ID。[正文块](../../apps/server/internal/reader/epub_blocks.go)、[导入清洗](../../apps/server/internal/reader/epub.go)   | 复用现有语义块和位置。不要另建“第 N 页 EPUB”，也不要仅用章节标题或 quote 作为唯一定位。                                               |
| PDF `PDFBlock` 已有 `id/page/label/bounds/text/image/caption`；layout manifest 有 `Pages/ParsedPages/IncompletePages/Warnings`。`ParsedPages` 为空的旧约定是全部已解析。[版面结构](../../apps/server/internal/reader/processing.go)                                    | 页数、解析范围和正文质量必须分别判断。`readLayout` 成功、blocks 非空都不能单独证明全文可用。                                          |
| PDF 图书按章解析，单次窗口最多 30 页；导入和自动翻译开关会影响后续解析路径。[按章处理](../../apps/server/internal/reader/book_layout.go)、[触发语义](../pdf-on-demand.md)                                                                                              | Agent 全文索引需要独立于“是否开启翻译”和“目前翻了哪章”的状态及生命周期。                                                              |
| PDF processor 从 PDF.js 提取文字；没有文字的页加入 `incompletePages`，明确提示尚未接入 OCR。[提取](../../apps/processor/src/text.ts)、[processor](../../apps/processor/src/main.ts)                                                                                    | 现有路径不能解决纯扫描 PDF。此类问题必须报告文本覆盖不足，不能把无结果解释成论文没有相关论述。图表/公式也不能仅凭周边文字宣称已读懂。 |
| `DocumentLocation` 明确区分 PDF 页码/矩形与 EPUB href/locator。[reader-core](../../packages/reader-core/src/index.ts)                                                                                                                                                  | 新引用协议应携带这一联合类型，并保留块 ID 与来源版本；搜索索引中的标准化文本不能覆盖原始引用文本。                                    |

本节行号可在基线中查到：`store.go:102`、`server.go:395/437/750`、`epub_blocks.go:20/69/200`、`processing.go:50/64`、`book_layout.go:22/116`、`apps/processor/src/main.ts:113`。这些是静态源码观察，不构成真实 PDF/EPUB 全文抽取验收。

## 四个参考项目能借鉴什么

### PaperQA2：把“收集证据”做成可重复调用的动作

官方说明把检索论文、收集证据、生成回答拆成工具，Agent 可以换问法、重复检索；证据阶段包含 chunk 召回及面向问题的摘要/评分。固定源码的 `GatherEvidence` 接收更具体的问题，把新增证据加入会话并返回证据数量与摘要。[官方说明][paperqa-readme]、[GatherEvidence 源码][paperqa-tools]

**对 Reader 的借鉴**：不要将所有工作藏在一个“问答”调用里。搜索返回候选块与位置，阅读返回原文；会话保存已读证据 ID，模型可追问“实验设置”和“局限性”并分别收集证据。最终引用应指回原文块，而不是只引用某次自动摘要。

**不直接照搬**：PaperQA 的多论文发现、外部论文元数据获取、Python/LiteLLM 运行栈，以及 LLM 摘要/评分带来的额外调用，并不是当前单篇本地阅读所必需。其默认 embedding 和 NumPy 向量存储也只说明一种实现，不能推导 Reader 必须先运行独立向量服务。[配置与依赖说明][paperqa-readme]

### Onyx：多路召回后去重、扩展相邻内容，保留给 UI 的引用对象

固定源码的 `internal_search` 路径包含多查询、加权 RRF、相邻块合并、LLM 选择与扩展，再构造工具响应及用于存储/UI 的对象；底层调用 `hybrid_retrieval`。这一提交的内部搜索文档明确说明没有独立 reranking 阶段，不应套用其他版本的“混合检索加 reranker”描述。[搜索工具源码][onyx-tool]、[检索实现][onyx-runner]、[该路径说明][onyx-map]

**对 Reader 的借鉴**：命中一个短块后读上下文；跨章节问题拆查询；重复证据只占一次上下文；展示用引用对象与给模型的文字并行保存。将原始匹配分数当作“答案置信度”没有依据。

**不直接照搬**：企业连接器、联邦搜索、ACL 和多租户是 Onyx 工具中的实际依赖与边界。Reader 当前按会话绑定单文档，可先用明确 document scope 和轻量去重；在没有失败证据前，不需要复制多次 LLM 选择、扩展的整条调用链。[搜索工具依赖][onyx-tool]

### RAGFlow：先审查解析和切块质量，再讨论模型回答

固定 README 强调可检查的切块、可追踪引用、多路召回；部署配置同时包含文档引擎及元数据、对象存储等服务选项，当前官方 quickstart 描述的原生 Go Docker 构建目标是 Linux x86-64。[固定 README][ragflow-readme]、[部署配置][ragflow-compose]、[官方 quickstart][ragflow-quickstart]

**对 Reader 的借鉴**：把“哪些页有文字、哪些块是表格或图像、引用能否跳回原文”作为数据质量问题处理；给用户明确的缺页/解析失败信息。文档转换成一长段纯文本会损失这些能力。

**不直接照搬**：这一部署栈不是 Electron + Go 桌面阅读器的轻量内嵌依赖。参考其块、来源、解析质量和检索测试思路即可；本次没有验证其 OCR、多模态解析或召回效果，不据 README 的质量措辞承诺 Reader 的质量。

### LlamaIndex：区分“找具体证据”和“覆盖全文”

官方 Router Retriever 示例把同一组节点交给 summary、vector 和 keyword 路径，按问题选检索器；固定源码的默认 summary retriever读取全部节点，而 embedding retriever 另行选择 top-k。[Router 示例][llama-router]、[固定 retriever 源码][llama-list]

**对 Reader 的借鉴**：工具层统一证据块，策略层分为具体问答与覆盖阅读。总结任务按章节遍历并记录遗漏，不能只换一个更大的 top-k 就宣布全文总结。分章中间摘要需保留原文证据映射，并允许回读原文核对。

**不直接照搬**：工具路由并不自动带来正确回答。Reader 不必为了这几个工具引入整套 Python 框架；Go 服务可以直接实现类型化工具、预算、游标和证据账本。这是适配当前架构的判断，非 LlamaIndex 的性能评价。

### 固定引用的版本边界

| 项目                | 本次引用快照                               | 使用范围                                                                     |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| FutureHouse PaperQA | `57e89f7223b0960d5ee5ea048c69e3c47e088572` | README、证据工具；“PaperQA2”是项目命名，不能等同于这份快照的精确发行号。     |
| Onyx                | `6fed167d8ecf304022d69f39c9ad1dc7109d591c` | 当前内部搜索路径，不外推到历史版本或其他产品入口。                           |
| RAGFlow             | `c754300366c6397aed4c5f96876e0b2ec389042b` | README 与 Compose；网页 quickstart 另外标明为调研日文档。                    |
| LlamaIndex          | `5b7b6e323e1da3edd787a2104a89257c14f026d0` | SummaryIndex retriever；网页 Router 示例仅参考职责划分，不照搬其中模型版本。 |

这些 SHA 来自调研时公开 GitHub API 的默认 HEAD 响应，并读取了相应固定原始源码。没有安装这些项目，也没有以其公开 benchmark 数字作为 Reader 的预期效果。

## 检索方法的具体取舍

| 方法                 | 适合的任务                                      | 局限与 Reader 决策                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FTS5/BM25 词法召回   | 英文术语、缩写、方法名、关键词；按小块排序      | 用现有 SQLite；对 heading 和正文分列可调权重。`bm25` 值越小匹配越靠前，不能按普通相似度降序。中文无空格词边界需要另外处理。[FTS5][sqlite-fts]                                                                            |
| 中文分词             | 中文词语排序、词汇级相关性                      | 需维护词典、专名、新词、版本与索引重建；查询与正文必须用同一分词版本。首期不增加独立分词模型，除非测试证明词法质量不足。此处是工程取舍。                                                                                 |
| CJK n-gram           | 无词典中文子串候选召回                          | SQLite 自带 trigram，三字及以上子串可匹配；不足三字仍需回退。bigram 能覆盖两字，但需额外的预处理/索引设计，会有大量共有字串候选；不直接等同中文语义分词。[trigram 规范][sqlite-trigram]                                  |
| 精确子串             | 原句、中文短词、编号、数字、特殊符号            | 首期保留；绑定当前文档，对原文做最终验证，明确截断与扫描预算。找不到不能推导语义不存在。                                                                                                                                 |
| 有界正则（后续候选） | `Table\s+3`、公式编号、多个名称变体             | 若增加显式 `mode=regex`，参数只作用于规范化的文档块，不交给 shell；设置模式长度、扫描字符量、结果上限和取消。Go `regexp` 提供 RE2 风格、输入长度线性匹配，但仍需限制工作量。首版采用字面／词法查询。[Go 文档][go-regexp] |
| 向量召回             | 中文问英文、同义/概念表述、问题和证据词汇不重合 | 增加 embedding 模型、下载或远程调用、版本/维度/预处理一致性、索引失效与费用管理。不能修复漏页、错误切块、缺失的表格文字或不完整引用。先预留检索接口，以失败集判断是否加入。                                              |
| 词法 + 向量混合      | 同时覆盖精确词与语义召回                        | 两路独立取候选，以排名融合并去重后读取证据；不要直接相加不同含义的原始分数。Onyx 的 RRF 是可参考实现，权重仍需 Reader 自己验证。[RRF 使用说明][onyx-tool]                                                                |
| 目录 + 顺序/范围阅读 | 总结、跨章比较、所有假设/所有实验的枚举         | 不依赖查询命中；需要游标、读取预算、已覆盖/未覆盖范围。可和任何召回方式共存，是全文 Agent 必需的另一条路径。                                                                                                             |

**首期默认**：块级英文等词法排名 + 精确子串 + 目录/范围阅读。把中文 trigram 作为同一 SQLite 内的候选加速路线，在确定语料规模和查询计划后启用；两字查询继续有界扫描。不给无空格中文直接套 `unicode61` 后声称已有分词。Agent 可以生成少量中文/英文关键词帮助检索，但必须保留原问法并检验证据；查询翻译的有效性属于评测内容，不能代替跨语言检索验证。

多种索引只保存指向同一个原始证据块的标识。正文规范化（大小写、连字符、空白、PDF 断行）用于召回；展示引用依然用原始文本、位置与版本。若切块跨页，应保存多个来源范围；若只有块框，UI 只能承诺块级定位，不伪造逐句精确矩形。

### SQLite 行为小实验：已执行，非检索效果评测

在本任务 `apps/server` 模块依赖下，临时 Go 程序导入 `modernc.org/sqlite v1.60.1`，打开 `:memory:`，得到 `sqlite_version() = 3.53.4`。只插入合成字符串 `中文全文检索支持论文问答`，没有访问 Reader 数据库。结果如下：

| 查询                               | `unicode61` | `trigram` |
| ---------------------------------- | ----------- | --------- |
| `MATCH '全文'`                     | 0 行        | 0 行      |
| `MATCH '全文检索'`                 | 0 行        | 1 行      |
| `MATCH '中文全文检索支持论文问答'` | 1 行        | 1 行      |
| `content LIKE '%全文%' ESCAPE '\'` | 1 行        | 1 行      |

可复现实验核心 SQL；创建和查询语句对两种 tokenizer 各执行一次：

```sql
SELECT sqlite_version();
CREATE VIRTUAL TABLE ft USING fts5(content, tokenize='unicode61');
INSERT INTO ft(content) VALUES ('中文全文检索支持论文问答');
SELECT count(*) FROM ft WHERE ft MATCH '全文';
SELECT count(*) FROM ft WHERE ft MATCH '全文检索';
SELECT count(*) FROM ft
  WHERE content LIKE '%全文%' ESCAPE '\';
```

这只验证 tokenizer 和回退行为，不包含延迟、索引大小、召回质量或中文问答评测。SQLite 官方还明确：trigram 的 `LIKE` 优化不能用于带 `ESCAPE` 的查询。因此不能仅替换 tokenizer、保留现有 escaped LIKE 查询，就宣称已获得索引加速。应保留正确转义，对短查询使用有界原文扫描；若增加 trigram 候选查询，再用原文验证结果。[trigram 限制][sqlite-trigram]

## 可实施的数据与工具层

以下均为能力候选，具体工具命名与 provider 接入见主设计文档。首版将顺序遍历合并进目录入口和 read_passage 的前后块标识，不另增第四个工具，也不公开 regex／任意位置范围参数。

### 全文证据库独立于翻译

1. `DocumentCorpus` 记录 `documentId/sourceFingerprint/extractorVersion/indexVersion/generation/status`；正文更新或 parser 版本改变时构建新 generation，完成后原子切换，避免把旧页与新页拼成同一份证据。删除或移入回收站后，所有工具立即遵循现有文档可访问性。
2. `SourceBlock` 记录 `blockId/order/sectionPath/type/rawText/searchText/sourceHash/location`，支持 `prev/next`。超长块可拆出检索子块，但每个子块保留父块和原文范围。标题、注释、参考文献不是无条件丢弃，只按问题与块类型检索；页眉页脚可降低权重或排除，保留可解释规则。
3. `coverage` 对 PDF 按物理页记录 `not_extracted/text_available/text_missing/failed`，对 EPUB 按 reading-order 资源记录类似状态；另记图像、表格、公式等是否只有占位或描述。数字“共 N 页”与“可用正文 N 页”不能混为一谈。
4. PDF 先复用已成功解析的 `PDFBlock`；缺失页可进入单独抽取任务。该任务不能隐式开启整篇翻译，也不能因为翻译关闭而禁止问答。扫描页 OCR 或视觉读取如不在首期，工具返回精确缺页清单和不支持原因。
5. EPUB 复用清洗后的 reading-order/正文块，不扫描原始 ZIP 中任意脚本、导航或非正文资源。图像型 EPUB 也可能没有可搜索正文，不能按扩展名宣称全文就绪。

### 工具返回的是“候选或原文”，不是默认正确的结论

| 能力               | 最小请求                                            | 最小返回                                                                       |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| 查看文档与覆盖范围 | 会话绑定文档，无任意文件路径                        | 标题、格式、语言线索、目录、正文覆盖、未提取原因、source/index generation      |
| 搜索全文           | query、`lexical/literal/regex`、可选 section、limit | 块 ID、匹配摘要、位置、检索方法、是否截断、覆盖状态；不要把分数名叫 confidence |
| 阅读证据/邻域      | block IDs 或位置范围、字符/Token预算                | 原文块、前后关系、location、source hash、下一游标、返回的确切范围              |
| 顺序遍历           | section/range + continuation                        | 有序原文、已覆盖/仍未覆盖范围、下一游标；从头到尾不丢段落                      |

每次调用由服务端根据当前会话授权文档，忽略模型自行声称的授权范围；不要让任意路径、SQL、shell 或 URL 进入这些文档读取工具。文档内容始终是待分析数据，不能赋予修改工具权限。工具输出有确定长度上限，截断必须带游标；模型读了三个结果不能被记录为“读完全文”。

引用由服务端给返回证据分配稳定 ID，答案只允许引用当前会话实际返回的 ID。验证存在性、文档身份和版本后，客户端再展示 `PDFLocation` 或 `EPUBLocation` 跳转。**引用 ID 合法不等于语义支持答案**，后者仍需评测/核查；不要用“所有引用可点击”替代事实准确率。

### 两种读取策略

**针对问题的问答**：先查看覆盖和目录 → 搜索候选 → 读取候选及必要的前后段 → 发现定义、条件或实验设置缺失时再次搜索 → 依据已读证据作答。零命中时可有限改写查询或读相关章节；达到预算后说明证据不足，不自动补一段无出处的回答。

**全文总结/穷尽枚举**：先确定任务范围 → 按章节/页范围遍历 → 对每段建立压缩笔记及来源映射 → 合并、检查相互矛盾与缺失章节 → 回读关键证据 → 给出总结与覆盖说明。覆盖状态至少区分“可提取”“已交给模型读取”“已纳入归纳”；任何一项都不能自动证明模型理解无误。超预算时报告未读范围，而不是把局部总结标成全文总结。主设计首版只在交互预算内工作；可持久恢复的全书阅读需另立长时任务，不是本轮首版保证。

## 评估集与向量准入条件

这是一份待执行的评估计划，没有实际模型分数。

建议建立 12 份公开授权或合成文档的小型固定集，覆盖中英文、PDF/EPUB、短论文/长书、双栏/表格/公式、扫描页、重复段落、附录与跨章引用。用内容 hash 固定版本，人工标注可接受答案要点、必须找到的证据块、格式原生位置；额外生成损坏/部分抽取样本，不用真实用户书库当回归测试。

问题至少分为以下独立切片，不把平均分掩盖困难类型：

- 原文术语、缩写、编号、数字的精确问答。
- 中文无空格词语及一、二字短查询；特殊字符和正则边界。
- 中文问英文论文、同义换述和概念性问法。
- 需要两处或多处证据的跨节推理、比较、限定条件核对。
- 全文总结及“所有假设/实验/限制”的穷尽枚举。
- 表格、公式、图像、扫描页以及缺页；正确说明能力不足也计入预期行为。
- 文档没有答案、证据冲突、引用存在但不支持结论。
- 正文中的伪造工具指令、请求访问另一文档、索引更新后旧引用、删除/重试/取消。

**检索层单独评测**：证据 Recall@k、完整证据集合覆盖率（多跳题必须集齐）、MRR/nDCG（有排序标注时）、中文/跨语言切片结果、p50/p95 延迟、索引时间/大小、缓存和重建成本。若抽取本就缺失，单独计入抽取覆盖失败，不能仅算模型回答失败，也不能剔除后声称覆盖全部 PDF。

**Agent 层评测**：答案要点正确性、证据蕴含/引用支持率、准确跳转、无依据断言率、正确弃答、全文覆盖诚实性、工具调用数、总上下文/费用、完成和取消行为。固定相同模型与上下文预算，分别比较现有手动上下文、词法工具、词法加查询改写、向量/混合工具。先比检索再比答案，以免把 prompt 或模型升级的收益归给向量。

**向量引入条件**：

1. 先确认失败来自词汇/语言差距，而非漏页、错块、工具不可达、引用定位或预算截断。
2. 在固定失败切片上，词法加合理改写仍不能稳定找齐证据；混合召回有可重复收益，同时保留精确匹配质量。开发开始前锁定比较阈值和预算；本报告不虚构一个已经达到的效果门槛。
3. 明确 embedding 来源。远程 embedding 是向另一服务发送文档内容，应在产品设置中让用户明确配置；CLI 登录态不能被当作任意 embedding API 的凭证。使用本地模型需验收安装包/下载、内存、离线、启动时间和 macOS/Windows 支持。
4. 向量数据记录 `model/revision/dimension/preprocessing/sourceHash`，变更时重建；索引尚未就绪或服务失败时降级词法并如实返回模式，不能混用新查询向量与旧文档向量。
5. 单文档规模先测本地有界向量存储/扫描是否足够，再决定扩展或 ANN；不要在需求尚未扩到全库检索前引入常驻向量服务。多文档权限、吞吐和增量更新应在相应范围另作设计。

无论最后是否加入向量，全文可读取、覆盖状态、原生位置和可复核引用都应先完成，它们也是后续更换检索方案时不必重写的基础。

## 本次验证与未验证项

- 已完成：上述 Reader 基线的静态源码核对；四个项目的一手资料与固定源码核对；项目 Go SQLite 依赖下的内存 tokenizer 小实验。
- 未完成：真实 PDF/EPUB 语料抽取验收、OCR/图表理解、模型工具循环、端到端问答/引用正确率、延迟/费用比较、跨平台包装与运行验证。
- 本次仅新增研究文档，不改变运行时代码、模型配置、用户数据、索引或原始文档。应用 typecheck/test/build 不会验证研究结论，留给后续实施阶段；本文需要内容、引用与 diff 检查。

[paperqa-readme]: https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/README.md
[paperqa-tools]: https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/src/paperqa/agents/tools.py#L217
[onyx-tool]: https://github.com/onyx-dot-app/onyx/blob/6fed167d8ecf304022d69f39c9ad1dc7109d591c/backend/onyx/tools/tool_implementations/search/search_tool.py#L1
[onyx-runner]: https://github.com/onyx-dot-app/onyx/blob/6fed167d8ecf304022d69f39c9ad1dc7109d591c/backend/onyx/context/search/retrieval/search_runner.py#L51
[onyx-map]: https://github.com/onyx-dot-app/onyx/blob/6fed167d8ecf304022d69f39c9ad1dc7109d591c/.agents/feature-map/components/internal-search.md#L26
[ragflow-readme]: https://github.com/infiniflow/ragflow/blob/c754300366c6397aed4c5f96876e0b2ec389042b/README.md#L111
[ragflow-compose]: https://github.com/infiniflow/ragflow/blob/c754300366c6397aed4c5f96876e0b2ec389042b/docker/docker-compose-base.yml
[ragflow-quickstart]: https://ragflow.io/docs
[llama-router]: https://developers.llamaindex.ai/python/framework/integrations/retrievers/router_retriever/
[llama-list]: https://github.com/run-llama/llama_index/blob/5b7b6e323e1da3edd787a2104a89257c14f026d0/llama-index-core/llama_index/core/indices/list/retrievers.py#L31
[sqlite-fts]: https://www.sqlite.org/fts5.html#the_bm25_function
[sqlite-trigram]: https://www.sqlite.org/fts5.html#the_trigram_tokenizer
[go-regexp]: https://pkg.go.dev/regexp
