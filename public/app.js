// ===== 基础 DOM 与页面状态 =====
const $ = (selector) => document.querySelector(selector);
const welcome = $("#welcome"),
  loginCard = $("#loginCard"),
  dashboard = $("#dashboard");
const networkSignal = document.querySelector(".signal");
let currentUser = null,
  musicItems = [],
  musicIndex = -1;

// 更新 welcome 区域左上角网络灯状态：online(绿) / offline(红)
function setNetworkSignalStatus(status) {
  if (!networkSignal) return;
  networkSignal.classList.remove("online", "offline", "checking");
  networkSignal.classList.add(status);
}

// 使用同源请求探测服务可达性：能收到任意 HTTP 响应即视为在线
async function probeServerStatus() {
  try {
    await fetch("/api/me", { cache: "no-store" });
    setNetworkSignalStatus("online");
  } catch {
    setNetworkSignalStatus("offline");
  }
}

// 切换欢迎页 / 登录页 / 主面板显示状态
function show(section) {
  [welcome, loginCard, dashboard].forEach((x) => x.classList.add("hidden"));
  section.classList.remove("hidden");
}

// 对用户可见文本做 HTML 转义，避免插入 HTML 造成页面污染
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "服务器暂时无法处理请求。");
  return result;
}

// 在主内容区展示统一错误
function showError(message) {
  $("#panel").innerHTML = `<p class="error" role="alert">${esc(message)}</p>`;
}

// 更新顶部 tab 的高亮样式
function setActive(tab) {
  document
    .querySelectorAll(".tab")
    .forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
}
$("#enter").addEventListener("click", () => show(loginCard));
$("#back").addEventListener("click", () => show(welcome));

// ===== 登录与门户初始化 =====
$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const error = $("#error");
  error.textContent = "正在核验…";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    error.textContent = "";
    await loadPortal();
  } catch (e) {
    error.textContent = e.message || "暂时无法连接，请稍后再试。";
  }
});
$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  currentUser = null;
  show(welcome);
});
async function loadPortal() {
  try {
    const data = await api("/api/me");
    currentUser = data.employee;
    const isAdmin = currentUser.role === "admin";
    $("#greeting").textContent = "欢迎回到公司，" + currentUser.displayName;
    $("#employeeMeta").textContent = isAdmin
      ? "管理员　/　员工资料与内容管理"
      : (currentUser.department || "员工") +
        "　/　余额 " +
        Number(data.balance).toLocaleString() +
        " 点";
    dashboard.classList.toggle("admin-mode", isAdmin);
    document.querySelector(".brand small").textContent = isAdmin
      ? "管理终端 / ADMIN CONSOLE"
      : "员工内部终端 / INTERNAL";
    document.querySelector(
      ".portal-main .welcome-banner .eyebrow",
    ).textContent = isAdmin
      ? "SYSTEM ADMINISTRATION · ACCESS GRANTED"
      : "EMPLOYEE PORTAL · ACCESS GRANTED";
    document
      .querySelectorAll(".tabs .tab")
      .forEach((tab) =>
        tab.classList.toggle(
          "hidden",
          isAdmin ? tab.dataset.tab !== "admin" : tab.dataset.tab === "admin",
        ),
      );
    show(dashboard);
    if (isAdmin) await renderTab("admin");
    else await Promise.all([renderTab("files"), loadMusic()]);
  } catch {
    show(loginCard);
  }
}

