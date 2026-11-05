# AVED 员工终端与管理台

这是可部署到 Linux 或其他支持 Docker 的服务器上的全栈项目。`server.mjs` 提供登录、员工资料、帖子及管理接口；`public/` 存放网页文件；SQLite 数据库存放在服务器的 `data/` 目录。

仓库保存程序和部署文件。员工账号、QQ 号、密码哈希、余额、帖子、头像和游戏记录只保存于服务器数据库，**不要把数据库或真实 `.env` 文件上传到 GitHub**。`.gitignore` 会忽略这些数据文件。

## 服务器首次部署

Ubuntu 安装 Docker Engine 和 Docker Compose 插件后：

```sh
git clone https://github.com/LimsaLominsa/AVED.git ~/AVED
cd ~/AVED
cp .env.example .env
mkdir -p data
```

编辑 `.env`：把管理员账号和至少 6 位的密码改成自己的值，并设置至少 32 个字符的 `SESSION_SECRET`。然后启动：

```sh
docker compose up -d --build
docker compose ps
```

服务监听公网 4173 端口。AWS 安全组也需要允许 TCP 4173 入站。网页入口由 `public/index.html` 提供；仓库根目录的 `index.html` 是保留的原始展示模板。

## 更新代码

```sh
cd ~/AVED
git pull origin main
docker compose up -d --build
```

容器重建会保留 `data/` 数据目录。若迁移服务器，请先停止服务，备份 `.env` 和整个 `data/` 目录，再在新服务器恢复它们。数据库和 `.env` 不需要、也不应上传 GitHub。

## 管理员功能

管理员登录后进入管理工作台，可以录入和修改员工账号、姓名、QQ 号、部门、余额等信息，并查看完整的公告留言、论坛主题和回复记录。删除帖子会弹出二次确认并从数据库删除；删除论坛主题时，其回复也会随之删除。

员工登录仍可使用员工端现有档案、公告、论坛、个人资料和玩法页面。管理台为管理员显示黑白灰的复古终端样式，不显示员工玩法和曲目管理。

## Windows 本机预览

安装 Node.js 24 或更新版本后，可使用 `启动预览.bat`，再打开 `http://127.0.0.1:4173`。本机演示账号仅用于本地预览，不适用于正式服务器。

API 路径和请求字段见 [API.md](API.md)。美工可编辑 `public/` 下的 HTML、CSS 和 JavaScript；只要保留 API 路径和字段约定，服务器数据接口就能继续使用。

开发维护说明见 [DEVELOPER.md](DEVELOPER.md)。
