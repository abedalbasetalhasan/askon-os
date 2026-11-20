/* AskON OS — application logic (Supabase) */
(() => {
'use strict';

/* ---------- anti-clickjacking ---------- */
if (window.top !== window.self) { try { window.top.location = window.location.href; } catch (e) { document.documentElement.remove(); } }

/* ---------- config ---------- */
const CFG = window.ASKON_CONFIG || {};
const SUPABASE_URL = CFG.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY || '';
const BUCKET = 'attachments';
const MAX_FILE = 10 * 1024 * 1024;          // 10MB لكل ملف
const MAX_PER_TASK = 20;
const IDLE_MS = 30 * 60 * 1000;             // خروج تلقائي بعد 30 دقيقة خمول
const MAX_RICH = 20000;

const UNITS = {
  strategy:{name:'الاستشارات الاستراتيجية',cls:'unit-strategy',icon:'briefcase'},
  creative:{name:'الإنتاج الإعلامي والإبداعي',cls:'unit-creative',icon:'video'},
  operations:{name:'إدارة المشاريع والعمليات',cls:'unit-operations',icon:'activity'},
  events:{name:'تنظيم الفعاليات والتجارب',cls:'unit-events',icon:'sparkles'},
  language:{name:'الخدمات اللغوية والتواصل',cls:'unit-language',icon:'languages'}
};
const PRI = {urgent:'عاجل جدًا',high:'مرتفع',medium:'متوسط',low:'عادي'};
const STATUS = {backlog:'جديدة',in_progress:'قيد التنفيذ',review:'مراجعة الجودة',completed:'مكتملة'};
const NOTE_COLORS = ['note-purple','note-fuchsia','note-gold'];
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const VIEW_TITLES = {board:'لوحة كانبان',table:'جدول المهام',calendar:'التقويم والتسليمات',notes:'ملاحظات وأفكار',team:'الفريق والوحدات'};
const TEMPLATES = {
  'SOP-002':{title:'جلسة اكتشاف احتياجات العميل (Discovery)',desc:'<ul><li>تحديد المشكلة الجوهرية للعميل</li><li>تحليل الفئة المستهدفة</li><li>صياغة المخرجات المتوقعة في وثيقة</li></ul>'},
  'SOP-003':{title:'إعداد العرض الفني والمالي',desc:'<ul><li>إدراج نطاق العمل</li><li>التسعير التفصيلي</li><li>الجدول الزمني</li><li>مراجعة مدير الحسابات</li></ul>'},
  'MP-005':{title:'تجهيز قائمة اللقطات وأمر العمل',desc:'<ul><li>اعتماد مواقع التصوير</li><li>تراخيص الكوادر</li><li>قائمة المعدات والتجهيزات التقنية</li></ul>'}
};
/* امتداد → نوع MIME معتمد (يطابق قائمة السيرفر) */
const FILE_TYPES = {
  jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',pdf:'application/pdf',
  doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:'text/plain',csv:'text/csv',zip:'application/zip',mp4:'video/mp4',mov:'video/quicktime',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav'
};
const DANGEROUS = /\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|ps1|sh|php|jar|html?|svg|xml|dll|lnk|apk)(\.|$)/i;

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const byId = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const safeId = v => String(v ?? '').replace(/[^\w-]/g,'').slice(0,64);
const pad = n => String(n).padStart(2,'0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
let TODAY = isoDate(new Date());
const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('ar',{day:'numeric',month:'short'}) : '';
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b/1024) + ' KB' : (b/1048576).toFixed(1) + ' MB';
const initial = n => String(n || '?').trim().charAt(0) || '?';
const avIdx = s => [...String(s||'')].reduce((a,c) => a + c.charCodeAt(0), 0) % 6;
const avatar = (name, id) => `<span class="av av-${avIdx(id||name)}">${esc(initial(name))}</span>`;
let iconRaf = 0;
const icons = () => { if (iconRaf) return; iconRaf = requestAnimationFrame(() => { iconRaf = 0; if (window.lucide) window.lucide.createIcons(); }); };
const store = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
};

function toast(msg, type) {
  const c = byId('toasts'), t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : ''); t.textContent = msg; c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 320); }, 3800);
}

/* ==========================================================================
   تنظيف HTML (قائمة بيضاء صارمة) — يمنع XSS في النصوص المنسّقة
   ========================================================================== */
const PALETTE = ['#be123c','#c2410c','#0f764f','#1d4ed8','#7c3aed','#6b7280'];
const OK_CLASSES = new Set(['fs-sm','fs-lg','fs-xl','ta-left','ta-center','ta-right','ta-justify','tc-1','tc-2','tc-3','tc-4','tc-5','tc-6']);
const TAGS = {P:'p',DIV:'div',BR:'br',B:'strong',STRONG:'strong',I:'em',EM:'em',U:'u',S:'s',STRIKE:'s',DEL:'s',H1:'h2',H2:'h2',H3:'h3',H4:'h3',UL:'ul',OL:'ol',LI:'li',BLOCKQUOTE:'blockquote',A:'a',SPAN:'span',FONT:'span'};
const DROP = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','TEMPLATE','NOSCRIPT','LINK','META','FORM','INPUT','BUTTON','TEXTAREA','SELECT','IMG','VIDEO','AUDIO','CANVAS','HEAD','TITLE']);
const hexOf = c => {
  c = String(c || '').trim().toLowerCase();
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join(''); return '#' + h; }
  m = c.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/);
  return m ? '#' + [m[1],m[2],m[3]].map(n => Math.min(255, +n).toString(16).padStart(2,'0')).join('') : '';
};
function classesFor(el) {
  const cls = new Set();
  (el.getAttribute('class') || '').split(/\s+/).forEach(c => { if (OK_CLASSES.has(c)) cls.add(c); });
  const st = el.style || {};
  const ta = String(st.textAlign || el.getAttribute('align') || '').toLowerCase();
  if (['left','center','right','justify'].includes(ta)) cls.add('ta-' + ta);
  const ci = PALETTE.indexOf(hexOf(st.color || el.getAttribute('color')));
  if (ci >= 0) cls.add('tc-' + (ci + 1));
  const sz = parseInt(el.getAttribute('size') || '', 10), fs = String(st.fontSize || '').toLowerCase();
  if (el.tagName === 'FONT' && sz) { if (sz <= 2) cls.add('fs-sm'); else if (sz >= 6) cls.add('fs-xl'); else if (sz >= 4) cls.add('fs-lg'); }
  else if (fs) {
    if (['xx-small','x-small','small'].includes(fs)) cls.add('fs-sm');
    else if (['large','x-large'].includes(fs)) cls.add('fs-lg');
    else if (['xx-large','xxx-large'].includes(fs)) cls.add('fs-xl');
  }
  return [...cls];
}
function cleanInto(src, dst, doc, depth) {
  if (depth > 30) return;
  for (const ch of src.childNodes) {
    if (ch.nodeType === 3) { dst.appendChild(doc.createTextNode(ch.nodeValue)); continue; }
    if (ch.nodeType !== 1) continue;
    const t = ch.tagName.toUpperCase();
    if (DROP.has(t)) continue;
    const mapped = TAGS[t];
    if (!mapped) { cleanInto(ch, dst, doc, depth + 1); continue; }
    if (mapped === 'a') {
      let u = null; try { u = new URL(ch.getAttribute('href') || ''); } catch (e) {}
      if (!u || !['http:','https:','mailto:'].includes(u.protocol)) { cleanInto(ch, dst, doc, depth + 1); continue; }
      const a = doc.createElement('a'); a.setAttribute('href', u.href); a.setAttribute('target','_blank'); a.setAttribute('rel','noopener noreferrer');
      cleanInto(ch, a, doc, depth + 1); dst.appendChild(a); continue;
    }
    const classes = classesFor(ch);
    if (mapped === 'span' && !classes.length) { cleanInto(ch, dst, doc, depth + 1); continue; }
    const el = doc.createElement(mapped);
    if (classes.length) el.className = classes.join(' ');
    if (mapped !== 'br') cleanInto(ch, el, doc, depth + 1);
    dst.appendChild(el);
  }
}
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html || '').slice(0, 60000), 'text/html');
  const root = doc.createElement('div');
  cleanInto(doc.body, root, doc, 0);
  return root.innerHTML;
}
const looksHtml = v => /<\/?(p|div|br|b|strong|i|em|u|s|h[1-6]|ul|ol|li|blockquote|a|span|font)\b/i.test(v);
const toHtml = v => { v = String(v || ''); return looksHtml(v) ? sanitizeHtml(v) : esc(v).replace(/\n/g,'<br>'); };
const htmlText = h => (new DOMParser().parseFromString('<body>' + String(h).replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, ' $&'), 'text/html').body.textContent || '').replace(/\s+/g,' ').trim();