// ===== 员工端：档案 / 公告 / 留言 =====
async function renderDossiers() {
  const { items } = await api("/api/dossiers");
  $("#panel").innerHTML =
    `<div class="section-heading"><h3>公司档案</h3><p>SERVER ARCHIVE / ${String(items.length).padStart(2, "0")}</p></div><div class="cards">${items.map((item) => `<article class="card"><span class="card-code">${esc(item.code)}　/　${esc(item.department)}</span><h4>${esc(item.title)}</h4><p>${esc(item.summary)}</p><div class="card-foot"><span>内部资料</span><span class="badge">${esc(item.status)}</span></div></article>`).join("") || "<p>暂无档案。</p>"}</div>`;
}
async function renderAnnouncements() {
  const { items } = await api("/api/announcements");
  $("#panel").innerHTML =
    `<div class="section-heading"><h3>内部公告</h3><p>SERVER BULLETINS / ${String(items.length).padStart(2, "0")}</p></div>${items.map((item) => `<article class="notice-box"><h4>${item.pinned ? "◆ " : ""}${esc(item.title)}</h4><p class="announcement-body">${esc(item.body)}</p><small>${esc(item.createdAt)}　/　${item.postCount} 条讨论</small><div class="post-list" id="posts-${item.id}"><p class="muted">正在读取讨论…</p></div><form class="post-form" data-announcement="${item.id}"><input name="anonymousName" maxlength="32" required placeholder="匿名名称"><textarea name="body" maxlength="2000" required placeholder="写一条匿名留言"></textarea><button class="small-action" type="submit">匿名发表</button></form></article>`).join("") || "<p>暂无公告。</p>"}`;
  for (const item of items) loadPosts(item.id);
  document.querySelectorAll(".post-form").forEach((form) =>
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form),
        button = form.querySelector("button");
      button.disabled = true;
      try {
        await api("/api/posts", {
          method: "POST",
          body: JSON.stringify({
            announcementId: Number(form.dataset.announcement),
            anonymousName: values.get("anonymousName"),
            body: values.get("body"),
          }),
        });
        form.elements.body.value = "";
        await loadPosts(Number(form.dataset.announcement));
      } catch (e) {
        alert(e.message);
      } finally {
        button.disabled = false;
      }
    }),
  );
}
async function loadPosts(id) {
  const target = $(`#posts-${id}`);
  if (!target) return;
  try {
    const { items } = await api(`/api/posts?announcementId=${id}`);
    target.innerHTML = items.length
      ? items
          .map(
            (post) =>
              `<div class="post"><b>${esc(post.anonymousName)}</b><span>余额 ${Number(post.balance).toLocaleString()}</span><p>${esc(post.body)}</p><small>${esc(post.createdAt)}</small></div>`,
          )
          .join("")
      : '<p class="muted">还没有留言。</p>';
  } catch (e) {
    target.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

// ===== 员工端：个人资料与签到 =====
async function renderProfile() {
  const [{ profile, achievements }, me, checkin] = await Promise.all([
    api("/api/profile"),
    api("/api/me"),
    api("/api/checkin"),
  ]);
  const avatar = profile.avatarUrl
    ? `<img class="profile-avatar" src="${esc(profile.avatarUrl)}" alt="员工头像">`
    : '<div class="profile-avatar default-avatar" aria-label="默认员工头像"><span>?</span></div>';
  $("#panel").innerHTML =
    `<div class="section-heading"><h3>个人主页</h3><p>PROFILE / SERVER SAVED</p></div><div class="profile-layout"><section class="profile-card">${avatar}<h4>${esc(me.employee.displayName)}</h4><p>${esc(me.employee.department || "员工")}</p><p class="balance-large">${Number(me.balance).toLocaleString()} <small>点</small></p><form class="admin-form" id="profileForm"><h4>个人资料</h4><input name="anonymousName" required maxlength="32" value="${esc(profile.anonymousName)}" placeholder="论坛匿名名称"><textarea name="bio" maxlength="500" placeholder="个人简介">${esc(profile.bio)}</textarea><label class="file-label">上传头像（PNG/JPG/WEBP）<input name="avatarFile" type="file" accept="image/png,image/jpeg,image/webp"></label><input name="avatarUrl" type="url" value="${profile.avatarUrl.startsWith("data:") ? "" : esc(profile.avatarUrl)}" placeholder="或填写头像 HTTPS 图片链接（可留空）"><button class="small-action">保存到服务器</button></form></section><section><h4>成就记录</h4><div class="achievement-list">${achievements.map((a) => `<div class="achievement ${a.earned ? "earned" : ""}"><span>${a.earned ? "◆" : "◇"}</span><b>${esc(a.title)}</b><small>${a.earned ? "已达成" : "尚未达成"}</small></div>`).join("")}</div><div class="checkin-card"><h4>每日签到</h4><p>${checkin.checkedIn ? `今日已签到，获得 ${checkin.reward} 点。` : "完成签到可领取服务器记录的每日积分。"}</p><button id="checkinButton" class="small-action" ${checkin.checkedIn ? "disabled" : ""}>${checkin.checkedIn ? "今日已签到" : "签到领取 150 点"}</button></div></section></div>`;
  $("#profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget,
      v = new FormData(f);
    try {
      let avatarUrl = v.get("avatarUrl");
      const image = f.elements.avatarFile.files[0];
      if (image) {
        if (image.size > 1600000) throw new Error("头像图片不能超过 1.6 MB。");
        avatarUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("读取图片失败。"));
          reader.readAsDataURL(image);
        });
      }
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          anonymousName: v.get("anonymousName"),
          bio: v.get("bio"),
          avatarUrl,
        }),
      });
      alert("个人资料和头像已保存到服务器。");
      await renderProfile();
    } catch (err) {
      alert(err.message);
    }
  });
  $("#checkinButton").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const result = await api("/api/checkin", { method: "POST", body: "{}" });
      alert(`签到成功，获得 ${result.reward} 点。`);
      await loadPortal();
      await renderProfile();
    } catch (err) {
      alert(err.message);
      e.currentTarget.disabled = false;
    }
  });
}

