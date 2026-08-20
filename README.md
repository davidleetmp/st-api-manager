# 🍸 SillyTavern API 档案管理器 (ST-API-Manager)

> 本地安全保存、快速切换与连通性测试用户的多平台 API 配置（包含网址、密钥、模型、附加参数与预设）的酒馆专属插件。

---

## ✨ 核心特性

- 🛡️ **严格本地存储 & 零泄露风险**：所有 API 网址、私密密钥及自定义参数均保存在本地浏览器（SillyTavern `extension_settings`），绝不上传云端，仓库代码与配置完全物理隔离。
- ⚡ **一键设为有效 (Active Switcher)**：支持保存多个 API 配置（如 DeepSeek 官方、Claude 破限、OpenAI 生产、硅基流动、本地 Ollama 等），一键切换生效，高亮状态卡片与顶部状态指示器，并可自动同步到酒馆主连接面板。
- 🌐 **多厂商预设一键填入**：内置 DeepSeek、OpenAI、Anthropic Claude、Google Gemini、SiliconFlow、OpenRouter、Ollama 等常用模板，一键自动填充基础网址与模型。
- 🔍 **全功能增删改查与克隆**：
  - **增加**：模态弹窗录入，支持参数校验、自定义 Headers、Payload Body、专属提示词与备注。
  - **删除**：安全二次确认，自动处理生效回退。
  - **修改**：全字段回填，支持明文/密文切换与剪贴板快捷粘贴。
  - **克隆**：一键复制现有配置作为副本快速调整。
- 📶 **实时连通性测试 (Ping & Latency Diagnostic)**：无需进入会话，直接在插件界面一键测试 API 端点可用性、HTTP 状态码及响应延迟（毫秒级）。
- 📥 **一键拉取远程模型 (Fetch Models)**：支持自动从 API 端点（`/models`）拉取所有可用模型列表，告别手动查找与拼写错误。
- 💾 **安全备份与脱敏导出 / 导入**：
  - **完整备份模式**：包含密钥，方便个人私有迁移。
  - **安全分享模式**：自动剔除所有 API Key，方便与社区或好友分享端点及附加参数配置。
- ⌨️ **酒馆斜杠指令支持**：支持 `/api-manager list`、`/api-manager set <名称>`、`/api-manager` 快速交互。

---

## 📂 项目结构

```text
st-api-manager/
├── manifest.json            # 酒馆扩展清单定义
├── index.js                 # 扩展核心业务逻辑与事件监听
├── panel.html               # 酒馆扩展抽屉设置面板模板
├── modal.html               # 新增 / 编辑 API 弹窗模板
├── style.css                # 深度适配酒馆主题的现代流线型样式
├── package.json             # 项目元数据与测试指令
├── .gitignore               # 严格的安全防泄露过滤规则
├── README.md                # 插件使用与安装说明文档
└── test/
    └── api-manager.test.js  # 完整的自动化单元测试集
```

---

## 🚀 安装与使用方法

### 方式一：直接安装到本地 SillyTavern

将本项目目录放入 SillyTavern 的第三方插件目录中：

```bash
# 复制或软链接至 SillyTavern 第三方插件目录
cp -r /root/st-api-manager /root/SillyTavern/public/scripts/extensions/third-party/st-api-manager
```

启动或刷新 SillyTavern 网页，在右上角 **「扩展 (Extensions)」** 菜单中即可看到 **「API 档案管理器 (API Manager)」**。

---

## 🧪 自动化测试验证

本项目包含完整的单元测试，涵盖字段校验、URL 规范化、密钥脱敏掩码、CRUD 状态机、搜索过滤及远程模型解析：

```bash
npm test
# 或
node test/api-manager.test.js
```

---

## 🔒 安全说明 (Security Notice)

1. 本插件为纯前端本地扩展，**不会向任何第三方数据统计服务器发送您的任何 API 凭证**。
2. 插件项目自带 `.gitignore`，已将所有潜在的敏感凭证和测试缓存完全排除在 Git 追踪之外。

---

## 📄 开源许可证

MIT License