/* ==========================================================================
   محرر النصوص المنسّقة (أدوات الحجم والخط والألوان والمحاذاة …)
   ========================================================================== */
const RB = (r, icon, title) => `<button type="button" class="rte-btn" data-r="${r}" title="${title}" aria-label="${title}"><i data-lucide="${icon}"></i></button>`;
const DIRECT = {bold:'bold',italic:'italic',underline:'underline',strike:'strikeThrough',ul:'insertUnorderedList',ol:'insertOrderedList',left:'justifyLeft',center:'justifyCenter',right:'justifyRight',undo:'undo',redo:'redo',clear:'removeFormat'};

function buildEditor(host, placeholder) {
  host.innerHTML = `<div class="rte"><div class="rte-bar" role="toolbar" aria-label="أدوات تنسيق النص">
    <select class="rte-sel" data-r="size" aria-label="حجم الخط"><option value="">حجم الخط</option><option value="2">صغير</option><option value="3">عادي</option><option value="5">كبير</option><option value="6">كبير جداً</option></select>
    <select class="rte-sel" data-r="block" aria-label="نمط الفقرة"><option value="">النمط</option><option value="p">فقرة عادية</option><option value="h2">عنوان كبير</option><option value="h3">عنوان فرعي</option></select>
    <span class="rte-sep"></span>${RB('bold','bold','غامق (Ctrl+B)')}${RB('italic','italic','مائل (Ctrl+I)')}${RB('underline','underline','تسطير (Ctrl+U)')}${RB('strike','strikethrough','يتوسطه خط')}
    <span class="rte-sep"></span>
    <span class="rte-color">${RB('colorToggle','palette','لون النص')}<span class="rte-pop" hidden>
      <button type="button" class="sw sw-0" data-r="color" data-v="" aria-label="اللون الافتراضي"></button>${PALETTE.map((c,i) => `<button type="button" class="sw sw-${i+1}" data-r="color" data-v="${c}" aria-label="لون ${i+1}"></button>`).join('')}</span></span>
    <span class="rte-sep"></span>${RB('ul','list','قائمة نقطية')}${RB('ol','list-ordered','قائمة مرقّمة')}${RB('quote','quote','اقتباس')}
    <span class="rte-sep"></span>${RB('right','align-right','محاذاة لليمين')}${RB('center','align-center','توسيط')}${RB('left','align-left','محاذاة لليسار')}
    <span class="rte-sep"></span>${RB('link','link','إدراج رابط')}${RB('clear','remove-formatting','مسح التنسيق')}${RB('undo','undo-2','تراجع')}${RB('redo','redo-2','إعادة')}
  </div><div class="rte-area empty" contenteditable="true" role="textbox" aria-multiline="true" dir="rtl" data-placeholder="${esc(placeholder || 'اكتب هنا…')}"></div></div>`;
  const area = $('.rte-area', host), pop = $('.rte-pop', host);
  let saved = null;
  const saveSel = () => { const s = getSelection(); if (s.rangeCount && area.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); };
  const restore = () => { if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved); } };
  const syncEmpty = () => area.classList.toggle('empty', !area.textContent.trim() && !area.querySelector('ul,ol,blockquote'));
  const state = () => {
    const s = getSelection(); if (!s.rangeCount || !area.contains(s.anchorNode)) return;
    $$('.rte-btn', host).forEach(b => { const c = DIRECT[b.dataset.r]; if (c && /bold|italic|underline|strikeThrough|insertUnorderedList|insertOrderedList/.test(c)) { let on = false; try { on = document.queryCommandState(c); } catch(e){} b.classList.toggle('on', on); } });
  };
  function exec(cmd, val) {
    if (cmd === 'colorToggle') { pop.hidden = !pop.hidden; return; }
    area.focus(); restore();
    const ex = (c, v) => document.execCommand(c, false, v);
    if (DIRECT[cmd]) ex(DIRECT[cmd]);
    else if (cmd === 'size') ex('fontSize', val);
    else if (cmd === 'block') ex('formatBlock', '<' + val + '>');
    else if (cmd === 'quote') ex('formatBlock', '<blockquote>');
    else if (cmd === 'color') { ex('foreColor', val || '#010101'); pop.hidden = true; }
    else if (cmd === 'link') {
      const u = prompt('أدخل الرابط (يبدأ بـ https://)', 'https://'); if (!u) return;
      let url; try { url = new URL(u.trim()); } catch (e) { toast('رابط غير صالح', 'err'); return; }
      if (!['http:','https:','mailto:'].includes(url.protocol)) { toast('نوع الرابط غير مسموح', 'err'); return; }
      if (getSelection().toString()) ex('createLink', url.href); else ex('insertHTML', `<a href="${esc(url.href)}">${esc(url.href)}</a>`);
    }
    area.dispatchEvent(new Event('input', {bubbles:true})); saveSel(); state();
  }
  host.addEventListener('mousedown', e => { if (e.target.closest('.rte-btn,.sw')) e.preventDefault(); });
  host.addEventListener('click', e => { const b = e.target.closest('button[data-r]'); if (b) exec(b.dataset.r, b.dataset.v); });
  host.addEventListener('change', e => { const s = e.target.closest('select[data-r]'); if (!s) return; if (s.value) exec(s.dataset.r, s.value); s.value = ''; });
  ['keyup','mouseup','focus'].forEach(ev => area.addEventListener(ev, () => { saveSel(); state(); }));
  area.addEventListener('input', syncEmpty);
  area.addEventListener('paste', e => {
    e.preventDefault();
    const cd = e.clipboardData, html = cd.getData('text/html'), text = cd.getData('text/plain');
    document.execCommand('insertHTML', false, html ? sanitizeHtml(html) : esc(text).replace(/\n/g, '<br>'));
  });
  area.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) e.preventDefault(); });
  document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('.rte-color')) pop.hidden = true; });
  return {
    el: area,
    getHTML: () => sanitizeHtml(area.innerHTML),
    setHTML: h => { area.innerHTML = toHtml(h); syncEmpty(); },
    isEmpty: () => !area.textContent.trim(),
    focus: () => area.focus()
  };
}

/* ==========================================================================
   الحالة
   ========================================================================== */
const S = {
  team:[], tasks:[], notes:[], attachments:[], attOn:true,
  view:'board', me:null, filters:{search:'',unit:'ALL',assignee:'ALL',priority:'ALL'},
  cal:new Date(new Date().getFullYear(), new Date().getMonth(), 1), calDay:new Date().getDate(), dragId:null
};
const D = {id:null, dirty:false, pending:[], editor:null};
let NE = null;          // محرر الملاحظات
let sb = null, realtimeCh = null, reloadT = null, lastActive = Date.now(), failCount = 0, lockUntil = 0, confirmCb = null;
const urlCache = new Map();

