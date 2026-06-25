// world-engine-bookinject.js — 注入世界状态为世界书条目（与黑科技同策略：constant 类型条目，绝对兼容）
//
// 替代旧的 extension prompt 注入方式。利用 SillyTavern 原生世界书引擎：
//   - 创建独立世界书「🌍 世界引擎·实时注入」
//   - 绑定为当前角色的辅助世界书
//   - 在其中维护一条 type='constant' 条目，内容 = 世界状态上下文
//   - SillyTavern 原生扫描引擎无条件注入 constant 条目，不走扩展 prompt 通道
//
// 刷新时机：
//   - 推演完成后立刻刷新（world-engine.js performEvolution 后调用）
//   - UI 编辑状态后通过 store syncSink 触发去抖刷新
window.WORLD_ENGINE_BOOKINJECT = (function() {
  const BOOK_NAME = '🌍 世界引擎·实时注入';
  const ENTRY_COMMENT = 'WorldEngine-LiveState';

  let _ready = false;
  let _bookCache = null;        // 世界书 data 对象引用（entries 在上层）
  let _entryUid = null;         // 当前条目的 uid
  let _lastContent = '';        // 上次写入的内容，用于去重
  let _refreshTimer = null;
  let _refreshPending = false;
  const REFRESH_DELAY = 800;    // UI 编辑去抖

  function core() { return window.WORLD_ENGINE_CORE; }
  function inject() { return window.WORLD_ENGINE_INJECT; }
  function store() { return window.WORLD_ENGINE_STORE; }

  // ========== 世界书 CRUD 封装 ==========

  // 动态 import SillyTavern 的世界书模块（与 worldbook.js 同源）
  let _wiModule = null;
  async function wi() {
    if (_wiModule) return _wiModule;
    _wiModule = await import('/scripts/world-info.js');
    return _wiModule;
  }

  function getCtx() {
    try { return SillyTavern.getContext(); } catch (e) { return null; }
  }

  function getCharFileName() {
    try {
      const ctx = getCtx();
      const chid = ctx && ctx.characterId !== undefined ? ctx.characterId : undefined;
      if (chid === undefined) return null;
      if (typeof getCharaFilename === 'function') {
        return getCharaFilename(chid);
      }
      // 退路：拼角色名
      const char = ctx.characters && ctx.characters[chid];
      if (char && char.name) return char.name;
    } catch (e) {}
    return null;
  }

  // 确保专用世界书存在且已绑定到当前角色
  async function ensureBook() {
    const m = await wi();

    // 尝试加载已有世界书
    let data = m.worldInfoCache && m.worldInfoCache.has(BOOK_NAME)
      ? m.worldInfoCache.get(BOOK_NAME) : null;
    if (!data) {
      data = await m.loadWorldInfo(BOOK_NAME);
    }

    // 不存在则创建
    if (!data) {
      console.log('[世界引擎][书注] 创建专用世界书:', BOOK_NAME);
      await m.createNewWorldInfo(BOOK_NAME);
      data = m.worldInfoCache && m.worldInfoCache.has(BOOK_NAME)
        ? m.worldInfoCache.get(BOOK_NAME)
        : await m.loadWorldInfo(BOOK_NAME);
    }

    if (!data) {
      console.warn('[世界引擎][书注] 无法加载或创建世界书');
      return null;
    }

    // 绑定为当前角色的辅助世界书
    const fileName = getCharFileName();
    if (fileName) {
      try {
        // 检查是否已绑定：通过尝试加载角色的 lore 来判断
        // charLore 是模块内部状态，通过 charUpdateAddAuxWorld 追加（幂等——内部用 Set 去重）
        await m.charUpdateAddAuxWorld(fileName, BOOK_NAME);
      } catch (e) {
        console.warn('[世界引擎][书注] 绑定角色失败（非致命）:', e.message);
      }
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
    if (e) {
      _entryUid = e.uid;
      return e;
    }
    return null;
  }

  async function createEntry(data) {
    const m = await wi();
    const entry = m.createWorldInfoEntry(BOOK_NAME, data);
    if (!entry) return null;

    entry.comment = ENTRY_COMMENT;
    entry.content = '';
    entry.constant = true;         // ← 核心：恒定触发，无视关键词
    entry.disable = false;         // 启用（SillyTavern 用 disable 字段）
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

  // 初始化：确保世界书与条目就绪（后台不阻塞）
  async function init() {
    if (_ready) return;
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
      console.log('[世界引擎][书注] 初始化完成，世界书条目就绪');
    } catch (e) {
      console.warn('[世界引擎][书注] 初始化失败（非致命，回退扩展注入）:', e.message);
    }
  }

  // 注入：写入世界状态上下文字段到世界书条目
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
        return true; // 内容未变，跳过
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

  // 移除：清空条目内容（保留条目结构，下次注入时复用）
  async function remove() {
    if (!_ready || !_bookCache || _entryUid === null) return;
    try {
      const m = await wi();
      const entry = _bookCache.entries && _bookCache.entries[_entryUid];
      if (entry) {
        entry.content = '';
        entry.disable = true;  // 禁用而非删除，避免反复创建
        await m.saveWorldInfo(BOOK_NAME, _bookCache, true);
        _lastContent = '';
        console.log('[世界引擎][书注] 已移除注入内容');
      }
    } catch (e) {
      console.warn('[世界引擎][书注] 移除失败:', e.message);
    }
  }

  // 刷新：从当前世界状态重建注入内容并写入世界书
  // 用于推演完成后 / UI 编辑后立即反映最新状态
  async function refreshNow() {
    if (!_ready) {
      try { await init(); } catch (e) { return; }
    }
    try {
      const ctx = getCtx();
      if (!ctx) return;

      const state = core().hasState() ? core().loadState() : null;
      if (!state || state.round === 0) return; // 从未推演过，不注入

      const recentChat = (ctx.chat || []).slice(-5);
      const recent = recentChat.map(m => (m.mes || '')).join(' ');

      const tags = [];
      for (const ev of state.events || []) tags.push(ev.name);
      for (const f of state.factions || []) tags.push(f.name);

      const context = inject().buildContext(state, tags);
      await inject(context);
    } catch (e) {
      console.warn('[世界引擎][书注] 刷新失败:', e.message);
    }
  }

  // 去抖刷新：store 写入后延迟调用，合并连续编辑
  function scheduleRefresh() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => {
      _refreshTimer = null;
      _refreshPending = false;
      refreshNow();
    }, REFRESH_DELAY);
  }

  // ========== Store 同步槽（监听 UI 编辑） ==========
  // 当 core.saveState() 被调用时，store.setItem() 触发此回调
  function onStoreWrite(key, value) {
    if (!_ready) return;
    try {
      const ctx = getCtx();
      if (!ctx || !ctx.chatId) return;
      // 只关心当前聊天的 state 和 checkpoint
      const stateKey = 'world_engine_' + ctx.chatId;
      const cpKey = stateKey + '_checkpoint';
      if (key === stateKey || key === cpKey) {
        scheduleRefresh();
      }
    } catch (e) {}
  }

  // 安装存储监听：在 chatcache 的 syncSink 上叠加一层
  function installStoreListener() {
    const st = store();
    if (!st) return;
    // store 的 syncSink 只支持单个回调。chatcache 已占用。
    // 替代方案：包装 store.setItem，在原始调用后触发
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
