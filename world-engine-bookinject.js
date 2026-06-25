// world-engine-bookinject.js — 注入世界状态为聊天世界书条目（与黑科技同策略：constant 类型条目，绝对兼容）
//
// 替代旧的 extension prompt 注入方式。利用 SillyTavern 原生世界书引擎：
//   - 创建独立世界书「🌍 世界引擎·实时注入」
//   - 赋值给当前聊天（chat_metadata['world_info']），仅当前聊天生效
//   - 在其中维护一条 type='constant' 条目，内容 = 世界状态全文
//   - SillyTavern 原生扫描引擎无条件注入 constant 条目，不走扩展 prompt 通道
//
// 刷新时机：
//   - 推演完成后立刻刷新（world-engine.js performEvolution 后调用）
//   - UI 编辑状态后通过 store 包装层去抖刷新
window.WORLD_ENGINE_BOOKINJECT = (function() {
  const BOOK_NAME = '🌍 世界引擎·实时注入';
  const ENTRY_COMMENT = 'WorldEngine-LiveState';
  const METADATA_KEY = 'world_info';  // chat_metadata 中指向聊天世界书的键

  let _ready = false;
  let _bookCache = null;        // 世界书 data 对象引用
  let _entryUid = null;         // 当前条目的 uid
  let _lastContent = '';        // 上次写入的内容，用于去重
  let _assignedChatId = null;   // 上次赋值的聊天 id，切聊天时需重新赋值
  let _refreshTimer = null;
  const REFRESH_DELAY = 800;    // UI 编辑去抖

  function core() { return window.WORLD_ENGINE_CORE; }
  function injectMod() { return window.WORLD_ENGINE_INJECT; }
  function store() { return window.WORLD_ENGINE_STORE; }

  // ========== 世界书 CRUD 封装 ==========

  let _wiModule = null;
  async function wi() {
    if (_wiModule) return _wiModule;
    _wiModule = await import('/scripts/world-info.js');
    return _wiModule;
  }

  function getCtx() {
    try { return SillyTavern.getContext(); } catch (e) { return null; }
  }

  // 确保专用世界书存在且赋值给当前聊天
  async function ensureBook() {
    const m = await wi();
    const ctx = getCtx();
    if (!ctx || !ctx.chatId) {
      console.warn('[世界引擎][书注] 无聊天上下文，跳过世界书初始化');
      return null;
    }

    // 加载或创建世界书
    let data = m.worldInfoCache && m.worldInfoCache.has(BOOK_NAME)
      ? m.worldInfoCache.get(BOOK_NAME) : null;
    if (!data) {
      data = await m.loadWorldInfo(BOOK_NAME);
      console.log('[世界引擎][书注] loadWorldInfo 结果:', data ? '已加载' : '不存在');
    }
    if (!data) {
      console.log('[世界引擎][书注] 创建世界书:', BOOK_NAME);
      const created = await m.createNewWorldInfo(BOOK_NAME);
      console.log('[世界引擎][书注] createNewWorldInfo 结果:', created);
      data = m.worldInfoCache && m.worldInfoCache.has(BOOK_NAME)
        ? m.worldInfoCache.get(BOOK_NAME)
        : await m.loadWorldInfo(BOOK_NAME);
    }
    if (!data) {
      console.warn('[世界引擎][书注] 无法加载或创建世界书');
      return null;
    }

    // 赋值给当前聊天（切聊天时需重新赋值）
    if (_assignedChatId !== ctx.chatId) {
      const md = ctx.chatMetadata || {};
      if (md[METADATA_KEY] !== BOOK_NAME) {
        md[METADATA_KEY] = BOOK_NAME;
        if (typeof ctx.updateChatMetadata === 'function') {
          ctx.updateChatMetadata({ [METADATA_KEY]: BOOK_NAME });
        } else {
          ctx.chatMetadata = md;
        }
        if (typeof ctx.saveMetadata === 'function') {
          ctx.saveMetadata();
        }
        console.log('[世界引擎][书注] 已赋值聊天世界书:', BOOK_NAME);
      }
      _assignedChatId = ctx.chatId;
    }

    _bookCache = data;
    return data;
  }

  // ========== 条目管理 ==========

  async function findEntry(data) {
    if (!data || !data.entries) return null;
    const e = Object.values(data.entries).find(
      e => e && e.comment === ENTRY_COMMENT
    );
    if (e) { _entryUid = e.uid; return e; }
    return null;
  }

  async function createEntry(data) {
    const m = await wi();
    const entry = m.createWorldInfoEntry(BOOK_NAME, data);
    if (!entry) return null;

    entry.comment = ENTRY_COMMENT;
    entry.content = '';
    entry.constant = true;         // 恒定触发，无视关键词
    entry.disable = false;         // 启用
    entry.preventRecursion = true;
    entry.order = 1;               // 浅深度，早注入
    entry.position = 0;            // before chat（系统级）
    entry.depth = m.DEFAULT_DEPTH || 4;
    entry.key = ['WorldEngine-LiveState-Key'];
    entry.selective = false;

    _entryUid = entry.uid;
    _bookCache = data;
    console.log('[世界引擎][书注] 创建常量条目 uid=' + entry.uid);
    return entry;
  }

  // ========== 公开 API ==========

  // 初始化：确保世界书、赋值聊天、条目就绪
  async function init() {
    try {
      const data = await ensureBook();
      if (!data) return;

      let entry = await findEntry(data);
      if (!entry) {
        entry = await createEntry(data);
        if (!entry) return;
        const m = await wi();
        await m.saveWorldInfo(BOOK_NAME, data, true);
      }
      _ready = true;
      console.log('[世界引擎][书注] 初始化完成');
    } catch (e) {
      console.warn('[世界引擎][书注] 初始化失败（非致命，回退扩展注入）:', e.message);
    }
  }

  // 注入：全量更新世界书条目内容
  async function inject(content) {
    if (!_ready) {
      try { await init(); } catch (e) { return false; }
    }
    if (!_ready || !_bookCache || _entryUid === null) return false;
    if (!content || content === _lastContent) return false;

    try {
      const m = await wi();
      const data = _bookCache;

      // 条目可能被外部删除，重新查找或创建
      let entry = data.entries && data.entries[_entryUid];
      if (!entry) {
        entry = await findEntry(data);
        if (!entry) {
          entry = await createEntry(data);
          if (!entry) return false;
        }
      }

      if (entry.content === content) {
        _lastContent = content;
        return true;
      }

      entry.content = content;
      await m.saveWorldInfo(BOOK_NAME, data, true);
      _lastContent = content;
      console.log('[世界引擎][书注] 注入完成 (' + content.length + ' chars)');
      return true;
    } catch (e) {
      console.warn('[世界引擎][书注] 注入失败:', e.message);
      return false;
    }
  }

  // 移除：禁用条目（电源关闭）
  async function remove() {
    if (!_ready || !_bookCache || _entryUid === null) return;
    try {
      const m = await wi();
      const entry = _bookCache.entries && _bookCache.entries[_entryUid];
      if (entry) {
        entry.content = '';
        entry.disable = true;
        await m.saveWorldInfo(BOOK_NAME, _bookCache, true);
        _lastContent = '';
        console.log('[世界引擎][书注] 已移除注入内容');
      }
    } catch (e) {
      console.warn('[世界引擎][书注] 移除失败:', e.message);
    }
  }

  // 刷新：从当前世界状态全量重建注入内容并写入世界书
  async function refreshNow() {
    if (!_ready) {
      try { await init(); } catch (e) { return; }
    }
    // 切聊天后重新赋值
    const ctx = getCtx();
    if (ctx && ctx.chatId !== _assignedChatId) {
      try { await ensureBook(); } catch (e) {}
    }
    try {
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

  // 去抖刷新：store 写入后延迟调用，合并连续 UI 编辑
  function scheduleRefresh() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => {
      _refreshTimer = null;
      refreshNow();
    }, REFRESH_DELAY);
  }

  // ========== Store 监听（UI 编辑后自动刷新） ==========
  function onStoreWrite(key, value) {
    if (!_ready) return;
    try {
      const ctx = getCtx();
      if (!ctx || !ctx.chatId) return;
      const stateKey = 'world_engine_' + ctx.chatId;
      const cpKey = stateKey + '_checkpoint';
      if (key === stateKey || key === cpKey) {
        scheduleRefresh();
      }
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

  return {
    init, inject, remove, refreshNow, scheduleRefresh, installStoreListener
  };
})();