const fromProfile = r => ({id:safeId(r.id), name:String(r.name||'بدون اسم').slice(0,80), role:String(r.role||'').slice(0,80), unit:UNITS[r.unit]?r.unit:'operations', isAdmin:r.is_admin===true});
const fromTask = r => {
  const description = String(r.description || '').slice(0, 60000);
  return {
    id:safeId(r.id), title:String(r.title||'بدون عنوان').slice(0,200), project:String(r.project||'').slice(0,120),
    unit:UNITS[r.unit]?r.unit:'operations', assigneeId:r.assignee_id?safeId(r.assignee_id):'',
    priority:PRI[r.priority]?r.priority:'medium', status:STATUS[r.status]?r.status:'backlog',
    dueDate:isDateStr(r.due_date)?String(r.due_date).slice(0,10):'', description, descText:htmlText(toHtml(description)).slice(0,300),
    sop:Array.isArray(r.sop_checklist)&&r.sop_checklist.length===4?r.sop_checklist.map(Boolean):[false,false,false,false]
  };
};
const fromNote = r => ({id:safeId(r.id), title:String(r.title||'بدون عنوان').slice(0,200), content:String(r.content||'').slice(0,60000), color:NOTE_COLORS.includes(r.color)?r.color:'note-purple', unit:UNITS[r.unit]?r.unit:'strategy'});
const fromAtt = r => ({id:safeId(r.id), taskId:safeId(r.task_id), name:String(r.name||'ملف').slice(0,160), path:String(r.path||''), size:+r.size||0, mime:String(r.mime||''), by:r.uploaded_by?safeId(r.uploaded_by):''});

const me = () => S.team.find(m => m.id === S.me);
const isAdmin = () => !!(me() && me().isAdmin);
const mem = id => S.team.find(m => m.id === id);
const isLate = t => t.status !== 'completed' && t.dueDate && t.dueDate < TODAY;
const isUrgentOrLate = t => t.status !== 'completed' && (t.priority === 'urgent' || (t.dueDate && t.dueDate <= TODAY));

/* ==========================================================================
   المصادقة
   ========================================================================== */
function setLoginError(m) { byId('loginError').textContent = m || ''; }
function showLogin(msg) {
  document.body.classList.add('auth-pending'); byId('loginOverlay').classList.add('show');
  setLoginError(msg); byId('loginBtn').disabled = false; byId('loginBtn').textContent = 'دخول';
}
function hideLogin() { document.body.classList.remove('auth-pending'); byId('loginOverlay').classList.remove('show'); }
function friendlyAuthError(m) {
  if (/invalid login credentials/i.test(m)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (/not confirmed/i.test(m)) return 'الحساب غير مؤكد. تواصل مع المدير';
  if (/rate limit|too many/i.test(m)) return 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة';
  return 'تعذّر تسجيل الدخول: ' + m;
}
async function doLogin(e) {
  e.preventDefault();
  const wait = Math.ceil((lockUntil - Date.now()) / 1000);
  if (wait > 0) return setLoginError(`تم إيقاف المحاولات مؤقتاً. أعد المحاولة بعد ${wait} ثانية`);
  const email = byId('loginEmail').value.trim(), password = byId('loginPassword').value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setLoginError('أدخل بريداً إلكترونياً صحيحاً');
  if (password.length < 6) return setLoginError('كلمة المرور قصيرة جداً');
  const btn = byId('loginBtn'); btn.disabled = true; btn.textContent = 'جارٍ الدخول…'; setLoginError('');
  const {data, error} = await sb.auth.signInWithPassword({email, password});
  if (error) {
    if (++failCount >= 5) { lockUntil = Date.now() + 60000; failCount = 0; }
    return showLogin(friendlyAuthError(error.message));
  }
  failCount = 0; byId('loginPassword').value = '';
  await startSession(data.user);
}
async function logout(msg) {
  if (realtimeCh) { try { await sb.removeChannel(realtimeCh); } catch(e){} realtimeCh = null; }
  try { await sb.auth.signOut(); } catch(e){}
  Object.assign(S, {team:[], tasks:[], notes:[], attachments:[], me:null});
  urlCache.clear(); closeDrawer(true); closeAllLayers();
  showLogin(typeof msg === 'string' ? msg : '');
}
async function startSession(user) {
  try {
    renderSkeleton(); hideLogin();
    let {data:prof, error} = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!prof) {
      const ins = await sb.from('profiles').insert({id:user.id, name:(user.email||'عضو').split('@')[0], role:'', unit:'operations', is_admin:false}).select().maybeSingle();
      if (ins.error || !ins.data) { await sb.auth.signOut(); return showLogin('حسابك غير مفعّل بعد. تواصل مع المدير.'); }
    }
    S.me = user.id;
    await loadAll();
    applyRole(); populateAssignees(); renderAll(); subscribeRealtime();
    lastActive = Date.now();
  } catch (err) {
    try { await sb.auth.signOut(); } catch(e){}
    showLogin('تعذّر تحميل البيانات: ' + (err.message || 'خطأ غير معروف'));
  }
}
function applyRole() {
  const m = me();
  document.body.classList.toggle('role-member', !(m && m.isAdmin));
  document.body.classList.toggle('role-admin', !!(m && m.isAdmin));
  if (m) { byId('meAvatar').outerHTML = `<span class="av av-${avIdx(m.id)}" id="meAvatar">${esc(initial(m.name))}</span>`; byId('meName').textContent = m.name; byId('meRole').textContent = m.isAdmin ? 'مدير نظام' : (m.role || 'عضو'); }
}

/* ==========================================================================
   البيانات
   ========================================================================== */
async function loadAll() {
  const [p, t, n] = await Promise.all([
    sb.from('profiles').select('*').order('name'),
    sb.from('tasks').select('*').order('created_at', {ascending:false}),
    sb.from('notes').select('*').order('created_at', {ascending:false})
  ]);
  const err = p.error || t.error || n.error; if (err) throw err;
  S.team = p.data.map(fromProfile); S.tasks = t.data.map(fromTask); S.notes = n.data.map(fromNote);
  try {
    const a = await sb.from('attachments').select('*').order('created_at', {ascending:false});
    if (a.error) throw a.error;
    S.attachments = a.data.map(fromAtt); S.attOn = true;
  } catch (e) { S.attachments = []; S.attOn = false; }
}
async function refresh() {
  try { await loadAll(); applyRole(); populateAssignees(); renderAll(); refreshDrawerExtras(); }
  catch (e) { toast('تعذّرت المزامنة مع السيرفر', 'err'); }
}
const scheduleRefresh = () => { clearTimeout(reloadT); reloadT = setTimeout(refresh, 500); };
function subscribeRealtime() {
  if (realtimeCh) return;
  try { realtimeCh = sb.channel('askon-sync').on('postgres_changes', {event:'*', schema:'public'}, scheduleRefresh).subscribe(); } catch (e) {}
}
/* تنفيذ كتابة مع كشف الرفض بسبب الصلاحيات (RLS) — يعيد الصفوف أو null */
async function run(q) {
  try {
    const {data, error} = await q.select();
    if (error) { toast('خطأ: ' + error.message, 'err'); return null; }
    if (!data || !data.length) { toast('العملية غير مسموحة لحسابك أو العنصر غير موجود', 'err'); return null; }
    return data;
  } catch (e) { toast('تعذّر الاتصال بالسيرفر', 'err'); return null; }
}

/* ==========================================================================
   العرض (Rendering)
   ========================================================================== */
