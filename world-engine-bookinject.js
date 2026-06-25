// world-engine-bookinject.js — 注入世界状态为世界书条目（与黑科技同策略：constant 类型条目，绝对兼容）
//
// 每次推演完成 / UI 编辑后触发：检查角色辅助世界书是否存在、条目是否就绪，
// 没有则创建，有则全量更新内容。不做 init/ready 状态追踪，每次即地检查。
window.WORLD_ENGINE_BOOKINJECT = (function() {
  const BOOK_PREFIX = '🌍 世界引擎';
  const ENTRY_COMMENT = 'WorldEngine-LiveState';

  let _refreshTimer = null;
  const REFRESH_DELAY = 800;
  let _lastContent = '';

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
      const char = ctx.characters && ctx.characters[chid];
      if (char && char.name) return char.name;
    } catch (e) {}
    return null;
  }

  function bookName() {
    return BOOK_PREFIX + ' — ' + getCharName();
  }

  // ========== 每次调用的核心流程 ==========

  // 确保：世界书存在 + 已绑定角色 + 条目存在且启用
  // 返回 { data, entry } 或 null
  async function ensureEntry() {
    const m = await wi();
    const ctx = getCtx();
    if (!ctx || !ctx.chatId) return null;

    const name = bookName();
    const charFile = getCharFileName();

    // 1. 加载或创建世界书
    let data = (m.worldInfoCache && m.worldInfoCache.has(name)) ? m.worldInfoCache.get(name) : null;
    if (!data) data = await m.loadWorldInfo(name);
    if (!data) {
      console.log('[世界引擎][书注] 创建世界书:', name);
      await m.createNewWorldInfo(name);
      data = (m.worldInfoCache && m.worldInfoCache.has(name))
        ? m.worldInfoCache.get(name) : await m.loadWorldInfo(name);
    }
    if (!data) { console.warn('[世界引擎][书注] 无法加载或创建世界书'); return null; }

    // 2. 绑定为角色辅助世界书（幂等，内部去重）
    if (charFile) {
      try { await m.charUpdateAddAuxWorld(charFile, name); } catch (e) {}
    }

    // 3. 查找或创建条目
    let entry = Object.values(data.entries || {}).find(e => e && e.comment === ENTRY_COMMENT);
    if (!entry) {
      entry = m.createWorldInfoEntry(name, data);
      if (!entry) return null;
      entry.comment = ENTRY_COMMENT;
      entry.constant = true;
      entry.disable = false;
      entry.preventRecursion = true;
      entry.order = 1;
      entry.position = 0;
      entry.depth = m.DEFAULT_DEPTH || 4;
      entry.key = ['WorldEngine-LiveState-Key'];
      entry.selective = false;
      console.log('[世界引擎][书注] 创建条目 uid=' + entry.uid);
    }

    // 4. 如果条目被关了，打开
    if (entry.disable) {
      entry.disable = false;
      console.log('[世界引擎][书注] 重新启用条目');
    }

    return { data, entry };
  }

  // ========== 公开 API ==========

  // 注入：写入世界状态到条目
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

  // 移除：禁用条目
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
        console.log('[世界引擎][书注] 已禁用条目');
      }
    } catch (e) {}
  }

  // 刷新：从当前世界状态重建内容并注入
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

  // ========== Store 监听 ==========
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
    st.setItem = function(key, value) {
      origSetItem(key, value);
      onStoreWrite(key, value);
    };
  }

  return { inject, remove, refreshNow, scheduleRefresh, installStoreListener };
})();