// ===== 员工端：互动玩法 =====
async function renderGames() {
  const [me, checkin, history] = await Promise.all([
    api("/api/me"),
    api("/api/checkin"),
    api("/api/games/history"),
  ]);
  $("#panel").innerHTML =
    `<div class="section-heading"><h3>互动玩法</h3><p>SERVER SETTLEMENT / BALANCE ${Number(me.balance).toLocaleString()}</p></div><div class="game-grid"><article class="game-card"><span class="card-code">DAILY CHECK-IN</span><h4>每日签到</h4><p>每天一次，奖励由服务器确认并写入余额流水。</p><button id="gameCheckin" class="small-action" ${checkin.checkedIn ? "disabled" : ""}>${checkin.checkedIn ? "今日已签到" : "领取 150 点"}</button></article><article class="game-card"><span class="card-code">SCRATCH TICKET / 1,000 点</span><h4>刮刮乐</h4><p>服务器生成随机种子、开奖并记录票据与余额变化。</p><button id="scratchButton" class="small-action">购买并刮开</button><div id="scratchResult" class="game-result"></div></article><article class="game-card"><span class="card-code">SLOT MACHINE / 500 点</span><h4>老虎机</h4><p>服务器完成随机抽取和派奖，页面只显示开奖结果。</p><button id="slotButton" class="small-action">启动老虎机</button><div id="slotResult" class="game-result"></div></article></div><div class="section-heading"><h3>近期游戏记录</h3><p>由服务器数据库读取</p></div><div class="table-wrap"><table><thead><tr><th>时间</th><th>玩法</th><th>支出</th><th>奖金</th><th>服务器随机种子校验值</th></tr></thead><tbody>${history.items.map((x) => `<tr><td>${esc(x.createdAt)}</td><td>${x.game === "scratch" ? "刮刮乐" : "老虎机"}</td><td>${Number(x.cost).toLocaleString()}</td><td>${Number(x.prize).toLocaleString()}</td><td class="hash-cell">${esc(x.seedHash)}</td></tr>`).join("") || '<tr><td colspan="5">暂无记录</td></tr>'}</tbody></table></div>`;
  $("#gameCheckin").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api("/api/checkin", { method: "POST", body: "{}" });
      await loadPortal();
      await renderGames();
    } catch (err) {
      alert(err.message);
      e.currentTarget.disabled = false;
    }
  });
  $("#scratchButton").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api("/api/games/scratch", { method: "POST", body: "{}" });
      await loadPortal();
      await renderGames();
      $("#scratchResult").innerHTML =
        `<b>${esc(r.prizeName)}${r.prize ? `：+${Number(r.prize).toLocaleString()} 点` : ""}</b><small>随机种子 ${esc(r.seed)} · 校验值 ${esc(r.seedHash)}</small>`;
    } catch (err) {
      alert(err.message);
      e.currentTarget.disabled = false;
    }
  });
  $("#slotButton").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api("/api/games/slot", { method: "POST", body: "{}" });
      await loadPortal();
      await renderGames();
      $("#slotResult").innerHTML =
        `<b class="slot-symbols">${r.symbols.map(esc).join("　")}</b><small>${r.prize ? `获得 ${Number(r.prize).toLocaleString()} 点` : "未中奖"} · 随机种子 ${esc(r.seed)} · 校验值 ${esc(r.seedHash)}</small>`;
    } catch (err) {
      alert(err.message);
      e.currentTarget.disabled = false;
    }
  });
}