const statusOptions = cur => Object.entries(STATUS).map(([k,v]) => `<option value="${k}" ${k===cur?'selected':''}>${v}</option>`).join('');
function filtered() {
  const f = S.filters, q = f.search.trim().toLowerCase();
  return S.tasks.filter(t =>
    (!q || (t.title + ' ' + t.project + ' ' + t.descText).toLowerCase().includes(q)) &&
    (f.unit === 'ALL' || t.unit === f.unit) && (f.assignee === 'ALL' || t.assigneeId === f.assignee) && (f.priority === 'ALL' || t.priority === f.priority));
}
function dueChip(t) {
  if (!t.dueDate) return '';
  const c = t.status === 'completed' ? 'done' : t.dueDate < TODAY ? 'late' : t.dueDate === TODAY ? 'today' : '';
  return `<span class="due ${c}"><i data-lucide="calendar"></i>${esc(fmtDate(t.dueDate))}</span>`;
}
function renderSkeleton() {
  ['backlog','in_progress','review','completed'].forEach(s => { byId('col-' + s).innerHTML = '<div class="skel"></div><div class="skel"></div>'; });
}
function populateAssignees() {
  const opts = S.team.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  const f = byId('filterAssignee'), cur = f.value;
  f.innerHTML = '<option value="ALL">كل الأعضاء</option>' + opts; f.value = S.team.some(m => m.id === cur) ? cur : 'ALL';
  const d = byId('dwAssignee'), cd = d.value;
  d.innerHTML = '<option value="">غير محدد</option>' + opts; d.value = S.team.some(m => m.id === cd) ? cd : '';
}
function renderAll() {
  renderKpis(); renderNotifs(); renderSidebar(); renderFilterBar(); renderBoard(); renderTable(); renderCalendar(); renderNotes(); renderTeam(); icons();
}
function renderKpis() {
  const set = (id, v) => { byId(id).textContent = v; };
  set('kpiTotalTasks', S.tasks.length); set('kpiInProgressTasks', S.tasks.filter(t => t.status === 'in_progress').length);
  set('kpiReviewTasks', S.tasks.filter(t => t.status === 'review').length); set('kpiUrgentTasks', S.tasks.filter(isUrgentOrLate).length);
  set('kpiTeamCount', S.team.length); set('badgeKanban', S.tasks.length); set('badgeNotes', S.notes.length);
}
function renderNotifs() {
  const list = S.tasks.filter(isUrgentOrLate);
  byId('notifBadge').textContent = list.length; byId('notifBadge').hidden = !list.length;
  byId('notifList').innerHTML = list.length ? list.map(t => `<button class="notif-item" data-action="goTask" data-id="${esc(t.id)}"><i data-lucide="${isLate(t) ? 'alert-triangle' : 'clock'}"></i><span><b class="${isLate(t) ? 'c-err' : ''}">${isLate(t) ? 'متأخرة' : 'عاجلة'}:</b> ${esc(t.title)}</span></button>`).join('')
    : '<div class="empty">لا توجد مهام عاجلة 🎉</div>';
}
function renderSidebar() {
  byId('sbUnits').innerHTML = Object.entries(UNITS).map(([k,u]) =>
    `<button class="unit-item ${S.filters.unit === k ? 'active' : ''}" data-action="unit" data-unit="${k}"><i data-lucide="${u.icon}"></i><span>${esc(u.name)}</span><em>${S.tasks.filter(t => t.unit === k).length}</em></button>`).join('');
}
function renderFilterBar() {
  const chip = byId('unitChip'), u = S.filters.unit;
  chip.hidden = u === 'ALL'; if (u !== 'ALL') { chip.textContent = UNITS[u].name; chip.dataset.unit = u; }
}
function cardHtml(t) {
  const a = mem(t.assigneeId), n = S.attachments.filter(x => x.taskId === t.id).length, sd = t.sop.filter(Boolean).length;
  return `<article class="task-card fx pri-${t.priority}" draggable="true" tabindex="0" data-action="openTask" data-id="${esc(t.id)}" aria-label="${esc(t.title)}">
    <div class="tc-top"><span class="pill ${UNITS[t.unit].cls}">${esc(UNITS[t.unit].name)}</span><span class="pbadge pb-${t.priority}">${PRI[t.priority]}</span></div>
    <div class="tc-title">${esc(t.title)}</div>
    ${t.project ? `<div class="tc-project"><i data-lucide="folder"></i>${esc(t.project)}</div>` : ''}
    ${t.descText ? `<div class="tc-desc">${esc(t.descText)}</div>` : ''}
    ${t.status === 'review' ? `<div class="sop-bar" title="${sd}/4"><i style="width:${sd * 25}%"></i></div>` : ''}
    <div class="tc-meta">${a ? avatar(a.name, a.id) : '<span class="av">؟</span>'}${dueChip(t)}<span class="grow"></span>${n ? `<span class="mi"><i data-lucide="paperclip"></i>${n}</span>` : ''}</div>
    <select class="input sm touch-move" data-stop data-change="moveStatus" data-id="${esc(t.id)}" aria-label="نقل المهمة">${statusOptions(t.status)}</select>
  </article>`;
}
function renderBoard() {
  const list = filtered();
  ['backlog','in_progress','review','completed'].forEach(s => {
    const items = list.filter(t => t.status === s);
    byId('count-' + s).textContent = items.length;
    byId('col-' + s).innerHTML = items.length ? items.map(cardHtml).join('') : '<div class="empty">لا توجد مهام هنا</div>';
  });
}
function renderTable() {
  const list = filtered(), tb = byId('tableBody');
  tb.innerHTML = list.length ? list.map(t => {
    const a = mem(t.assigneeId);
    return `<tr data-action="openTask" data-id="${esc(t.id)}" tabindex="0">
      <td data-label="المهمة"><div class="t-title">${esc(t.title)}</div>${t.project ? `<div class="t-sub">${esc(t.project)}</div>` : ''}</td>
      <td data-label="الوحدة"><span class="pill ${UNITS[t.unit].cls}">${esc(UNITS[t.unit].name)}</span></td>
      <td data-label="المسؤول">${a ? `<span class="who">${avatar(a.name, a.id)}${esc(a.name)}</span>` : '<span class="muted">غير محدد</span>'}</td>
      <td data-label="الأولوية"><span class="pbadge pb-${t.priority}">${PRI[t.priority]}</span></td>
      <td data-label="التسليم">${dueChip(t) || '—'}</td>
      <td data-label="الحالة"><select class="input sm" data-stop data-change="moveStatus" data-id="${esc(t.id)}" aria-label="الحالة">${statusOptions(t.status)}</select></td></tr>`;
  }).join('') : '<tr><td colspan="6"><div class="empty">لا توجد مهام مطابقة</div></td></tr>';
}
function renderCalendar() {
  const y = S.cal.getFullYear(), m = S.cal.getMonth(), dim = new Date(y, m + 1, 0).getDate();
  if (S.calDay > dim) S.calDay = dim;
  byId('calTitle').textContent = `${MONTHS[m]} ${y}`;
  let h = ''; for (let i = 0; i < new Date(y, m, 1).getDay(); i++) h += '<div class="cal-cell off" aria-hidden="true"></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`, ts = S.tasks.filter(t => t.dueDate === ds);
    h += `<button class="cal-cell ${ds === TODAY ? 'today' : ''} ${d === S.calDay ? 'sel' : ''}" data-action="selectDay" data-day="${d}" aria-label="${d} ${MONTHS[m]}">
      <span class="dn">${d}</span>${ts.slice(0,2).map(t => `<span class="cal-chip ${UNITS[t.unit].cls}">${esc(t.title)}</span>`).join('')}${ts.length > 2 ? `<span class="cal-more">+${ts.length - 2}</span>` : ''}
      <span class="dots">${ts.slice(0,4).map(t => `<i class="${UNITS[t.unit].cls}"></i>`).join('')}</span></button>`;
  }
  byId('calGrid').innerHTML = h;
  const ds = `${y}-${pad(m + 1)}-${pad(S.calDay)}`, ts = S.tasks.filter(t => t.dueDate === ds);
  byId('dayTitle').textContent = `مهام ${S.calDay} ${MONTHS[m]}`;
  byId('dayList').innerHTML = ts.length ? ts.map(t => `<button class="day-item" data-action="openTask" data-id="${esc(t.id)}"><b>${esc(t.title)}</b><span>${STATUS[t.status]}${t.project ? ' • ' + esc(t.project) : ''}</span></button>`).join('') : '<div class="empty">لا توجد تسليمات في هذا اليوم</div>';
}
function renderNotes() {
  byId('notesGrid').innerHTML = S.notes.length ? S.notes.map(n => `<article class="note-card fx ${n.color}" tabindex="0" data-action="editNote" data-id="${esc(n.id)}">
    <div class="note-head"><h3>${esc(n.title)}</h3><div class="note-actions">
      <button class="icon-btn" data-action="convertNote" data-id="${esc(n.id)}" title="تحويل لمهمة" aria-label="تحويل لمهمة"><i data-lucide="arrow-up-right"></i></button>
      <button class="icon-btn admin-only" data-action="deleteNote" data-id="${esc(n.id)}" title="حذف" aria-label="حذف الملاحظة"><i data-lucide="trash-2"></i></button></div></div>
    <div class="rich note-body">${toHtml(n.content)}</div>
    <div><span class="pill ${UNITS[n.unit].cls}">${esc(UNITS[n.unit].name)}</span></div></article>`).join('') : '<div class="empty">لا توجد ملاحظات بعد. ابدأ بتدوين فكرة جديدة.</div>';
}
function renderTeam() {
  byId('unitList').innerHTML = Object.entries(UNITS).map(([k,u]) => `<div class="unit-row"><div class="kpi-ic ${u.cls}" style="background:var(--cbg);color:var(--c)"><i data-lucide="${u.icon}"></i></div><span>${esc(u.name)}</span><b>${S.tasks.filter(t => t.unit === k).length} مهام</b></div>`).join('');
  byId('teamGrid').innerHTML = S.team.map(m => {
    const act = S.tasks.filter(t => t.assigneeId === m.id && t.status !== 'completed').length, pct = Math.min(Math.round(act / 10 * 100), 100);
    const col = pct > 85 ? 'var(--err)' : pct > 60 ? 'var(--warn)' : 'var(--pos)', id = esc(m.id);
    return `<div class="member-card fx"><div class="mc-top">${avatar(m.name, m.id)}<div><div class="mc-name">${esc(m.name)}${m.isAdmin ? '<span class="tag-admin">مدير</span>' : ''}</div><div class="t-sub">${esc(m.role || UNITS[m.unit].name)}</div></div>
      <div class="mc-actions admin-only"><button class="icon-btn" data-action="editMember" data-id="${id}" aria-label="تعديل العضو"><i data-lucide="edit-3"></i></button><button class="icon-btn" data-action="deleteMember" data-id="${id}" aria-label="حذف العضو"><i data-lucide="trash-2"></i></button></div></div>
      <div><div class="bar-meta"><span>ضغط العمل (${act} مهام)</span><span>${pct}%</span></div><div class="bar"><i style="width:${pct}%;background:${col}"></i></div></div></div>`;
  }).join('');
}

