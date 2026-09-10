# ReleaseDock · 软件版本发布中心

一个可以在单台云服务器上用 Docker 部署的软件发布网站。管理员输入密钥即可管理项目、上传安装包和发布版本；访客无需登录即可浏览公开项目、阅读更新日志和下载已发布文件。

## 已实现

- 公开项目目录、搜索、分类、更新动态、历史版本及手机端布局。
- 管理密钥登录、HttpOnly 会话、登录限流、会话过期和退出。
- 项目创建与编辑、图标上传、支持平台、官网地址、公开或隐藏。
- 版本草稿、稳定版与预发布版、Markdown 预览、最新稳定版标记。
- 安装包拖放上传、平台和架构设置、草稿附件移除、正式发布与下架。
- 公开下载、文件大小、SHA-256 校验值、HTTP Range 断点续传。
- 后台概览、版本与文件列表、站点名称、简介和公告配置。
- SQLite 持久化、审计记录、Docker 健康检查及可选 Caddy HTTPS。

默认是空站点。`design/` 的项目和统计只用于设计图，不会写入正式数据库。

## 本地启动

需要 Node.js 24 或更新版本，以及 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm start
```

打开 `http://127.0.0.1:8080`。首次启动自动在 `.data/admin-key` 生成管理密钥；在本地打开此文件，将密钥填入网站的管理入口。服务不会在日志或网页中展示密钥。

也可以运行 `pnpm key:generate`，生成包含随机 `ADMIN_KEY` 的 `.env`。已存在的 `.env` 不会被覆盖。程序还支持 `ADMIN_KEY_FILE` 从文件读取密钥。

## Docker 启动

需要 Docker Engine 和 Compose 插件。

```sh
docker compose up -d --build
docker compose ps
```

默认监听本机 `127.0.0.1:8080`，数据库、安装包、图标及自动生成的密钥保存在 `releasedock_data` 命名卷中。

未提供 `ADMIN_KEY` 时，可将首次生成的密钥复制到本机文件，再在本地查看：

```sh
mkdir -p .data
docker compose cp app:/app/data/admin-key .data/container-admin-key
```

如果已通过 `.env` 设置 `ADMIN_KEY`，则使用其中的密钥；容器不会另外创建 `admin-key` 文件。

## 云服务器与 HTTPS

1. 将代码放到服务器，安装 Docker，给域名添加指向服务器的 DNS 记录。
2. 将 `.env.example` 复制为 `.env`，设置 `DOMAIN=releases.example.com`。`ADMIN_KEY` 可自行填写至少 32 字符的随机值，也可留空由首次启动生成。
3. 在云防火墙放行 80/TCP、443/TCP；需要 HTTP/3 时放行 443/UDP。
4. 启动应用和 HTTPS 反向代理：

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
docker compose -f compose.yaml -f compose.https.yaml ps
```

随后访问 `https://你的域名`。Caddy 自动申请及续期证书，应用自动启用 Secure Cookie。管理密钥只应通过 HTTPS 或本机地址提交。

已有 Nginx、Caddy 或负载均衡器时，只启动基础 Compose，将请求反向代理到服务器的 `127.0.0.1:8080`，并设置 `.env` 中的 `COOKIE_SECURE=true`、`PUBLIC_URL=https://你的域名`、`TRUST_PROXY=1`。仅在确有可信反向代理时设置 `TRUST_PROXY=1`。

直接在公网使用 HTTP 不作为默认部署方式。测试时如确需从其他机器访问，可设置 `BIND_ADDRESS=0.0.0.0`；正式管理请启用 HTTPS。

网络无法访问 Docker Hub 时，可选择镜像源构建，不需要修改系统 Docker 设置：

```sh
docker compose build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:24-bookworm-slim --build-arg NPM_REGISTRY=https://registry.npmmirror.com
docker compose up -d --no-build
```

## 常用配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_KEY` | 自动生成 | 管理密钥，32–512 字符；建议随机生成 |
| `ADMIN_KEY_FILE` | 空 | 本地服务从指定文件读取密钥，优先于 `ADMIN_KEY` |
| `PORT` | `8080` | 本地端口或 Compose 映射端口 |
| `HOST` | `127.0.0.1` | 本地服务监听地址；容器内固定为 `0.0.0.0` |
| `DATA_DIR` | `.data` | 本地数据目录；容器中固定为 `/app/data` |
| `MAX_UPLOAD_MB` | `2048` | 每个安装包大小上限；项目图标上限为 2 MB |
| `SESSION_HOURS` | `12` | 会话有效期，最多 168 小时 |
| `COOKIE_SECURE` | 本地 `false` | HTTPS 部署应为 `true` |
| `PUBLIC_URL` | 空 | 对外源地址，包含协议，不含路径 |
| `DOMAIN` | 空 | 使用 HTTPS Compose 时填写域名，不含协议 |

更换管理员密钥并重启后，旧会话会全部失效。密钥没有找回接口；如果遗失，可通过服务器配置替换。

## 发布规则

1. 先创建项目，填写名称、标识和支持平台。
2. 创建版本，填写语义版本号、标题及更新日志。
3. 添加安装包；页面会先保存草稿，再上传真实文件。
4. 检查平台、架构与发布预览，然后正式发布。

草稿及其附件不会公开。项目隐藏后，即使知道已发布文件的地址也无法下载。下架会立即关闭新发起的公开下载，已经开始的传输可能继续完成。

正式发布的版本和安装包不可覆盖，以保证版本号和校验值一致；修订软件请创建新版本。预发布版不能设置为最新稳定版。

下载统计表示开始下载的请求数，不代表独立用户数。HEAD 请求和后续断点续传片段不会重复累计；从第一个字节重新发起下载会再次计数。

## 数据备份与更新

数据库、文件和密钥位于同一个持久卷。更新容器不需要删除该卷：

```sh
docker compose up -d --build
```

下面的备份命令适用于云服务器上的 Bash。停服后对整个数据卷做一致性备份：

```sh
umask 077
mkdir -p backups
docker compose stop app
docker compose run --rm --no-deps -T --entrypoint tar app -czf - -C /app/data . > backups/releasedock-data.tar.gz
docker compose start app
```

备份包含管理密钥及会话数据，请作为私密文件保存。还原时先停止应用，将归档还原到空的数据卷，再启动；不要在服务运行时覆盖 SQLite 文件。不要执行 `docker compose down -v`，它会删除数据卷。

当前适合单实例部署。要运行多个应用副本，应先迁移到共享数据库与对象存储；不能让多个容器同时管理本地附件目录。

## 验证与设计产物

```sh
pnpm test
pnpm preview:design
```

接口测试使用隔离临时目录，覆盖登录、权限边界、项目、版本、上传、下载、范围请求、下架和重启持久化。`scripts/check-ui.mjs` 使用 Playwright 验证真实浏览器全流程，测试数据不写入正式站点。

- `design/previews/`：9 个页面的设计图片及手机长图。
- `design/preview.html`：可直接打开的单文件设计预览。
- `design/gallery.html`：设计图片画廊。
- `docs/技术方案.md`：技术取舍、权限与数据模型。
- `docs/验收记录.md`：本次实现的验证范围和结果。

设计图使用真实 HTML/CSS 页面渲染，便于从视觉稿延续到当前应用。
