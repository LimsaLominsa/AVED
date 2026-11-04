import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = resolve(root, 'public');
const dataDir = resolve(process.env.DATA_DIR || root);
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'wanyehui.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  qq_number TEXT UNIQUE,
  department TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee','admin')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dossiers (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '可查阅',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  announcement_id INTEGER REFERENCES announcements(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  anonymous_name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS balance_ledger (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profiles (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  anonymous_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS forum_threads (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  anonymous_name TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS forum_replies (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  anonymous_name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS checkins (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  checkin_date TEXT NOT NULL,
  reward INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(employee_id, checkin_date)
);
CREATE TABLE IF NOT EXISTS game_tickets (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  cost INTEGER NOT NULL,
  prize INTEGER NOT NULL,
  seed TEXT NOT NULL,
  seed_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS music_tracks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'lofi',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
const employeeColumns = new Set(db.prepare('PRAGMA table_info(employees)').all().map(column => column.name));
if (!employeeColumns.has('qq_number')) db.exec('ALTER TABLE employees ADD COLUMN qq_number TEXT');
if (!employeeColumns.has('created_at')) db.exec("ALTER TABLE employees ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS employees_qq_number_unique ON employees(qq_number)');
for (const [table,column] of [['forum_threads','status'],['forum_replies','status']]) {
  const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(item=>item.name));
  if(!columns.has(column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT 'published'`);
}

const hashPassword = password => {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
};
const verifyPassword = (password, stored) => {
  try {
    const [salt, saved] = stored.split(':');
    const candidate = pbkdf2Sync(password, salt, 310000, 32, 'sha256');
    const expected = Buffer.from(saved, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch { return false; }
};

const employeeCount = db.prepare('SELECT COUNT(*) AS n FROM employees').get().n;
if (employeeCount === 0 && process.env.NODE_ENV !== 'production') {
  db.prepare('INSERT INTO employees (username,password_hash,display_name,department,role) VALUES (?,?,?,?,?)')
    .run('employee', hashPassword('WanYe2026!'), '林序', '档案管理部', 'admin');
}
if (process.env.NODE_ENV !== 'production') db.prepare("UPDATE employees SET role='admin' WHERE username='employee'").run();
if (employeeCount === 0 && process.env.NODE_ENV === 'production' && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
  db.prepare('INSERT INTO employees (username,password_hash,display_name,department,role) VALUES (?,?,?,?,?)')
    .run(process.env.BOOTSTRAP_ADMIN_USERNAME, hashPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD), process.env.BOOTSTRAP_ADMIN_NAME || '系统管理员', '管理部', 'admin');
}
if (db.prepare('SELECT COUNT(*) AS n FROM dossiers').get().n === 0) {
  const add = db.prepare('INSERT INTO dossiers (code,title,department,status,summary) VALUES (?,?,?,?,?)');
  add.run('WY-001', '咖啡机', '设施维护部', '观察中', '需要混脸熟，不然会很难喝。');
  add.run('WY-002', '一个电话', '档案管理部', '待补充', '档案内容由管理人员录入。');
}
if (db.prepare('SELECT COUNT(*) AS n FROM announcements').get().n === 0) {
  db.prepare('INSERT INTO announcements (title,body,pinned) VALUES (?,?,1)')
    .run('员工终端已启用', '这里发布的公告会保存在服务器数据库中。员工可以在公告下方匿名留言。');
}
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
db.prepare("INSERT OR IGNORE INTO profiles(employee_id,anonymous_name) SELECT id,'匿名员工-'||id FROM employees").run();

const prod = process.env.NODE_ENV === 'production';
if (prod && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  console.error('生产环境必须设置至少 32 个字符的 SESSION_SECRET。');
  process.exit(1);
}
const secret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const sessionDigest = token => createHmac('sha256',secret).update(token).digest('hex');
const sessionsTtl = 8 * 60 * 60 * 1000;
const attempts = new Map();
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };
const readBody = (req, maxBytes=32768) => new Promise((resolveBody, reject) => {
  const chunks = []; let size = 0;
  req.on('data', chunk => { size += chunk.length; if (size > maxBytes) { reject(new Error('too large')); req.destroy(); } else chunks.push(chunk); });
  req.on('end', () => { try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
  req.on('error', reject);
});
const send = (res, status, body, headers={}) => {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers });
  res.end(JSON.stringify(body));
};
const cookieToken = req => req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('wy_session='))?.slice(11);
const sessionEmployee = req => {
  const token = cookieToken(req);
  if (!token) return null;
  const tokenHash = sessionDigest(token);
  const session = db.prepare(`SELECT e.id,e.username,e.display_name AS displayName,e.department,e.role,e.enabled,s.expires_at
    FROM sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token_hash=?`).get(tokenHash);
  if (!session || session.expires_at < Date.now() || !session.enabled) {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash); return null;
  }
  db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now() + sessionsTtl, tokenHash);
  return session;
};
const requireEmployee = (req, res) => {
  const employee = sessionEmployee(req);
  if (!employee) send(res, 401, { error:'请先登录。' });
  return employee;
};
const requireAdmin = (req, res) => {
  const employee = requireEmployee(req, res);
  if (employee && employee.role !== 'admin') { send(res, 403, { error:'只有管理员可以执行此操作。' }); return null; }
  return employee;
};
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const balanceFor = employeeId => db.prepare('SELECT COALESCE(SUM(delta),0) AS balance FROM balance_ledger WHERE employee_id=?').get(employeeId).balance;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai' }).format(new Date());
const secureRoll = (seedHex, range) => {
  const seed = Buffer.from(seedHex, 'hex');
  const limit = Math.floor(0x100000000 / range) * range;
  for (let counter=0; counter<64; counter++) {
    const bytes=createHmac('sha256',seed).update(String(counter)).digest();
    for (let offset=0; offset+4<=bytes.length; offset+=4) {
      const n=bytes.readUInt32BE(offset);
      if (n<limit) return n%range;
    }
  }
  throw new Error('random generation failed');
};
const publicProfile = employeeId => {
  const profile=db.prepare('SELECT anonymous_name AS anonymousName,bio,avatar_url AS avatarUrl FROM profiles WHERE employee_id=?').get(employeeId) || {};
  return { anonymousName:profile.anonymousName||'',bio:profile.bio||'',avatarUrl:profile.avatarUrl||'' };
};
const recordLedger = (employeeId, delta, reason) => db.prepare('INSERT INTO balance_ledger (employee_id,delta,reason) VALUES (?,?,?)').run(employeeId,delta,reason);
const adminMutation = (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) { send(res, 403, { error:'请求来源校验失败。' }); return false; } }
    catch { send(res, 403, { error:'请求来源校验失败。' }); return false; }
  }
  return true;
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const now = Date.now(), ip = req.socket.remoteAddress || 'unknown';
      const attempt = attempts.get(ip) || { count:0, until:now + 10 * 60 * 1000 };
      if (attempt.until < now) { attempt.count = 0; attempt.until = now + 10 * 60 * 1000; }
      if (attempt.count >= 10) return send(res, 429, { error:'尝试次数过多，请稍后再试。' });
      const { username, password } = await readBody(req);
      const employee = typeof username === 'string' ? db.prepare('SELECT id,password_hash,enabled FROM employees WHERE username=?').get(username.trim()) : null;
      const valid = employee && typeof password === 'string' && password.length <= 200 && verifyPassword(password, employee.password_hash) && employee.enabled === 1;
      if (!valid) { attempt.count++; attempts.set(ip, attempt); return send(res, 401, { error:'账号或密码不正确，或该员工账号尚未启用。' }); }
      attempts.delete(ip);
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions (token_hash,employee_id,expires_at) VALUES (?,?,?)')
        .run(sessionDigest(token), employee.id, now + sessionsTtl);
      const cookie = `wy_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
      return send(res, 200, { ok:true }, { 'Set-Cookie':cookie });
    }
    if (url.pathname.startsWith('/api/') && ['POST','PUT','PATCH','DELETE'].includes(req.method) && !adminMutation(req,res)) return;
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = cookieToken(req);
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sessionDigest(token));
      return send(res, 200, { ok:true }, { 'Set-Cookie':`wy_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }
    if (url.pathname === '/api/me' && req.method === 'GET') {
      const employee = requireEmployee(req,res); if (!employee) return;
      return send(res, 200, { employee:{ id:employee.id, username:employee.username, displayName:employee.displayName, department:employee.department, role:employee.role }, balance:balanceFor(employee.id) });
    }
    if (url.pathname === '/api/profile' && req.method === 'GET') {
      const employee=requireEmployee(req,res); if(!employee)return;
      const topPrize=db.prepare('SELECT COALESCE(MAX(prize),0) AS value FROM game_tickets WHERE employee_id=?').get(employee.id).value;
      const balance=balanceFor(employee.id);
      const achievements=[
        {id:'zero',title:'归零记录',earned:balance===0},
        {id:'100k',title:'资产突破 10 万',earned:balance>100000},
        {id:'1m',title:'资产突破 100 万',earned:balance>1000000},
        {id:'jackpot',title:'超级大奖',earned:topPrize>=500000}
      ];
      return send(res,200,{profile:publicProfile(employee.id),achievements});
    }
    if (url.pathname === '/api/profile' && req.method === 'PUT') {
      const employee=requireEmployee(req,res); if(!employee)return;
      const {anonymousName,bio,avatarUrl}=await readBody(req,2500000);
      if(typeof anonymousName!=='string'||anonymousName.trim().length<1||anonymousName.trim().length>32||typeof bio!=='string'||bio.length>500) return send(res,400,{error:'请填写匿名名称（最多 32 字），简介最多 500 字。'});
      let avatar='';
      if(typeof avatarUrl==='string'&&avatarUrl.trim()) {
        if(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatarUrl)&&avatarUrl.length<=2200000) avatar=avatarUrl;
        else { try { const parsed=new URL(avatarUrl); if(parsed.protocol!=='https:'||parsed.href.length>1000) throw new Error(); avatar=parsed.href; } catch { return send(res,400,{error:'头像请使用 PNG/JPG/WEBP 图片，或填写有效的 HTTPS 图片链接。'}); } }
      }
      db.prepare(`INSERT INTO profiles(employee_id,anonymous_name,bio,avatar_url,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(employee_id) DO UPDATE SET anonymous_name=excluded.anonymous_name,bio=excluded.bio,avatar_url=excluded.avatar_url,updated_at=CURRENT_TIMESTAMP`)
        .run(employee.id,anonymousName.trim(),bio.trim(),avatar);
      return send(res,200,{profile:publicProfile(employee.id)});
    }
    if (url.pathname === '/api/checkin' && req.method === 'POST') {
      const employee=requireEmployee(req,res); if(!employee)return;
      const date=today(), reward=150;
      db.exec('BEGIN IMMEDIATE');
      try {
        if(db.prepare('SELECT employee_id FROM checkins WHERE employee_id=? AND checkin_date=?').get(employee.id,date)){db.exec('ROLLBACK');return send(res,409,{error:'今天已经签到。'});}
        db.prepare('INSERT INTO checkins(employee_id,checkin_date,reward) VALUES(?,?,?)').run(employee.id,date,reward);
        recordLedger(employee.id,reward,'每日签到');db.exec('COMMIT');
      } catch(error){db.exec('ROLLBACK');throw error;}
      return send(res,200,{reward,balance:balanceFor(employee.id)});
    }
    if (url.pathname === '/api/checkin' && req.method === 'GET') {
      const employee=requireEmployee(req,res);if(!employee)return;
      const date=today(); const row=db.prepare('SELECT reward FROM checkins WHERE employee_id=? AND checkin_date=?').get(employee.id,date);
      return send(res,200,{checkedIn:!!row,reward:row?.reward||0});
    }
    if (url.pathname === '/api/games/scratch' && req.method === 'POST') {
      const employee=requireEmployee(req,res);if(!employee)return;
      const cost=1000; if(balanceFor(employee.id)<cost)return send(res,400,{error:'余额不足，无法购买刮刮乐。'});
      const seed=randomBytes(32).toString('hex'), seedHash=createHash('sha256').update(seed).digest('hex');
      const roll=secureRoll(seed,100000); let prize=0,prizeName='未中奖';
      if(roll===0){prize=500000;prizeName='超级大奖';} else if(roll<10){prize=50000;prizeName='特等奖';} else if(roll<100){prize=5000;prizeName='大奖';} else if(roll<15100){prize=1000;prizeName='中奖';}
      db.exec('BEGIN IMMEDIATE');
      try { if(balanceFor(employee.id)<cost){db.exec('ROLLBACK');return send(res,400,{error:'余额不足，无法购买刮刮乐。'});}
        recordLedger(employee.id,-cost,'刮刮乐购券');if(prize)recordLedger(employee.id,prize,'刮刮乐奖金');
        const result={prizeName};const row=db.prepare('INSERT INTO game_tickets(employee_id,game,cost,prize,seed,seed_hash,result_json) VALUES(?,?,?,?,?,?,?)').run(employee.id,'scratch',cost,prize,seed,seedHash,JSON.stringify(result));db.exec('COMMIT');
        return send(res,200,{ticketId:Number(row.lastInsertRowid),cost,prize,prizeName,balance:balanceFor(employee.id),seed,seedHash,roll});
      } catch(error){db.exec('ROLLBACK');throw error;}
    }
    if (url.pathname === '/api/games/slot' && req.method === 'POST') {
      const employee=requireEmployee(req,res);if(!employee)return;
      const cost=500;if(balanceFor(employee.id)<cost)return send(res,400,{error:'余额不足，无法启动老虎机。'});
      const seed=randomBytes(32).toString('hex'),seedHash=createHash('sha256').update(seed).digest('hex');
      const symbols=['◆','●','▲','✚','★']; const rolls=[secureRoll(seed,5),secureRoll(createHash('sha256').update(seed+'b').digest('hex'),5),secureRoll(createHash('sha256').update(seed+'c').digest('hex'),5)];
      const result=rolls.map(n=>symbols[n]);let multiplier=0;
      if(result.every(x=>x===result[0]))multiplier=result[0]==='★'?100:20;else if(new Set(result).size===2)multiplier=2;
      const prize=cost*multiplier;
      db.exec('BEGIN IMMEDIATE');
      try{if(balanceFor(employee.id)<cost){db.exec('ROLLBACK');return send(res,400,{error:'余额不足，无法启动老虎机。'});}
        recordLedger(employee.id,-cost,'老虎机');if(prize)recordLedger(employee.id,prize,'老虎机奖金');
        const row=db.prepare('INSERT INTO game_tickets(employee_id,game,cost,prize,seed,seed_hash,result_json) VALUES(?,?,?,?,?,?,?)').run(employee.id,'slot',cost,prize,seed,seedHash,JSON.stringify({symbols:result,multiplier}));db.exec('COMMIT');
        return send(res,200,{ticketId:Number(row.lastInsertRowid),cost,prize,multiplier,symbols:result,balance:balanceFor(employee.id),seed,seedHash});
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    if (url.pathname === '/api/games/history' && req.method === 'GET') {
      const employee=requireEmployee(req,res);if(!employee)return;
      return send(res,200,{items:db.prepare(`SELECT id,game,cost,prize,seed_hash AS seedHash,result_json AS result,created_at AS createdAt FROM game_tickets WHERE employee_id=? ORDER BY id DESC LIMIT 30`).all(employee.id)});
    }
    if (url.pathname === '/api/forum' && req.method === 'GET') {
      if(!requireEmployee(req,res))return;
      const items=db.prepare(`SELECT f.id,f.title,f.body,f.created_at AS createdAt,p.anonymous_name AS anonymousName,
        (SELECT COALESCE(SUM(delta),0) FROM balance_ledger l WHERE l.employee_id=f.employee_id) AS balance,
        (SELECT COUNT(*) FROM forum_replies r WHERE r.thread_id=f.id AND r.status='published') AS replyCount
        FROM forum_threads f JOIN profiles p ON p.employee_id=f.employee_id WHERE f.status='published' ORDER BY f.id DESC LIMIT 100`).all();
      return send(res,200,{items});
    }
    if (url.pathname === '/api/forum' && req.method === 'POST') {
      const employee=requireEmployee(req,res);if(!employee)return;
      const {title,body}=await readBody(req),profile=publicProfile(employee.id);
      if(!validText(title,120)||!validText(body,3000))return send(res,400,{error:'标题最多 120 字，内容最多 3000 字。'});
      if(!profile.anonymousName)return send(res,400,{error:'请先在个人主页设置匿名名称。'});
      const row=db.prepare('INSERT INTO forum_threads(employee_id,anonymous_name,title,body) VALUES(?,?,?,?)').run(employee.id,profile.anonymousName,title.trim(),body.trim());
      return send(res,201,{id:Number(row.lastInsertRowid)});
    }
    if (url.pathname.startsWith('/api/forum/') && url.pathname.endsWith('/replies') && req.method === 'GET') {
      if(!requireEmployee(req,res))return;const id=Number(url.pathname.split('/')[3]);
      return send(res,200,{items:db.prepare(`SELECT r.id,r.anonymous_name AS anonymousName,r.body,r.created_at AS createdAt,
        (SELECT COALESCE(SUM(delta),0) FROM balance_ledger l WHERE l.employee_id=r.employee_id) AS balance FROM forum_replies r WHERE r.thread_id=? AND r.status='published' ORDER BY r.id`).all(id)});
    }
    if (url.pathname.startsWith('/api/forum/') && url.pathname.endsWith('/replies') && req.method === 'POST') {
      const employee=requireEmployee(req,res);if(!employee)return;const id=Number(url.pathname.split('/')[3]);const {body}=await readBody(req),profile=publicProfile(employee.id);
      if(!db.prepare('SELECT id FROM forum_threads WHERE id=?').get(id))return send(res,404,{error:'帖子不存在。'});
      if(!validText(body,2000)||!profile.anonymousName)return send(res,400,{error:'请设置匿名名称，回复最多 2000 字。'});
      const row=db.prepare('INSERT INTO forum_replies(thread_id,employee_id,anonymous_name,body) VALUES(?,?,?,?)').run(id,employee.id,profile.anonymousName,body.trim());return send(res,201,{id:Number(row.lastInsertRowid)});
    }
    if (url.pathname === '/api/music' && req.method === 'GET') {
      if(!requireEmployee(req,res))return;
      return send(res,200,{items:db.prepare("SELECT id,title,url,kind FROM music_tracks WHERE enabled=1 ORDER BY id").all()});
    }
    if (url.pathname === '/api/admin/music' && req.method === 'GET') {
      if(!requireAdmin(req,res))return;
      return send(res,200,{items:db.prepare('SELECT id,title,url,kind FROM music_tracks ORDER BY id').all()});
    }
    if (url.pathname === '/api/admin/forum' && req.method === 'GET') {
      if(!requireAdmin(req,res))return;
      const items=db.prepare(`SELECT 'thread' AS itemType,f.id,f.title,f.body,f.anonymous_name AS anonymousName,f.status,f.created_at AS createdAt,NULL AS parentTitle
        FROM forum_threads f UNION ALL SELECT 'reply',r.id,t.title,r.body,r.anonymous_name,r.status,r.created_at,t.title
        FROM forum_replies r JOIN forum_threads t ON t.id=r.thread_id ORDER BY createdAt DESC`).all();
      return send(res,200,{items});
    }
    if (url.pathname === '/api/admin/posts' && req.method === 'GET') {
      if(!requireAdmin(req,res))return;
      const items=db.prepare(`SELECT p.id,'comment' AS itemType,a.title,p.body,p.anonymous_name AS anonymousName,p.status,p.created_at AS createdAt
        FROM posts p JOIN announcements a ON a.id=p.announcement_id ORDER BY p.id DESC`).all();
      return send(res,200,{items});
    }
    if (url.pathname.startsWith('/api/admin/forum/threads/') && req.method === 'DELETE') {
      if(!requireAdmin(req,res))return;const result=db.prepare('DELETE FROM forum_threads WHERE id=?').run(Number(url.pathname.split('/').at(-1)));if(!result.changes)return send(res,404,{error:'帖子不存在。'});return send(res,200,{ok:true});
    }
    if (url.pathname.startsWith('/api/admin/forum/replies/') && req.method === 'DELETE') {
      if(!requireAdmin(req,res))return;const result=db.prepare('DELETE FROM forum_replies WHERE id=?').run(Number(url.pathname.split('/').at(-1)));if(!result.changes)return send(res,404,{error:'回复不存在。'});return send(res,200,{ok:true});
    }
    if (url.pathname === '/api/admin/music' && req.method === 'POST') {
      const admin=requireAdmin(req,res);if(!admin)return;const {title,url:trackUrl,kind}=await readBody(req);
      if(!validText(title,100)||!validText(trackUrl,1000))return send(res,400,{error:'请填写音乐名称和音频链接。'});
      try{const parsed=new URL(trackUrl);if(!['https:'].includes(parsed.protocol))return send(res,400,{error:'音乐链接必须使用 HTTPS。'});}catch{return send(res,400,{error:'音乐链接格式无效。'});}
      const row=db.prepare('INSERT INTO music_tracks(title,url,kind,created_by) VALUES(?,?,?,?)').run(title.trim(),trackUrl.trim(),String(kind||'lofi').slice(0,30),admin.id);return send(res,201,{id:Number(row.lastInsertRowid)});
    }
    if (url.pathname.startsWith('/api/admin/music/') && req.method === 'DELETE') {
      if(!requireAdmin(req,res))return;db.prepare('DELETE FROM music_tracks WHERE id=?').run(Number(url.pathname.split('/').at(-1)));return send(res,200,{ok:true});
    }
    if (url.pathname === '/api/dossiers' && req.method === 'GET') {
      if (!requireEmployee(req,res)) return;
      return send(res, 200, { items:db.prepare('SELECT id,code,title,department,status,summary FROM dossiers ORDER BY id DESC').all() });
    }
    if (url.pathname === '/api/announcements' && req.method === 'GET') {
      if (!requireEmployee(req,res)) return;
      return send(res, 200, { items:db.prepare(`SELECT a.id,a.title,a.body,a.pinned,a.created_at AS createdAt,
        (SELECT COUNT(*) FROM posts p WHERE p.announcement_id=a.id AND p.status='published') AS postCount
        FROM announcements a ORDER BY a.pinned DESC,a.id DESC`).all() });
    }
    if (url.pathname === '/api/posts' && req.method === 'GET') {
      if (!requireEmployee(req,res)) return;
      const announcementId = Number(url.searchParams.get('announcementId'));
      if (!Number.isInteger(announcementId) || announcementId < 1) return send(res,400,{error:'公告编号无效。'});
      return send(res,200,{items:db.prepare(`SELECT p.id,p.anonymous_name AS anonymousName,p.body,p.created_at AS createdAt,
        (SELECT COALESCE(SUM(delta),0) FROM balance_ledger l WHERE l.employee_id=p.employee_id) AS balance
        FROM posts p WHERE p.announcement_id=? AND p.status='published' ORDER BY p.id DESC`).all(announcementId)});
    }
    if (url.pathname === '/api/posts' && req.method === 'POST') {
      const employee = requireEmployee(req,res); if (!employee) return;
      const { announcementId, anonymousName, body } = await readBody(req);
      const announcement = Number(announcementId);
      if (!Number.isInteger(announcement) || !db.prepare('SELECT id FROM announcements WHERE id=?').get(announcement)) return send(res,400,{error:'请选择有效公告。'});
      if (!validText(anonymousName,32) || !validText(body,2000)) return send(res,400,{error:'匿名名称最多 32 字，留言最多 2000 字。'});
      const result = db.prepare('INSERT INTO posts (announcement_id,employee_id,anonymous_name,body) VALUES (?,?,?,?)').run(announcement,employee.id,anonymousName.trim(),body.trim());
      return send(res,201,{id:Number(result.lastInsertRowid)});
    }
    if (url.pathname === '/api/admin/employees' && req.method === 'GET') {
      if (!requireAdmin(req,res)) return;
      return send(res,200,{items:db.prepare(`SELECT e.id,e.username,e.display_name AS displayName,e.qq_number AS qqNumber,e.department,e.role,e.enabled,
        COALESCE((SELECT SUM(delta) FROM balance_ledger l WHERE l.employee_id=e.id),0) AS balance FROM employees e ORDER BY e.id`).all()});
    }
    if (url.pathname === '/api/admin/employees' && req.method === 'POST') {
      const admin = requireAdmin(req,res); if (!admin) return;
      const { username,password,displayName,qqNumber,department,role,initialBalance } = await readBody(req);
      if (!validText(username,40) || !validText(password,200) || password.length < 12 || !validText(displayName,80)) return send(res,400,{error:'请填写账号、姓名，并设置至少 12 位密码。'});
      if(initialBalance!==undefined&&(!Number.isSafeInteger(initialBalance)||initialBalance<0||initialBalance>100000000))return send(res,400,{error:'初始余额必须是 0 到 100,000,000 之间的整数。'});
      try {
        const result = db.prepare('INSERT INTO employees (username,password_hash,display_name,qq_number,department,role) VALUES (?,?,?,?,?,?)')
          .run(username.trim(),hashPassword(password),displayName.trim(),validText(qqNumber,30)?qqNumber.trim():null,typeof department==='string'?department.trim().slice(0,80):'',role==='admin'?'admin':'employee');
        const id=Number(result.lastInsertRowid);db.prepare('INSERT INTO profiles(employee_id,anonymous_name) VALUES(?,?)').run(id,`匿名员工-${id}`);
        if(initialBalance>0)db.prepare('INSERT INTO balance_ledger(employee_id,delta,reason,created_by) VALUES(?,?,?,?)').run(id,initialBalance,'员工初始余额',admin.id);
        return send(res,201,{id});
      } catch { return send(res,409,{error:'账号或 QQ 号已存在，请检查后重试。'}); }
    }
    if (url.pathname.startsWith('/api/admin/employees/') && !url.pathname.endsWith('/balance') && req.method === 'PUT') {
      if(!requireAdmin(req,res))return;
      const employeeId=Number(url.pathname.split('/').at(-1));
      const {displayName,qqNumber,department,enabled,password}=await readBody(req);
      if(!Number.isInteger(employeeId)||!validText(displayName,80)||typeof department!=='string'||department.length>80||typeof enabled!=='boolean')return send(res,400,{error:'员工姓名、部门或启用状态无效。'});
      const qq=qqNumber==null||qqNumber===''?null:(validText(qqNumber,30)?qqNumber.trim():undefined);
      if(qq===undefined)return send(res,400,{error:'QQ 号最多 30 个字符。'});
      if(password!==undefined&&password!==''&&(typeof password!=='string'||password.length<12||password.length>200))return send(res,400,{error:'新密码至少 12 位，最多 200 位；不修改密码请留空。'});
      try{
        const result=db.prepare('UPDATE employees SET display_name=?,qq_number=?,department=?,enabled=? WHERE id=?').run(displayName.trim(),qq,department.trim(),enabled?1:0,employeeId);
        if(!result.changes)return send(res,404,{error:'员工账号不存在。'});
        if(typeof password==='string'&&password)db.prepare('UPDATE employees SET password_hash=? WHERE id=?').run(hashPassword(password),employeeId);
        return send(res,200,{ok:true});
      }catch{return send(res,409,{error:'QQ 号已被其他员工使用，请检查后重试。'});}
    }
    if (url.pathname.startsWith('/api/admin/employees/') && url.pathname.endsWith('/balance') && req.method === 'POST') {
      const admin = requireAdmin(req,res); if (!admin) return;
      const employeeId = Number(url.pathname.split('/')[4]);
      const { delta,reason } = await readBody(req);
      const employee = db.prepare('SELECT id FROM employees WHERE id=?').get(employeeId);
      if (!employee || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 100000000 || !validText(reason,200)) return send(res,400,{error:'余额变动信息无效。'});
      db.exec('BEGIN IMMEDIATE');
      try {
        if (balanceFor(employeeId) + delta < 0) { db.exec('ROLLBACK'); return send(res,400,{error:'余额不能低于零。'}); }
        db.prepare('INSERT INTO balance_ledger (employee_id,delta,reason,created_by) VALUES (?,?,?,?)').run(employeeId,delta,reason.trim(),admin.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return send(res,200,{balance:balanceFor(employeeId)});
    }
    if (url.pathname === '/api/admin/dossiers' && req.method === 'POST') {
      const admin = requireAdmin(req,res); if (!admin) return;
      const { code,title,department,status,summary } = await readBody(req);
      if (!validText(code,30)||!validText(title,100)||!validText(summary,2000)) return send(res,400,{error:'请填写档案编号、名称和内容。'});
      try { const result=db.prepare('INSERT INTO dossiers (code,title,department,status,summary) VALUES (?,?,?,?,?)').run(code.trim(),title.trim(),String(department||'').slice(0,80),String(status||'可查阅').slice(0,40),summary.trim()); return send(res,201,{id:Number(result.lastInsertRowid)}); }
      catch { return send(res,409,{error:'档案编号已存在。'}); }
    }
    if (url.pathname.startsWith('/api/admin/dossiers/') && req.method === 'DELETE') {
      if (!requireAdmin(req,res)) return;
      db.prepare('DELETE FROM dossiers WHERE id=?').run(Number(url.pathname.split('/').at(-1)));
      return send(res,200,{ok:true});
    }
    if (url.pathname === '/api/admin/announcements' && req.method === 'POST') {
      const admin = requireAdmin(req,res); if (!admin) return;
      const { title,body,pinned } = await readBody(req);
      if (!validText(title,150)||!validText(body,5000)) return send(res,400,{error:'公告标题最多 150 字，正文最多 5000 字。'});
      const result=db.prepare('INSERT INTO announcements (title,body,pinned,created_by) VALUES (?,?,?,?)').run(title.trim(),body.trim(),pinned?1:0,admin.id);
      return send(res,201,{id:Number(result.lastInsertRowid)});
    }
    if (url.pathname.startsWith('/api/admin/announcements/') && req.method === 'DELETE') {
      if (!requireAdmin(req,res)) return;
      db.prepare('DELETE FROM announcements WHERE id=?').run(Number(url.pathname.split('/').at(-1)));
      return send(res,200,{ok:true});
    }
    if (url.pathname.startsWith('/api/admin/posts/') && req.method === 'DELETE') {
      if (!requireAdmin(req,res)) return;
      const result=db.prepare('DELETE FROM posts WHERE id=?').run(Number(url.pathname.split('/').at(-1)));
      if(!result.changes)return send(res,404,{error:'帖子不存在。'});
      return send(res,200,{ok:true});
    }
    if (url.pathname.startsWith('/api/')) return send(res,404,{error:'未找到此接口。'});
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (file.includes('..') || file.includes('\\')) return send(res,404,{error:'not found'});
    try {
      const data = await readFile(resolve(publicDir,file));
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  } catch (error) {
    if (!res.headersSent) send(res,error.message==='too large'?413:400,{error:error.message==='too large'?'提交内容过大。':'请求暂时无法处理。'});
    else res.destroy();
    if (error.message !== 'bad json' && error.message !== 'too large') console.error('Request error:',error);
  }
});

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
server.listen(port,host,() => console.log(`万业携生收容公司服务已启动：${host}:${port}`));