/* ==========================================================================
   التنقل والطبقات
   ========================================================================== */
function setView(v) {
  S.view = v;
  $$('.view').forEach(x => { const on = x.id === 'view-' + v; x.classList.toggle('active', on); if (on) { x.classList.remove('enter'); void x.offsetWidth; x.classList.add('enter'); } });
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === v));
  byId('viewTitle').textContent = VIEW_TITLES[v];
  const tasksView = v === 'board' || v === 'table';
  byId('kpis').hidden = !tasksView; byId('tasksFilterBar').hidden = !tasksView;
  setSidebar(false); window.scrollTo({top:0, behavior:'smooth'}); icons();
}
function setSidebar(on) { document.body.classList.toggle('sb-open', !!on); }
const syncScroll = () => document.body.classList.toggle('no-scroll', drawerOpen() || !!$('.modal-overlay.open'));
function openModal(id) { byId(id).classList.add('open'); syncScroll(); icons(); }
function closeModal(id) { byId(id).classList.remove('open'); syncScroll(); }
function closeAllLayers() { $$('.modal-overlay.open').forEach(m => m.classList.remove('open')); setSidebar(false); byId('notifWrap').classList.remove('open'); syncScroll(); }
function confirmBox(title, msg, cb, ok) {
  byId('cfTitle').textContent = title; byId('cfMsg').textContent = msg; byId('cfOk').textContent = ok || 'تأكيد'; confirmCb = cb; openModal('confirmModal');
}
function applyFilters() {
  S.filters.search = byId('taskSearchInput').value; S.filters.assignee = byId('filterAssignee').value; S.filters.priority = byId('filterPriority').value;
  if (S.filters.search && !['board','table'].includes(S.view)) setView('board');
  renderBoard(); renderTable(); renderSidebar(); renderFilterBar(); icons();
}

/* ==========================================================================
   درج المهمة
   ========================================================================== */
