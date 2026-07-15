# LexiLearn 部署指南

## 架构

```
用户浏览器 ──HTTPS(443)──→ Caddy ──HTTP(3000)──→ server.js (Node.js)
                ↑ 自动 Let's Encrypt 证书
```

- **Caddy**：处理 HTTPS、自动申请/续期 Let's Encrypt 证书
- **server.js**：纯 HTTP 模式运行，只负责业务逻辑（API + 静态文件）

---

## 一、打包（本地 Windows）

```bat
deploy.bat
```

生成 `deploy-package\` 目录，包含：

```
deploy-package/
├── server.js          # Node.js 入口
├── adminServer.js     # 管理服务模块
├── package.json       # 依赖描述
├── package-lock.json  # 依赖锁定
├── .env               # 环境变量（API 密钥、端口等）
├── dist/              # 前端构建产物（index.html + admin.html）
├── ecosystem.config.cjs  # PM2 配置（可选）
└── .env.template      # 环境变量模板
```

将 `deploy-package/` 整个目录上传到服务器。

---

## 二、服务器部署

### 2.1 安装 Node.js 20+

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs
```

### 2.2 解压并安装依赖

```bash
cd /root
# 上传 deploy-package 到此

cd deploy-package
npm install --omit=dev
```

### 2.3 配置环境变量

编辑 `deploy-package/.env`，填入你的 API 密钥：

```env
TENCENT_SECRET_ID=AKIDxxxxx
TENCENT_SECRET_KEY=xxxxxxxx
VITE_LLM_MODEL=Qwen/Qwen3-VL-8B-Instruct
ADMIN_USERNAME=admin
```

### 2.4 启动应用

```bash
node server.js
# 输出：LexiLearn (HTTP) → http://localhost:3000
```

### 2.5 使用 PM2 守护（推荐）

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## 三、安装 Caddy（自动 HTTPS）

### 3.1 安装

```bash
yum install -y yum-plugin-copr
yum copr enable @caddy/caddy -y
yum install caddy -y
```

### 3.2 配置

编辑 `/etc/caddy/Caddyfile`：

```caddyfile
lexilearn.cloud {
    # 自动申请 Let's Encrypt 证书，无需额外配置

    # API 请求转发给 Node.js
    reverse_proxy /api/* localhost:3000

    # 静态资源直接由 Caddy 返回（更快）
    handle_path /assets/* {
        root * /root/deploy-package/dist
        file_server
    }

    # 其他请求也转发给 Node.js
    reverse_proxy localhost:3000
}
```

**如果暂时没有域名**，可以先用 IP + 自签名证书测试：

```caddyfile
:443 {
    tls internal
    reverse_proxy localhost:3000
}
```

### 3.3 启动

```bash
systemctl enable caddy --now
systemctl status caddy
```

### 3.4 防火墙放行

```bash
# 腾讯云/阿里云安全组也要放行 80、443 端口
firewall-cmd --add-port=80/tcp --permanent
firewall-cmd --add-port=443/tcp --permanent
firewall-cmd --reload
```

---

## 四、验证

| 地址 | 说明 |
|---|---|
| `https://lexilearn.cloud/` | 主应用 |
| `https://lexilearn.cloud/admin/` | 管理后台 |

---

## 五、数据持久化

用户数据存储在 `DATA_DIR` 指定的目录（默认 `/root/eldata`），独立于部署目录。重新部署时**不会丢失**：

```
/root/eldata/
├── users.json          # 用户账号
├── _admin.json         # 管理员列表
├── _usage.json         # 配额使用量
├── translations.json   # 翻译缓存
└── {userId}/           # 用户文件
    ├── {fileId}.json   # 文件元数据
    ├── _vocabulary.json
    └── _stats.json
```

---

## 六、更新部署

```bash
# 1. 本地重新打包
deploy.bat

# 2. 上传新的 deploy-package 到服务器，覆盖旧文件（保留 .env 和 /root/eldata）

# 3. 安装新依赖
cd /root/deploy-package
npm install --omit=dev

# 4. 重启
pm2 restart all
```

---

## 七、server.js 启动参数

| 参数 | 说明 |
|---|---|
| 默认 | HTTP 模式（适合生产环境 + 反向代理） |
| `--https` | 自签名 HTTPS（仅本地开发测试用） |