// ===== 员工端：匿名论坛 =====
async function renderForum() {
  const { items } = await api("/api/forum");
  $("#panel").innerHTML =
    `<div class="section-heading"><h3>匿名论坛</h3><p>服务器帖子 / ${items.length}</p></div><form class="admin-form forum-create" id="forumCreate"><h4>发布新帖</h4><input name="title" required maxlength="120" placeholder="帖子标题"><textarea name="body" required maxlength="3000" placeholder="写下内容"></textarea><button class="small-action">匿名发布</button></form><div class="forum-list">${items.map((item) => `<article class="forum-post"><div class="forum-head"><b>${esc(item.title)}</b><small>${esc(item.anonymousName)}　·　余额 ${Number(item.balance).toLocaleString()} 点　·　${esc(item.createdAt)}</small></div><p>${esc(item.body)}</p><details data-thread="${item.id}"><summary>回复（${item.replyCount}）</summary><div class="reply-list" id="replies-${item.id}">正在读取…</div><form class="reply-form" data-thread="${item.id}"><textarea name="body" required maxlength="2000" placeholder="匿名回复"></textarea><button class="small-action">发送回复</button></form></details></article>`).join("") || '<p class="muted">还没有帖子。</p>'}</div>`;
  $("#forumCreate").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget,
      v = new FormData(f);
    try {
      await api("/api/forum", {
        method: "POST",
        body: JSON.stringify({ title: v.get("title"), body: v.get("body") }),
      });
      await renderForum();
    } catch (err) {
      alert(err.message);
    }
  });
  document.querySelectorAll("details[data-thread]").forEach((d) =>
    d.addEventListener("toggle", () => {
      if (d.open) loadReplies(d.dataset.thread);
    }),
  );
  document.querySelectorAll(".reply-form").forEach((f) =>
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = new FormData(f);
      try {
        await api(`/api/forum/${f.dataset.thread}/replies`, {
          method: "POST",
          body: JSON.stringify({ body: v.get("body") }),
        });
        f.elements.body.value = "";
        await loadReplies(f.dataset.thread);
      } catch (err) {
        alert(err.message);
      }
    }),
  );
}
async function loadReplies(id) {
  const target = $(`#replies-${id}`);
  if (!target) return;
  try {
    const { items } = await api(`/api/forum/${id}/replies`);
    target.innerHTML =
      items
        .map(
          (x) =>
            `<div class="reply"><b>${esc(x.anonymousName)}</b><small>余额 ${Number(x.balance).toLocaleString()} 点　·　${esc(x.createdAt)}</small><p>${esc(x.body)}</p></div>`,
        )
        .join("") || '<p class="muted">暂无回复。</p>';
  } catch (e) {
    target.textContent = e.message;
  }
}