const drawerOpen = () => byId('drawer').classList.contains('open');
function openDrawer(id, preset = {}) {
  const t = id ? S.tasks.find(x => x.id === id) : null; if (id && !t) return;
  if (!D.editor) D.editor = buildEditor(byId('dwEditor'), 'اكتب وصف المهمة ومخرجاتها… استخدم الأدوات أعلاه للتنسيق');
  D.id = t ? t.id : null; D.pending = [];
  byId('dwCrumb').textContent = t ? 'تعديل المهمة' : 'مهمة جديدة';
  byId('dwTitle').value = t ? t.title : '';
  byId('dwStatus').value = t ? t.status : (STATUS[preset.status] ? preset.status : 'in_progress');
  byId('dwPriority').value = t ? t.priority : 'medium';
  byId('dwAssignee').value = t ? t.assigneeId : (S.me || '');
  byId('dwUnit').value = t ? t.unit : (S.filters.unit !== 'ALL' ? S.filters.unit : 'strategy');
  byId('dwDue').value = t ? t.dueDate : TODAY;
  byId('dwProject').value = t ? t.project : '';
  byId('dwTemplate').value = ''; byId('dwTemplateWrap').hidden = !!t; byId('dwDelete').hidden = !t;
  D.editor.setHTML(t ? t.description : '');
  D.dirty = false; renderDrawerExtras();
  byId('drawer').classList.add('open'); byId('drawer').setAttribute('aria-hidden', 'false'); byId('drawerScrim').classList.add('show'); syncScroll(); icons();
  setTimeout(() => byId('dwTitle').focus({preventScroll:true}), 380);
}
function closeDrawer(force) {
  if (!drawerOpen()) return;
  if (!force && (D.dirty || D.pending.length)) { confirmBox('تجاهل التغييرات؟', 'لديك تغييرات غير محفوظة. هل تريد إغلاق النافذة بدونها؟', () => closeDrawer(true), 'تجاهل'); return; }
  byId('drawer').classList.remove('open'); byId('drawer').setAttribute('aria-hidden', 'true'); byId('drawerScrim').classList.remove('show');
  D.id = null; D.pending = []; D.dirty = false; syncScroll();
}
function refreshDrawerExtras() { if (drawerOpen()) renderDrawerExtras(); }
function attItem(a) {
  const isImg = /^image\//.test(a.mime), who = mem(a.by), canDel = isAdmin() || a.by === S.me;
  return `<div class="att"><div class="att-th">${isImg ? `<img data-path="${esc(a.path)}" alt="">` : '<i data-lucide="file-text"></i>'}</div>
    <div class="att-info"><b title="${esc(a.name)}">${esc(a.name)}</b><span>${fmtSize(a.size)}${who ? ' • ' + esc(who.name) : ''}</span></div>
    <button class="icon-btn" data-action="downloadAtt" data-id="${esc(a.id)}" aria-label="تنزيل" title="تنزيل"><i data-lucide="download"></i></button>
    ${canDel ? `<button class="icon-btn" data-action="deleteAtt" data-id="${esc(a.id)}" aria-label="حذف الملف" title="حذف"><i data-lucide="trash-2"></i></button>` : ''}</div>`;
}
function renderDrawerExtras() {
  const t = D.id ? S.tasks.find(x => x.id === D.id) : null;
  if (D.id && !t) { toast('تم حذف هذه المهمة من مستخدم آخر'); closeDrawer(true); return; }
  const admin = isAdmin(), labels = ['مراجعة ذاتية (المنفذ)', 'مراجعة فنية (نظير)', 'مراجعة نهائية (مدير)', 'جاهز للاعتماد'];
  byId('dwSop').innerHTML = t && t.status === 'review' ? `<h4><i data-lucide="shield"></i>قائمة مراجعة الجودة (SOP-007)</h4><div class="sop-list">${labels.map((l, i) => {
    const locked = i >= 2 && !admin;
    return `<button class="sop-item ${t.sop[i] ? 'on' : ''} ${locked ? 'locked' : ''}" data-action="toggleSop" data-index="${i}" ${locked ? 'disabled title="للمدير فقط"' : ''}><span class="sop-box"><i data-lucide="check"></i></span>${l}</button>`;
  }).join('')}</div>` : '';
  const list = D.id ? S.attachments.filter(a => a.taskId === D.id) : [];
  let h = `<h4><i data-lucide="paperclip"></i>الملفات المرفقة (${list.length + D.pending.length})</h4>`;
  if (!S.attOn) h += '<div class="notice">ميزة المرفقات غير مفعّلة بعد. شغّل ملف SQL الخاص بها من Supabase ثم حدّث الصفحة.</div>';
  else {
    h += '<button type="button" class="drop" data-action="pickFiles"><i data-lucide="upload"></i><b>اسحب الملفات هنا أو اضغط للاختيار</b><span>حتى 10 ميغا لكل ملف • صور، PDF، Office، ZIP، صوت وفيديو</span></button>';
    h += `<div class="att-list">${list.map(attItem).join('')}${D.pending.map((f, i) => `<div class="att"><div class="att-th"><i data-lucide="file-text"></i></div><div class="att-info"><b>${esc(f.name)}</b><span>${fmtSize(f.size)} • سيُرفع عند الحفظ</span></div><button class="icon-btn" data-action="removePending" data-i="${i}" aria-label="إزالة"><i data-lucide="x"></i></button></div>`).join('')}</div>`;
  }
  byId('dwAtt').innerHTML = h; icons(); loadThumbs();
}
async function loadThumbs() {
  const imgs = $$('#dwAtt img[data-path]'); if (!imgs.length) return;
  const need = [...new Set(imgs.map(i => i.dataset.path).filter(p => !(urlCache.get(p) && urlCache.get(p).exp > Date.now())))];
  if (need.length) { try { const {data} = await sb.storage.from(BUCKET).createSignedUrls(need, 300); (data || []).forEach(d => { if (d.signedUrl) urlCache.set(d.path, {url:d.signedUrl, exp:Date.now() + 280000}); }); } catch (e) {} }
  imgs.forEach(i => { const c = urlCache.get(i.dataset.path); if (c) i.src = c.url; });
}
async function saveTask() {
  const title = byId('dwTitle').value.trim();
  if (!title) { toast('الرجاء إدخال عنوان المهمة', 'err'); byId('dwTitle').focus(); return; }
  const html = D.editor.getHTML();
  if (html.length > MAX_RICH) { toast('الوصف طويل جداً، اختصره قليلاً', 'err'); return; }
  const row = {
    title: title.slice(0, 200), project: byId('dwProject').value.trim().slice(0, 120), unit: byId('dwUnit').value,
    assignee_id: byId('dwAssignee').value || null, priority: byId('dwPriority').value, status: byId('dwStatus').value,
    due_date: byId('dwDue').value || null, description: D.editor.isEmpty() ? '' : html
  };
  if (!UNITS[row.unit] || !PRI[row.priority] || !STATUS[row.status]) { toast('قيمة غير صالحة', 'err'); return; }
  const btn = byId('dwSave'); btn.disabled = true;
  let id = D.id, ok = false;
  if (id) ok = !!(await run(sb.from('tasks').update(row).eq('id', id)));
  else { row.sop_checklist = [false,false,false,false]; const d = await run(sb.from('tasks').insert(row)); ok = !!d; id = d && d[0].id; }
  if (ok && D.pending.length) { await uploadFiles(id, D.pending); D.pending = []; }
  btn.disabled = false;
  if (ok) { toast(D.id ? 'تم حفظ التعديلات' : 'تمت إضافة المهمة', 'ok'); closeDrawer(true); await refresh(); }
}
function deleteTask() {
  const id = D.id; if (!id) return;
  confirmBox('حذف المهمة', 'سيتم حذف المهمة وجميع ملفاتها نهائياً. هل أنت متأكد؟', async () => {
    const paths = S.attachments.filter(a => a.taskId === id).map(a => a.path);
    if (await run(sb.from('tasks').delete().eq('id', id))) {
      if (paths.length) { try { await sb.storage.from(BUCKET).remove(paths); } catch (e) {} }
      toast('تم حذف المهمة'); closeDrawer(true); await refresh();
    }
  }, 'حذف');
}
async function toggleSop(index) {
  const t = S.tasks.find(x => x.id === D.id); if (!t) return;
  if (index >= 2 && !isAdmin()) { toast('هذه الخطوة للمدير فقط', 'err'); return; }
  const list = [...t.sop]; list[index] = !list[index];
  const upd = {sop_checklist: list}; if (list.every(Boolean)) { upd.status = 'completed'; toast('اكتملت المراجعة! نُقلت المهمة إلى «مكتملة»', 'ok'); }
  if (await run(sb.from('tasks').update(upd).eq('id', t.id))) { await refresh(); if (upd.status) byId('dwStatus').value = 'completed'; }
}
async function moveStatus(id, status) {
  const t = S.tasks.find(x => x.id === id); if (!t || !STATUS[status] || t.status === status) { renderBoard(); renderTable(); return; }
  if (await run(sb.from('tasks').update({status}).eq('id', id))) toast('تم النقل إلى: ' + STATUS[status]);
  await refresh();
}
function applyTemplate() {
  const tp = TEMPLATES[byId('dwTemplate').value]; if (!tp) return;
  byId('dwTitle').value = tp.title; D.editor.setHTML(tp.desc); D.dirty = true;
}

/* ==========================================================================
   المرفقات (حد 10 ميغا للملف + فحص النوع والمحتوى)
   ========================================================================== */
