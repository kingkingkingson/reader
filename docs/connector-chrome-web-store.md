# Reader Connector 商店资料（0.1.0）

依据 `reader-connector-0.1.0-upload.zip`、`apps/connector/src` 和当前商店草稿截图整理。商店中的标题与摘要来自上传包。以下内容可逐项粘贴；涉及事实声明的选项应在最终上传包与桌面版联调通过后提交。

## Store listing

| 字段 | 填写内容 |
| --- | --- |
| Description | 见下方文本 |
| Category | Productivity（生产力） |
| Language | Chinese (Simplified)（简体中文） |
| Store icon | `apps/connector/store/icon-128.png`（128 × 128 PNG） |
| Screenshots | `apps/connector/store/screenshot-1280x800.jpg`（1280 × 800 JPEG） |
| Global promo video | 留空 |
| Small / Marquee promo tile | 留空，非必填 |
| Official URL | 未在 Google Search Console 验证网站前选 None |
| Homepage URL | `https://cynicalight.github.io/reader/` |
| Support URL | `https://github.com/cynicalight/reader/issues` |
| Mature content | 关闭 |

**Description**

> Reader Connector 将网页中的 PDF 论文收录到本机 Reader 论文库。打开论文页面或受支持的搜索结果，点击扩展，选择要收录的论文，并可添加分类和标签。扩展会尝试使用当前浏览器会话下载 PDF，提取标题、作者、摘要等论文信息，并保存可离线阅读的网页快照。没有取得 PDF 的页面不会创建条目。
>
> 使用前请安装并启动 Reader 桌面应用。首次收录时，Chrome 会请求网站访问权限，用于读取所选论文页面、PDF 和快照图片。导入内容发送到同一台设备上的 Reader；含 DOI 的论文可能向 Crossref 查询缺失的书目信息。具体数据处理方式见隐私政策：https://cynicalight.github.io/reader/privacy/
>
> 目前支持通用论文元数据，以及 arXiv、Google Scholar、PubMed 和 Semantic Scholar 的部分结果页面。网站限制、登录状态或跨站下载限制可能导致单篇收录失败。

## Privacy

| 字段 | 填写内容 |
| --- | --- |
| Single purpose description | 将用户选择的网页 PDF 论文及其书目信息收录到本机 Reader 论文库。 |
| activeTab justification | 用户打开扩展时，读取当前标签页的网址、标题和论文页面，以显示可选择的论文；不会持续读取其他标签页。 |
| scripting justification | 用户打开扩展时，在当前标签页运行随扩展打包的识别代码，提取论文元数据和候选 PDF 地址。 |
| storage justification | 在 Chrome 本地存储由本机 Reader 生成的连接凭据，以便扩展重新打开时继续连接同一台设备上的 Reader。 |
| Host permission justification | 访问 `http://127.0.0.1/*`，与同一台设备上的 Reader 桌面应用通信，获取分类和标签，并将用户选择的 PDF、书目信息与快照导入本机资料库。上传包中的主机权限使用 Chrome 认可的回环地址匹配规则；实际请求固定发往 `127.0.0.1:17841`。首次收录时另行请求 HTTP/HTTPS 网站访问权限，用于读取所选论文页面、PDF 和快照图片；论文的页面、PDF 与图片可能分布在不同网站。 |
| Are you using remote code? | **No, I am not using remote code.** Crossref 返回书目信息 JSON，论文网站返回页面、图片及 PDF；扩展执行的 JavaScript 已包含在上传包中。 |
| Privacy policy URL | `https://cynicalight.github.io/reader/privacy/`，须待 Pages 页面公开可访问后再填 |

**Data usage**：勾选 **Website content**（所选论文页面、PDF、快照图片和元数据）及 **Web history**（保存所选论文的来源网址和标题）。连接凭据由本机 Reader 生成并存于 Chrome 本地存储，建议同时勾选 **Authentication information**，使披露覆盖该凭据。其余类别按当前实现不勾选。扩展只处理用户打开或明确选择的页面，不持续收集全部浏览历史。

三项认证可在确认最终发布包行为与上述说明一致后勾选：不在政策允许情形外出售或转移用户数据；不将用户数据用于扩展单一目的之外的用途；不用于信用评估或贷款。Crossref 只接收 DOI 查询，属于补全所选论文书目信息所需的请求。

## Access → Test instructions

> 1. 安装并启动最新版 Reader 桌面应用：`https://github.com/cynicalight/reader/releases/latest`。扩展仅连接同一台设备上运行的 Reader，无需 Reader 云账号。
> 2. 在 Chrome 打开 `https://arxiv.org/abs/2501.01234`，点击 Reader Connector 图标。扩展应显示论文候选项。
> 3. 点击“收录 1 篇到 Reader”，允许 Chrome 请求的网站访问权限。等待结果，再在 Reader 的论文库中确认 PDF、论文信息及网页快照。
> 4. 可在 arXiv 搜索结果页选多篇论文，检查逐篇导入结果。若 Reader 未启动，扩展应显示连接失败提示。

## 提交前核对

上传 ZIP 不含固定扩展 `key`，商店分配的 ID 为 `dfhdcomjdkaiajiibbkonbonjlnkdjlg`；`apps/server/internal/reader/connector.go` 同时接受该 ID 与本地测试版 ID `afojfnpkeokahhniipldpdpecaljdnbe`。包含该来源的桌面版发布后，用商店安装包做一次连接、收录和重启验收。

商店后台草稿中的 **Yes, I am using remote code** 与当前上传包不符，应改成 **No**。本资料不代替后台保存，Pages 地址也要等 `website/**` 推送并部署后才能使用。