// ===== 管理端：员工维护与内容管理 =====
async function renderAdmin() {
  if (currentUser?.role !== "admin")
    throw new Error("只有管理员可以访问此页面。");
  const [{ items: employees }, { items: forum }, { items: comments }] =
    await Promise.all([
      api("/api/admin/employees"),
      api("/api/admin/forum"),
      api("/api/admin/posts"),
    ]);
  const content = [
    ...comments.map((x) => ({ ...x, itemType: "comment" })),
    ...forum,
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  $("#panel").innerHTML =
    '<div class="section-heading"><div><h3>管理工作台</h3><p>员工资料与帖子记录均读取服务器数据</p></div><span class="admin-count">员工 ' +
    employees.length +
    "　/　内容 " +
    content.length +
    '</span></div><section class="admin-section"><div class="section-heading"><div><h3>登记员工</h3><p>账号、姓名及 QQ 信息会写入服务器</p></div></div><form class="admin-form employee-create" id="employeeCreate"><input name="username" required maxlength="40" placeholder="员工登录账号"><input name="password" type="password" required minlength="12" placeholder="初始密码（至少 12 位）"><input name="displayName" required maxlength="80" placeholder="员工姓名"><input name="qqNumber" maxlength="30" placeholder="QQ 号（可暂空）"><input name="department" maxlength="80" placeholder="部门（可暂空）"><input name="initialBalance" type="number" min="0" step="1" placeholder="初始余额（可填 0）"><button class="small-action">保存员工资料</button></form></section><section class="admin-section"><div class="section-heading"><div><h3>员工名册</h3><p>' +
    employees.length +
    ' 位员工　·　编辑后立即保存</p></div></div><div class="table-wrap"><table><thead><tr><th>员工</th><th>QQ 号</th><th>部门</th><th>余额</th><th>权限</th><th>状态</th><th>编辑资料</th></tr></thead><tbody>' +
    employees
      .map(
        (e) =>
          "<tr><td>" +
          esc(e.displayName) +
          "<small>" +
          esc(e.username) +
          "</small></td><td>" +
          esc(e.qqNumber || "未登记") +
          "</td><td>" +
          esc(e.department || "未填写") +
          "</td><td>" +
          Number(e.balance).toLocaleString() +
          "</td><td>" +
          (e.role === "admin" ? "管理员" : "员工") +
          "</td><td>" +
          (e.enabled ? "启用" : "停用") +
          '</td><td><details><summary>编辑</summary><form class="employee-edit-form" data-employee-id="' +
          e.id +
          '"><input name="displayName" required maxlength="80" value="' +
          esc(e.displayName) +
          '" placeholder="员工姓名"><input name="qqNumber" maxlength="30" value="' +
          esc(e.qqNumber || "") +
          '" placeholder="QQ 号"><input name="department" maxlength="80" value="' +
          esc(e.department || "") +
          '" placeholder="部门"><input name="password" type="password" minlength="12" placeholder="新密码（不改请留空）"><label><input name="enabled" type="checkbox" ' +
          (e.enabled ? "checked" : "") +
          '> 账号启用</label><button class="small-action">保存修改</button></form></details></td></tr>',
      )
      .join("") +
    '</tbody></table></div></section><section class="admin-section"><div class="section-heading"><div><h3>发帖记录与帖子管理</h3><p>显示完整内容；删除前会再次确认</p></div></div><div class="admin-post-list">' +
    (content
      .map((item) => {
        const label =
          item.itemType === "comment"
            ? "公告留言"
            : item.itemType === "thread"
              ? "论坛主题"
              : "论坛回复";
        const context =
          item.itemType === "reply"
            ? "所在主题：" + (item.parentTitle || item.title)
            : item.itemType === "comment"
              ? "所属公告：" + item.title
              : "独立论坛主题";
        return (
          '<article class="admin-post"><div class="admin-post-head"><div><b>' +
          esc(label) +
          "</b><small>" +
          esc(item.anonymousName || "匿名员工") +
          "　·　" +
          esc(item.createdAt || "") +
          "　·　" +
          (item.status === "hidden" ? "已隐藏" : "展示中") +
          '</small></div><button class="small-action danger" data-delete-type="' +
          esc(item.itemType) +
          '" data-delete-id="' +
          item.id +
          '" data-delete-label="' +
          esc(label + "：" + (item.title || "")) +
          '">删除</button></div><small class="admin-post-context">' +
          esc(context) +
          "</small><p>" +
          esc(item.body || "") +
          "</p></article>"
        );
      })
      .join("") || '<p class="muted">暂无发帖记录。</p>') +
    "</div></section>";
  bindAdminForm("#employeeCreate", "/api/admin/employees", (v) => ({
    username: v.get("username"),
    password: v.get("password"),
    displayName: v.get("displayName"),
    qqNumber: v.get("qqNumber"),
    department: v.get("department"),
    initialBalance: Number(v.get("initialBalance") || 0),
  }));
  document.querySelectorAll(".employee-edit-form").forEach((form) =>
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const v = new FormData(form);
      const payload = {
        displayName: v.get("displayName"),
        qqNumber: v.get("qqNumber"),
        department: v.get("department"),
        enabled: v.get("enabled") === "on",
      };
      if (v.get("password")) payload.password = v.get("password");
      try {
        await api("/api/admin/employees/" + form.dataset.employeeId, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        await renderAdmin();
      } catch (error) {
        alert(error.message);
      }
    }),
  );
  document.querySelectorAll("[data-delete-type]").forEach((button) =>
    button.addEventListener("click", () => {
      const type = button.dataset.deleteType,
        id = button.dataset.deleteId;
      const path =
        type === "comment"
          ? "/api/admin/posts/" + id
          : type === "thread"
            ? "/api/admin/forum/threads/" + id
            : "/api/admin/forum/replies/" + id;
      deleteContent(path, button.dataset.deleteLabel || "这条帖子");
    }),
  );
}