const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
const safeName = n => String(n).replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(-120) || 'file';
async function sniff(file, ext) {
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const is = (...b) => b.every((v, i) => buf[i] === v), asc = (s, o = 0) => [...s].every((c, i) => buf[o + i] === c.charCodeAt(0));
  switch (ext) {
    case 'jpg': case 'jpeg': return is(0xFF,0xD8,0xFF);
    case 'png': return is(0x89,0x50,0x4E,0x47);
    case 'gif': return asc('GIF8');
    case 'webp': return asc('RIFF') && asc('WEBP', 8);
    case 'pdf': return asc('%PDF');
    case 'zip': case 'docx': case 'xlsx': case 'pptx': return is(0x50,0x4B);
    case 'doc': case 'xls': case 'ppt': return is(0xD0,0xCF,0x11,0xE0);
    case 'mp4': case 'mov': case 'm4a': return ['ftyp','moov','mdat','wide','free'].some(k => asc(k, 4));
    case 'mp3': return asc('ID3') || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0);
    case 'wav': return asc('RIFF') && asc('WAVE', 8);
    case 'txt': case 'csv': return !new Uint8Array(await file.slice(0, 2048).arrayBuffer()).includes(0);
  }
  return false;
}
async function validateFile(f) {
  if (!f.size) return 'الملف فارغ';
  if (f.size > MAX_FILE) return `الحجم ${fmtSize(f.size)} يتجاوز الحد المسموح (10 ميغا)`;
  if (DANGEROUS.test(f.name)) return 'نوع الملف غير مسموح';
  const ext = extOf(f.name); if (!FILE_TYPES[ext]) return 'صيغة الملف غير مدعومة';
  if (!(await sniff(f, ext))) return 'محتوى الملف لا يطابق امتداده';
  return '';
}
async function addFiles(fileList) {
  const files = [...fileList]; if (!files.length || !S.attOn) return;
  const have = (D.id ? S.attachments.filter(a => a.taskId === D.id).length : 0) + D.pending.length;
  if (have + files.length > MAX_PER_TASK) { toast(`الحد الأقصى ${MAX_PER_TASK} ملفاً لكل مهمة`, 'err'); return; }
  const good = [];
  for (const f of files) { const err = await validateFile(f); if (err) toast(`${f.name}: ${err}`, 'err'); else good.push(f); }
  if (!good.length) return;
  if (D.id) { toast('جارٍ رفع الملفات…'); await uploadFiles(D.id, good); await refresh(); }
  else { D.pending.push(...good); D.dirty = true; renderDrawerExtras(); }
}
async function uploadFiles(taskId, files) {
  let ok = 0;
  for (const f of files) {
    const ext = extOf(f.name), path = `${S.me}/${taskId}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, f, {contentType: FILE_TYPES[ext], upsert: false, cacheControl: '3600'});
    if (up.error) { toast(`تعذّر رفع ${f.name}: ${up.error.message}`, 'err'); continue; }
    const rows = await run(sb.from('attachments').insert({task_id: taskId, name: safeName(f.name), path, size: f.size, mime: FILE_TYPES[ext], uploaded_by: S.me}));
    if (!rows) { try { await sb.storage.from(BUCKET).remove([path]); } catch (e) {} continue; }
    ok++;
  }
  if (ok) toast(`تم رفع ${ok} ملف`, 'ok');
}
async function downloadAtt(id) {
  const a = S.attachments.find(x => x.id === id); if (!a) return;
  try {
    const {data, error} = await sb.storage.from(BUCKET).createSignedUrl(a.path, 60, {download: a.name});
    if (error || !data) throw error || new Error('x');
    const l = document.createElement('a'); l.href = data.signedUrl; l.rel = 'noopener'; document.body.appendChild(l); l.click(); l.remove();
  } catch (e) { toast('تعذّر تنزيل الملف', 'err'); }
}
function deleteAtt(id) {
  const a = S.attachments.find(x => x.id === id); if (!a) return;
  confirmBox('حذف الملف', `سيتم حذف «${a.name}» نهائياً.`, async () => {
    if (await run(sb.from('attachments').delete().eq('id', id))) { try { await sb.storage.from(BUCKET).remove([a.path]); } catch (e) {} toast('تم حذف الملف'); await refresh(); }
  }, 'حذف');
}

/* ==========================================================================
   الملاحظات والأعضاء
   ========================================================================== */
function openNote(id) {
  const n = id ? S.notes.find(x => x.id === id) : null; if (id && !n) return;
  if (!NE) NE = buildEditor(byId('nEditor'), 'اكتب فكرتك… يمكنك التنسيق بالأدوات أعلاه');
  byId('noteModalTitle').textContent = n ? 'تعديل الملاحظة' : 'ملاحظة جديدة';
  byId('nId').value = n ? n.id : ''; byId('nTitle').value = n ? n.title : ''; byId('nColor').value = n ? n.color : 'note-purple'; byId('nUnit').value = n ? n.unit : 'strategy';
  NE.setHTML(n ? n.content : ''); openModal('noteModal'); setTimeout(() => byId('nTitle').focus(), 250);
}
async function saveNote() {
  const title = byId('nTitle').value.trim(); if (!title) { toast('الرجاء إدخال عنوان الملاحظة', 'err'); return; }
  const html = NE.getHTML(); if (html.length > MAX_RICH) { toast('المحتوى طويل جداً', 'err'); return; }
  const row = {title: title.slice(0, 200), content: NE.isEmpty() ? '' : html, color: NOTE_COLORS.includes(byId('nColor').value) ? byId('nColor').value : 'note-purple', unit: UNITS[byId('nUnit').value] ? byId('nUnit').value : 'strategy'};
  const id = byId('nId').value;
  if (await run(id ? sb.from('notes').update(row).eq('id', id) : sb.from('notes').insert(row))) { closeModal('noteModal'); toast('تم حفظ الملاحظة', 'ok'); await refresh(); }
}
function convertNote(id) {
  const n = S.notes.find(x => x.id === id); if (!n) return;
  openDrawer(null, {}); byId('dwTitle').value = n.title; D.editor.setHTML(n.content); byId('dwUnit').value = n.unit; byId('dwStatus').value = 'backlog'; D.dirty = true;
  toast('تم نقل الفكرة إلى مهمة جديدة');
}
function openMember(id) {
  const m = mem(id); if (!m || !isAdmin()) return;
  byId('mId').value = m.id; byId('mName').value = m.name; byId('mRole').value = m.role; byId('mUnit').value = m.unit; byId('mAdmin').checked = m.isAdmin;
  openModal('memberModal'); setTimeout(() => byId('mName').focus(), 250);
}
async function saveMember() {
  const name = byId('mName').value.trim(); if (!name) { toast('الرجاء إدخال الاسم', 'err'); return; }
  const m = mem(byId('mId').value); if (!m) return;
  const adm = byId('mAdmin').checked;
  if (m.isAdmin && !adm && S.team.filter(x => x.isAdmin).length === 1) { toast('لا يمكن إزالة صلاحية آخر مدير', 'err'); return; }
  if (await run(sb.from('profiles').update({name: name.slice(0, 80), role: byId('mRole').value.trim().slice(0, 80), unit: UNITS[byId('mUnit').value] ? byId('mUnit').value : 'operations', is_admin: adm}).eq('id', m.id))) {
    closeModal('memberModal'); toast('تم تحديث بيانات العضو', 'ok'); await refresh();
  }
}
function deleteMember(id) {
  const m = mem(id); if (!m) return;
  if (id === S.me) { toast('لا يمكنك حذف حسابك أثناء استخدامه', 'err'); return; }
  if (m.isAdmin && S.team.filter(x => x.isAdmin).length === 1) { toast('لا يمكن حذف آخر مدير', 'err'); return; }
  confirmBox('حذف العضو', 'سيُحذف ملف العضو وتصبح مهامه «غير محددة». حسابه يبقى في Supabase Authentication.', async () => {
    if (await run(sb.from('profiles').delete().eq('id', id))) { toast('تم حذف العضو'); await refresh(); }
  }, 'حذف');
}
function exportData() {
  const blob = new Blob([JSON.stringify({exportedAt: new Date().toISOString(), team: S.team, tasks: S.tasks.map(({descText, ...t}) => t), notes: S.notes}, null, 2)], {type: 'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'askon_backup.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toast('تم تنزيل النسخة الاحتياطية', 'ok');
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'; store.set('askon_theme', dark ? 'dark' : 'light');
}

/* ==========================================================================
   الأحداث (بدون أي معالجات inline — متوافق مع CSP الصارم)
   ========================================================================== */
const A = {
  view: el => setView(el.dataset.view), openSidebar: () => setSidebar(true), closeSidebar: () => setSidebar(false),
  unit: el => { S.filters.unit = S.filters.unit === el.dataset.unit ? 'ALL' : el.dataset.unit; if (!['board','table'].includes(S.view)) setView('board'); applyFilters(); },
  newTask: el => openDrawer(null, {status: el.dataset.status}), openTask: el => openDrawer(el.dataset.id),
  goTask: el => { byId('notifWrap').classList.remove('open'); openDrawer(el.dataset.id); },
  closeDrawer: () => closeDrawer(), saveTask, deleteTask, toggleSop: el => toggleSop(+el.dataset.index),
  pickFiles: () => byId('fileInput').click(), removePending: el => { D.pending.splice(+el.dataset.i, 1); renderDrawerExtras(); },
  downloadAtt: el => downloadAtt(el.dataset.id), deleteAtt: el => deleteAtt(el.dataset.id),
  toggleNotif: () => byId('notifWrap').classList.toggle('open'),
  filterMine: () => { byId('filterAssignee').value = S.me; applyFilters(); toast('تم عرض مهامك فقط'); },
  resetFilters: () => { byId('taskSearchInput').value = ''; byId('filterAssignee').value = 'ALL'; byId('filterPriority').value = 'ALL'; S.filters.unit = 'ALL'; applyFilters(); },
  prevMonth: () => { S.cal = new Date(S.cal.getFullYear(), S.cal.getMonth() - 1, 1); renderCalendar(); },
  nextMonth: () => { S.cal = new Date(S.cal.getFullYear(), S.cal.getMonth() + 1, 1); renderCalendar(); },
  today: () => { const n = new Date(); S.cal = new Date(n.getFullYear(), n.getMonth(), 1); S.calDay = n.getDate(); renderCalendar(); },
  selectDay: el => { S.calDay = +el.dataset.day; renderCalendar(); icons(); },
  newNote: () => openNote(), editNote: el => openNote(el.dataset.id), saveNote, closeNote: () => closeModal('noteModal'),
  convertNote: el => convertNote(el.dataset.id),
  deleteNote: el => confirmBox('حذف الملاحظة', 'هل تريد حذف هذه الملاحظة نهائياً؟', async () => { if (await run(sb.from('notes').delete().eq('id', el.dataset.id))) { toast('تم الحذف'); await refresh(); } }, 'حذف'),
  editMember: el => openMember(el.dataset.id), saveMember, closeMember: () => closeModal('memberModal'), deleteMember: el => deleteMember(el.dataset.id),
  cfOk: () => { const f = confirmCb; confirmCb = null; closeModal('confirmModal'); if (f) f(); },
  cfCancel: () => { confirmCb = null; closeModal('confirmModal'); },
  logout: () => logout(), toggleTheme, exportData,
  togglePw: el => { const i = byId('loginPassword'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`; icons(); }
};
document.addEventListener('click', e => {
  if (!e.target.closest('#notifWrap')) byId('notifWrap').classList.remove('open');
  const el = e.target.closest('[data-action]'); if (!el) return;
  const stop = e.target.closest('[data-stop]'); if (stop && el.contains(stop) && el !== stop) return;
  const fn = A[el.dataset.action]; if (fn) { if (el.tagName === 'A') e.preventDefault(); fn(el, e); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]'); if (!el) return;
  const k = el.dataset.change;
  if (k === 'filters') applyFilters(); else if (k === 'moveStatus') moveStatus(el.dataset.id, el.value);
  else if (k === 'template') applyTemplate(); else if (k === 'files') { addFiles(el.files); el.value = ''; }
});
let searchT = 0;
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.input === 'search') { clearTimeout(searchT); searchT = setTimeout(applyFilters, 160); } });
byId('drawer').addEventListener('input', () => { D.dirty = true; });
byId('drawer').addEventListener('change', e => { if (!e.target.matches('[data-change]')) D.dirty = true; });
$$('[data-modal]').forEach(o => o.addEventListener('mousedown', e => { if (e.target === o && o.id !== 'confirmModal') closeModal(o.id); }));

