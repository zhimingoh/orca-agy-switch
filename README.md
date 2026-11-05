# Antigravity 连接切换

Orca 插件：直接填写中转站 API Key、URL 和模型，在中转站与本机官方账号之间切换，不依赖 CC Switch。

## 安装

需要 Orca **1.4.248 或更新版本**，并已安装 Antigravity CLI（`agy`）。

在 **Orca → Settings → Plugins** 中使用 Git URL 安装入口，填写：

```text
https://github.com/zhimingoh/orca-agy-switch
```

按 Orca 的插件权限提示完成审核与启用，打开插件的 **AGY 连接** 面板。

如果当前版本没有 Git URL 安装入口，可以先克隆，再使用开发插件：

```sh
git clone https://github.com/zhimingoh/orca-agy-switch.git
orca plugin dev load ./orca-agy-switch
```

最后一条命令会列出插件请求的权限及批准命令。确认权限后执行其给出的命令。开发插件加载后应保留这个文件夹。

## 使用

1. 填写中转 URL、API Key、模型显示名，点击 **保存设置**。
2. 点击 **测试已保存的连接**，会发送一次最小模型请求。
3. 点击 **使用中转站**，然后关闭旧的 AGY 会话，在 Orca 里重新打开 Antigravity。
4. 要恢复官方账号，点击 **使用官方账号**，再重新打开 AGY；可继续用 Cockpit Tools 切换本机账号。

API Key 保存后不回显，再次保存时留空会保留原 Key。保存设置不会自动切换；修改配置后需要再次点击 **使用中转站** 才会应用。

URL 必须是中转站支持的 **Gemini 原生 API** 入口，不能只凭它支持 OpenAI 格式就认为可以使用。本插件预填通用占位地址 `https://example.com/antigravity`，使用前请替换为你自己的中转地址。

模型填写 AGY 支持的显示名，例如 `Gemini 4 Argon (Medium)`。中转站也需要支持或映射对应模型。

## 数据与作用范围

- 插件的 Key 使用 Orca 的系统密钥服务加密保存，URL 和模型保存在插件私有存储中。
- 启用中转后，Key 和 URL 同时写入 Orca 的 Antigravity 启动环境配置；这份环境配置不由插件加密。
- 专用 AGY 配置目录位于 `~/.orca/agy-switch/gemini`，其中不写入 Key。默认 `~/.gemini/config` 存在时会链接共享 MCP、Skills 等配置。
- 官方模式移除 Orca 中 Antigravity 的 Key、URL 环境覆盖和 `--gemini_dir` 参数，保留其他启动参数。
- 仅控制 **Orca 启动的 AGY CLI**，不修改独立 Antigravity 桌面应用的账号。
- 切换对新会话生效，不会终止现有会话。停用插件不会自动撤销已应用的启动配置；如需恢复官方模式，请先点击 **使用官方账号**。
- 本仓库不包含任何 API Key、登录凭据或用户配置，另一台机器需要重新填写。

## 兼容性

Windows / Orca 1.4.248 已验证：加密存储、官方/中转双向切换、重复切换，以及 Orca 实际启动 AGY 后的中转请求。

代码包含 macOS 常见安装路径适配，**macOS 尚未实机验证**。默认检查 `/Applications/Orca.app` 和 `~/Applications/Orca.app`；AGY 测试入口检查 Homebrew 和 `~/.local/bin` 等常见位置。

插件通过 Orca 的内部 `RuntimeClient` 设置接口修改 Agent 启动配置，Orca 升级可能需要适配。后台代码以当前用户权限运行，启用前请审核源码与 Orca 显示的权限。

验证插件结构：

```sh
orca plugin validate ./orca-agy-switch
```
