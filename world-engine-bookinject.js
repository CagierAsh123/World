// world-engine-bookinject.js — 注入世界状态为世界书条目（与黑科技同策略：constant 类型条目，绝对兼容）
//
// 利用 SillyTavern 原生世界书引擎：
//   - 为当前角色创建辅助世界书「🌍 世界引擎 — {{char}}」
//   - 绑定为角色辅助世界书（不占用聊天世界书唯一槽位）
//   - 在其中维护一条 type='constant' 条目，内容 = 世界状态全文
//   - 每次推演完成 / 注入时即地检查：世界书不存在则创建，条目不存在/关闭则创建并打开
window.WORLD_ENGINE_BOOKINJECT = (function() {
  const BOOK_PREFIX = '🌍 世界引擎';
  const ENTRY_COMMENT = 'WorldEngine-LiveState';

  let _lastContent = '';
  let _refreshTimer = null;
  const REFRESH_DELAY = 800;

  function core() { return window.WORLD_ENGINE_CORE; }
  function injectMod() { return window.WORLD_ENGINE_INJECT; }
  function store() { return window.WORLD_ENGINE_STORE; }

  let _wiModule = null;
  async function wi() {
    if (_wiModule) return _wiModule;
    _wiModule = await import('/scripts/world-info.js');
    return _wiModule;
  }

  function getCtx() {
    try { return SillyTavern.getContext(); } catch (e) { return null; }
  }

  function getCharName() {
    try { return core().getUserName(); } catch (e) { return '未知角色'; }
  }

  function getCharFileName() {
    try {
      const ctx = getCtx();
      const chid = ctx && ctx.characterId !== undefined ? ctx.characterId : undefined;
      if (chid === undefined) return null;
      if (typeof getCharaFilename === 'function') return getCharaFilename(chid);
      return null;
    } catch (e) { return null; }
  }

  function bookName() {
    return BOOK_PREFIX + ' — ' + getCharName();
  }

  // ========== 核心：每次调用即地检查并修复 ==========

  async function ensureEntry() {
    const m = await wi();
    const ctx = getCtx();
    if (!ctx || !ctx.chatId) return null;

    const name = bookName();
    const charFile = getCharFileName();

    // 1. 加载世界书；不存在则创建
    let data = m.worldInfoCache && m.worldInfoCache.has(name)
      ? m.worldInfoCache.get(name) : null;
    if (!data) data = await m.loadWorldInfo(name);
    if (!data) {
      console.log('[世界引擎][书注] 世界书不存在，创建:', name);
      data = { entries: {} };
      await m.saveWorldInfo(name, data, true);
      // 刷新 UI 世界书列表（如果面板已打开）
      try { await m.updateWorldInfoList(); } catch (e) {}
      console.log('[世界引擎][书注] 世界书已创建');
    }

    // 2. 绑定为角色辅助世界书（幂等，内部 Set 去重）
    if (charFile) {
      try { await m.charUpdateAddAuxWorld(charFile, name); } catch (e) {
        console.warn('[世界引擎][书注] 绑定辅助世界书失败:', e.message);
      }
    }

    // 3. 查找或创建条目
    let entry = Object.values(data.entries || {}).find(e => e && e.comment === ENTRY_COMMENT);
    if (!entry) {
      entry = m.createWorldInfoEntry(name, data);
      if (!entry) return null;
      entry.comment = ENTRY_COMMENT;
      entry.content = '';
      entry.constant = true;
      entry.disable = false;
      entry.preventRecursion = true;
      entry.order = 1;
      entry.position = 0;            // before chat
      entry.depth = m.DEFAULT_DEPTH || 4;
      entry.key = ['WorldEngine-LiveState-Key'];
      entry.selective = false;
      console.log('[世界引擎][书注] 创建条目 uid=' + entry.uid);
    }

    // 4. 条目被关了就打开
    if (entry.disable) {
      entry.disable = false;
      console.log('[世界引擎][书注] 重新启用条目');
    }

    return { data, entry };
  }

  // ========== 公开 API ==========

  async function inject(content) {
    if (!content || content === _lastContent) return false;
    try {
      const res = await ensureEntry();
      if (!res) return false;
      if (res.entry.content === content) { _lastContent = content; return true; }

      res.entry.content = content;
      const m = await wi();
      await m.saveWorldInfo(bookName(), res.data, true);
      _lastContent = content;
      console.log('[世界引擎][书注] 注入完成 (' + content.length + ' chars)');
      return true;
    } catch (e) {
      console.warn('[世界引擎][书注] 注入失败:', e.message);
      return false;
    }
  }

  async function remove() {
    try {
      const m = await wi();
      const name = bookName();
      let data = (m.worldInfoCache && m.worldInfoCache.has(name)) ? m.worldInfoCache.get(name) : null;
      if (!data) data = await m.loadWorldInfo(name);
      if (!data) return;
      const entry = Object.values(data.entries || {}).find(e => e && e.comment === ENTRY_COMMENT);
      if (entry && !entry.disable) {
        entry.disable = true;
        entry.content = '';
        await m.saveWorldInfo(name, data, true);
        _lastContent = '';
      }
    } catch (e) {}
  }

  async function refreshNow() {
    try {
      const ctx = getCtx();
      if (!ctx) return;
      const state = core().hasState() ? core().loadState() : null;
      if (!state || state.round === 0) return;

      const tags = [];
      for (const ev of state.events || []) tags.push(ev.name);
      for (const f of state.factions || []) tags.push(f.name);

      const context = injectMod().buildContext(state, tags);
      await inject(context);
    } catch (e) {
      console.warn('[世界引擎][书注] 刷新失败:', e.message);
    }
  }

  function scheduleRefresh() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => { _refreshTimer = null; refreshNow(); }, REFRESH_DELAY);
  }

  function onStoreWrite(key, value) {
    try {
      const ctx = getCtx();
      if (!ctx || !ctx.chatId) return;
      const stateKey = 'world_engine_' + ctx.chatId;
      const cpKey = stateKey + '_checkpoint';
      if (key === stateKey || key === cpKey) scheduleRefresh();
    } catch (e) {}
  }

  function installStoreListener() {
    const st = store();
    if (!st) return;
    const origSetItem = st.setItem.bind(st);
    st.setItem = function(key, value) { origSetItem(key, value); onStoreWrite(key, value); };
  }

  return { inject, remove, refreshNow, scheduleRefresh, installStoreListener };
})();