/* سحب وإفلات المهام (كانبان) */
document.addEventListener('dragstart', e => { const c = e.target instanceof Element && e.target.closest('.task-card'); if (!c) return; S.dragId = c.dataset.id; e.dataTransfer.setData('text/plain', S.dragId); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
document.addEventListener('dragend', () => { S.dragId = null; $$('.dragging').forEach(x => x.classList.remove('dragging')); $$('.drag-over').forEach(x => x.classList.remove('drag-over')); });
document.addEventListener('dragover', e => {
  const t = e.target instanceof Element ? e.target : null; if (!t) return;
  const col = t.closest('.kanban-column'), zone = t.closest('.drop');
  if (col && S.dragId) { e.preventDefault(); col.classList.add('drag-over'); }
  else if (zone) { e.preventDefault(); zone.classList.add('over'); }
  else if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files') && !t.closest('.rte-area')) e.preventDefault();
});
document.addEventListener('dragleave', e => { const t = e.target instanceof Element ? e.target : null; if (!t) return; const col = t.closest('.kanban-column'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over'); const z = t.closest('.drop'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
document.addEventListener('drop', e => {
  const t = e.target instanceof Element ? e.target : null; if (!t) return;
  const col = t.closest('.kanban-column'), zone = t.closest('.drop');
  if (col && S.dragId) { e.preventDefault(); col.classList.remove('drag-over'); moveStatus(S.dragId, col.dataset.status); }
  else if (zone) { e.preventDefault(); zone.classList.remove('over'); addFiles(e.dataTransfer.files); }
  else if (e.dataTransfer && e.dataTransfer.files.length && !t.closest('.rte-area')) e.preventDefault();
});

/* لوحة المفاتيح */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (byId('confirmModal').classList.contains('open')) A.cfCancel();
    else if ($('.modal-overlay.open')) closeModal($('.modal-overlay.open').id);
    else if (drawerOpen()) closeDrawer();
    else { setSidebar(false); byId('notifWrap').classList.remove('open'); }
    return;
  }
  if (e.key === 'Tab') {
    const layer = $('.modal-overlay.open .modal-card') || (drawerOpen() ? byId('drawer') : null);
    if (layer) {
      const f = $$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea,[contenteditable=true]', layer).filter(x => x.offsetParent !== null);
      if (f.length) { const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }
    return;
  }
  const tag = e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.me) { e.preventDefault(); byId('taskSearchInput').focus(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && !typing && e.target.matches && e.target.matches('.task-card,.note-card,tr[data-action]')) { e.preventDefault(); e.target.click(); return; }
  if (typing || !S.me || e.ctrlKey || e.metaKey || e.altKey || $('.modal-overlay.open') || drawerOpen()) return;
  if (e.key === 'n' || e.key === 'N' || e.key === 'ن') { e.preventDefault(); openDrawer(null); }
  else if (e.key === '/') { e.preventDefault(); byId('taskSearchInput').focus(); }
});

/* تأثير الإضاءة عند مرور الماوس */
let fxRaf = 0;
document.addEventListener('mousemove', e => {
  const el = e.target instanceof Element ? e.target.closest('.fx') : null; if (!el || fxRaf) return;
  fxRaf = requestAnimationFrame(() => { const r = el.getBoundingClientRect(); el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px'); fxRaf = 0; });
}, {passive: true});

/* خروج تلقائي عند الخمول */
['mousemove','keydown','click','touchstart','scroll'].forEach(ev => document.addEventListener(ev, () => { lastActive = Date.now(); }, {passive: true, capture: true}));
setInterval(() => { if (S.me && Date.now() - lastActive > IDLE_MS) logout('انتهت الجلسة بسبب عدم النشاط. سجّل الدخول من جديد.'); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) { TODAY = isoDate(new Date()); scheduleRefresh(); } });

/* ==========================================================================
   التشغيل
   ========================================================================== */
async function init() {
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
  const saved = store.get('askon_theme');
  document.documentElement.dataset.theme = (saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  byId('loginForm').addEventListener('submit', doLogin);
  setView('board'); icons();
  if (!window.supabase) return showLogin('تعذّر تحميل مكتبة Supabase. تحقق من الاتصال بالإنترنت.');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) || SUPABASE_ANON_KEY.length < 20 || /PASTE/i.test(SUPABASE_ANON_KEY))
    return showLogin('إعدادات الاتصال غير صحيحة. افتح config.js وتأكد أن الرابط بالشكل https://xxxx.supabase.co (بدون أي مسار بعده) وأن المفتاح كامل.');
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth: {persistSession: true, autoRefreshToken: true}});
  try {
    const {data: {session}} = await sb.auth.getSession();
    if (session) await startSession(session.user); else showLogin();
  } catch (e) { showLogin('تعذّر الاتصال بالسيرفر'); }
}
init();
})();
