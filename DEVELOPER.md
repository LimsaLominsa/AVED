# AVED 开发者文档

本文档面向维护本项目的开发者，说明当前已实现能力、上线前仍需补齐项，以及“域名未下发阶段”的最小部署清单。

## 1. 技术栈与目录

- 后端：Node.js（原生 `http`）+ SQLite，核心文件：`server.mjs`
- 前端：原生 HTML/CSS/JS，核心目录：`public/`
- 部署：Docker Compose，核心文件：`compose.yaml`
- 接口约定：`API.md`

## 2. 网站已有功能（已实装）

### 2.1 登录与会话

- 账号密码登录、退出登录
- 基于 HttpOnly Cookie 的会话鉴权
- 管理员接口有角色校验（`admin`）

### 2.2 员工端功能

- 个人资料：匿名名、简介、头像
- 每日签到
- 收容档案浏览
- 公告阅读与留言
- 论坛主题与回复
- 音乐列表读取
- 游戏结算与历史记录

### 2.3 管理端功能

- 员工录入与修改（姓名、QQ、部门、启用状态、密码重置）
- 员工余额流水调整
- 档案与公告的新增/删除
- 帖子与论坛内容管理（删帖、删主题、删回复）
- 发言记录审查（含匿名身份与真实员工映射）

### 2.4 正在施工

1. 录入和修改员工数据：**已完成**  
2. 删帖：**已完成**（公告评论、论坛主题、论坛回复）  
3. 查看员工发言记录并映射匿名与真人：**已完成**（`/api/admin/posts`、`/api/admin/forum`、`/api/admin/speech-records`）

## 3. 当前“还缺什么”（面向上线可运维）

以下是“功能可用”到“可稳定运营”之间的缺口。

### P0（强烈建议上线前完成）

- 默认管理员口令治理：生产环境禁用默认口令，首登强制改密
- 备份与恢复演练：数据库定时备份 + 恢复验证
- 网络暴露收敛：未启用 HTTPS 前仅限内网或白名单访问

### P1（建议尽快补齐）

- 操作审计日志（`audit_logs`）：记录谁在何时删了什么、改了什么
- 登录防暴力（限流 / 失败次数限制）
- 会话安全参数加固（生产环境 `Secure`、`SameSite` 策略）

### P2（稳定性增强）

- 监控告警（进程、5xx、磁盘、数据库文件增长）
- 运维脚本（备份、回滚、健康检查）

## 4. “域名未下发阶段”最小部署清单

> 目标：在没有域名和正式 TLS 证书前，先让团队可用、数据安全可控。

### 4.1 准备服务器

1. 安装 Docker Engine + Docker Compose
2. 拉取代码并进入目录

```bash
git clone <your-repo-url> ~/AVED
cd ~/AVED
```

3. 准备环境变量和数据目录

```bash
cp .env.example .env
mkdir -p data
```

4. 修改 `.env`（至少）

- `BOOTSTRAP_ADMIN_USERNAME`
- `BOOTSTRAP_ADMIN_PASSWORD`（>=6 位）
- `SESSION_SECRET`（建议 >= 32 字符随机串）

### 4.2 启动服务（Docker）

```bash
docker compose up -d --build
docker compose ps
```

### 4.3 验证运行状态

```bash
docker logs -f aved-web-1
curl -I http://127.0.0.1:4173
```

> 容器名可能不是 `aved-web-1`，以 `docker compose ps` 输出为准。

### 4.4 访问策略（无域名阶段）

- 仅开放给内网/办公网访问（推荐）
- 或云安全组仅放行固定办公 IP
- 暂不建议“公网全开放 + 明文 HTTP 登录”

### 4.5 数据备份（最低要求）

每日备份 `data/` 目录下数据库文件：

- `wanyehui.db`
- `wanyehui.db-wal`
- `wanyehui.db-shm`

建议将备份同步到另一台机器或对象存储。

### 4.6 域名下发后切换

域名完成后再接入 Nginx/Caddy 做 TLS：

- 外部：`https://your-domain`（443）
- 内部反代到：`http://127.0.0.1:4173`

## 5. 常见运维排查

- 登录失败先确认是否连到了正确数据库（Docker 通常使用 `data/wanyehui.db`）
- 容器重建后数据丢失，优先检查 `compose.yaml` 的 volume 是否生效
- 页面功能异常时，先查后端日志，再对照 `API.md` 字段

---

如需继续推进，建议下一步优先实现：`audit_logs` 表 + 关键管理操作写审计。