// 绑定后台表单提交：统一做禁用按钮、请求、刷新和错误提示
function bindAdminForm(selector, path, map, custom) {
  const form = $(selector);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const values = new FormData(form);
      if (custom) await custom(map(values), form);
      else
        await api(path, { method: "POST", body: JSON.stringify(map(values)) });
      await renderAdmin();
    } catch (e) {
      alert(e.message);
    } finally {
      button.disabled = false;
    }
  });
}

// 删除前统一二次确认，删除后刷新管理台
async function deleteContent(path, label = "这条内容") {
  if (!confirm("确认永久删除" + label + "？此操作无法撤销。")) return;
  try {
    await api(path, { method: "DELETE" });
    await renderAdmin();
  } catch (e) {
    alert(e.message);
  }
}

// ===== Tab 路由分发 =====
async function renderTab(tab) {
  setActive(tab);
  try {
    if (tab === "files") await renderDossiers();
    else if (tab === "notice") await renderAnnouncements();
    else if (tab === "admin") await renderAdmin();
    else if (tab === "profile") await renderProfile();
    else if (tab === "forum") await renderForum();
    else await renderGames();
  } catch (e) {
    showError(e.message);
  }
}
document
  .querySelectorAll(".tab")
  .forEach((x) => x.addEventListener("click", () => renderTab(x.dataset.tab)));
$("#sidebarToggle").addEventListener("click", () => {
  const collapsed = $("#sidebar").classList.toggle("collapsed");
  $("#sidebarToggle").textContent = collapsed ? "展开" : "收起";
});

// ===== 音乐播放控制 =====
async function loadMusic() {
  try {
    const { items } = await api("/api/music");
    musicItems = items;
    musicIndex = -1;
    musicAudio.volume = Number($("#musicVolume").value);
    if (items.length) {
      $("#musicTitle").textContent = items[0].title;
      musicIndex = 0;
      musicAudio.src = items[0].url;
    } else $("#musicTitle").textContent = "管理员尚未添加曲目";
  } catch {}
}
const musicAudio = $("#musicAudio");
function selectMusic(index, autoplay = false) {
  if (!musicItems.length) return;
  musicIndex = (index + musicItems.length) % musicItems.length;
  musicAudio.src = musicItems[musicIndex].url;
  $("#musicTitle").textContent = musicItems[musicIndex].title;
  if (autoplay) musicAudio.play().catch(() => {});
}
$("#musicPrev").addEventListener("click", () =>
  selectMusic(musicIndex - 1, true),
);
$("#musicNext").addEventListener("click", () =>
  selectMusic(musicIndex + 1, true),
);
$("#musicPlay").addEventListener("click", () => {
  if (musicAudio.paused) {
    if (musicIndex < 0) selectMusic(0);
    musicAudio
      .play()
      .catch(() => alert("此音频暂时无法播放，请管理员检查链接。"));
  } else musicAudio.pause();
});
musicAudio.addEventListener("ended", () => selectMusic(musicIndex + 1, true));
musicAudio.addEventListener("play", () => ($("#musicPlay").textContent = "Ⅱ"));
musicAudio.addEventListener("pause", () => ($("#musicPlay").textContent = "▶"));
$("#musicVolume").addEventListener(
  "input",
  (e) => (musicAudio.volume = Number(e.target.value)),
);

// 首次进入时：若已有会话则直接加载门户
fetch("/api/me")
  .then((r) => (r.ok ? loadPortal() : null))
  .catch(() => {});

// 启动后先探测一次，再每 5 秒更新一次网络灯
setNetworkSignalStatus("checking");
probeServerStatus();
setInterval(probeServerStatus, 5000);
