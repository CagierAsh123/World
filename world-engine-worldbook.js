// world-engine-worldbook.js — 当前聊天世界书读取与后台推演选择
window.WORLD_ENGINE_WORLDBOOK = (function() {
  const STORAGE_PREFIX = 'world_engine_worldbook_selection_';
  let worldInfoModulePromise = null;

  function getChatId() {
    return window.WORLD_ENGINE_CORE?.getChatId?.() || 'default';
  }

  function getSelectionKey() {
    return STORAGE_PREFIX + getChatId();
  }

  // 触发模式的合法 override 值（'auto' 为默认、不落盘）：强制常驻 / 强制关键词 / 关闭
  const OVERRIDE_VALUES = ['const', 'key', 'off'];
  function sanitizeOverrides(obj) {
    const out = {};
    if (obj && typeof obj === 'object') {
      for (const k in obj) {
        if (typeof k === 'string' && OVERRIDE_VALUES.indexOf(obj[k]) !== -1) out[k] = obj[k];
      }
    }
    return out;
  }

  // 解析存储值，兼容老格式（纯数组）与新格式（{ids, t, overrides}）
  function parseStored(raw) {
    try {
      const data = JSON.parse(raw || '[]');
      if (Array.isArray(data)) return { ids: data.filter(id => typeof id === 'string'), t: 0, overrides: {} };
      if (data && Array.isArray(data.ids)) {
        return {
          ids: data.ids.filter(id => typeof id === 'string'),
          t: Number(data.t) || 0,
          overrides: sanitizeOverrides(data.overrides)
        };
      }
    } catch (e) {}
    return { ids: [], t: 0, overrides: {} };
  }

  function readStored() {
    return parseStored(window.WORLD_ENGINE_STORE.getItem(getSelectionKey()));
  }

  function getSelectedIds() {
    return readStored().ids;
  }

  // 每条目的触发覆写（{entryId: 'const'|'key'|'off'}）；缺省视为 'auto'（跟随酒馆）
  function getOverrides() {
    return readStored().overrides;
  }

  // 区分"从未保存"（key 不存在）和"保存了空选择"（key 存在但 ids 为 []）
  function hasSelection() {
    return window.WORLD_ENGINE_STORE.getItem(getSelectionKey()) !== null;
  }

  // 找出最老的一条其它聊天的选择记录（按保存时间戳；老格式无时间戳视为最老）
  function removeOldestOtherSelection() {
    const currentKey = getSelectionKey();
    let oldestKey = null;
    let oldestT = Infinity;
    for (const key of window.WORLD_ENGINE_STORE.keys()) {
      if (!key || !key.startsWith(STORAGE_PREFIX) || key === currentKey) continue;
      const t = parseStored(window.WORLD_ENGINE_STORE.getItem(key)).t;
      if (t < oldestT) {
        oldestT = t;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      window.WORLD_ENGINE_STORE.removeItem(oldestKey);
      return true;
    }
    return false;
  }

  function persistSelection(ids, overrides) {
    const uniqueIds = [...new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])];
    // 只保留仍被选中的 override，避免取消勾选后残留、无限堆积
    const idSet = new Set(uniqueIds);
    const ov = sanitizeOverrides(overrides);
    const trimmed = {};
    for (const k in ov) if (idSet.has(k)) trimmed[k] = ov[k];
    const value = JSON.stringify({ ids: uniqueIds, t: Date.now(), overrides: trimmed });
    const currentKey = getSelectionKey();
    // 改用 IndexedDB 后基本不会再满；若回退 localStorage 仍超限，则每次删最老一条再重试（FIFO 兜底）
    while (true) {
      try {
        window.WORLD_ENGINE_STORE.setItem(currentKey, value);
        return;
      } catch (e) {
        if (!removeOldestOtherSelection()) throw e;
      }
    }
  }

  // 兼容旧调用：只改选择，保留已存的每条触发覆写
  function saveSelectedIds(ids) {
    persistSelection(ids, readStored().overrides);
  }

  // 同时保存选择与每条目的触发覆写
  function saveSelection(ids, overrides) {
    persistSelection(ids, overrides);
  }

  function getEntryId(entry) {
    return `${entry.world || '未知世界书'}::${entry.uid}`;
  }

  function getEntryTitle(entry) {
    const comment = String(entry.comment || '').trim();
    if (comment) return comment;
    const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean).join('、') : '';
    if (keys) return keys;
    const content = String(entry.content || '').trim();
    return content ? content.substring(0, 40) : `条目 ${entry.uid}`;
  }

  async function getWorldInfoModule() {
    if (!worldInfoModulePromise) {
      worldInfoModulePromise = import('/scripts/world-info.js').catch(error => {
        worldInfoModulePromise = null;
        throw error;
      });
    }
    return worldInfoModulePromise;
  }

  async function loadCurrentEntries() {
    const module = await getWorldInfoModule();
    if (typeof module.getSortedEntries !== 'function') {
      throw new Error('当前 SillyTavern 版本不支持读取世界书条目');
    }
    const entries = await module.getSortedEntries();
    return (Array.isArray(entries) ? entries : [])
      .filter(entry => entry && entry.uid !== undefined && String(entry.content || '').trim())
      // 完全无视 TavernDB-ACU 开头的条目：不显示、不可选、不注入
      .filter(entry => !getEntryTitle(entry).startsWith('TavernDB-ACU'))
      .map(entry => ({
        id: getEntryId(entry),
        uid: entry.uid,
        world: entry.world || '未知世界书',
        title: getEntryTitle(entry),
        content: String(entry.content || '').trim(),
        disabled: entry.disable === true || entry.enabled === false,
        // —— 原生激活配置（蓝绿灯触发用，跟随酒馆世界书自身设置）——
        constant: entry.constant === true,                  // 🔵 常驻
        vectorized: entry.vectorized === true,              // 🔗 向量（本扩展不做向量召回，按非关键词处理）
        selective: entry.selective === true,                // 是否启用次要关键词逻辑
        selectiveLogic: Number(entry.selectiveLogic) || 0,  // 0 AND_ANY / 1 NOT_ALL / 2 NOT_ANY / 3 AND_ALL
        keys: Array.isArray(entry.key) ? entry.key.filter(k => typeof k === 'string' && k.trim()) : [],
        secondaryKeys: Array.isArray(entry.keysecondary) ? entry.keysecondary.filter(k => typeof k === 'string' && k.trim()) : [],
        caseSensitive: entry.caseSensitive === true,
        matchWholeWords: entry.matchWholeWords === true
      }));
  }

  // ========== 蓝绿灯触发引擎 ==========
  // 复刻酒馆世界书的关键词匹配规则，但「触发什么」完全由本扩展自己判定：
  // 只扫描本扩展喂给推演的上下文（近期对话/世界状态），不监听酒馆的聊天扫描，保持解耦。
  // 酒馆 world_info_logic：AND_ANY=0 / NOT_ALL=1 / NOT_ANY=2 / AND_ALL=3。
  const LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };

  function triggerEnabled() {
    const a = window.WORLD_ENGINE_API;
    const s = a && a.getSettings ? a.getSettings() : {};
    return s.worldbookTrigger === true;
  }

  // 形如 /pattern/flags 的关键词按正则处理（与酒馆一致）
  function parseRegexKey(str) {
    const m = /^\/(.+)\/([a-z]*)$/i.exec(str);
    if (!m) return null;
    try { return new RegExp(m[1], m[2]); } catch (e) { return null; }
  }

  // 单个关键词是否命中扫描文本。整词匹配仅对 ASCII 单词生效；
  // 中文等无词边界（\b 不可用），一律退回子串匹配——这也是本扩展（武侠中文场景）的合理默认。
  function matchKey(text, key, caseSensitive, matchWholeWords) {
    if (typeof key !== 'string' || !text) return false;
    const needle = key.trim();
    if (!needle) return false;
    const re = parseRegexKey(needle);
    if (re) { try { return re.test(text); } catch (e) { return false; } }
    if (matchWholeWords && /[A-Za-z0-9_]/.test(needle) && /^[\x00-\x7F]+$/.test(needle)) {
      const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try { return new RegExp('(?:^|\\W)(?:' + esc + ')(?:\\W|$)', caseSensitive ? '' : 'i').test(text); } catch (e) {}
    }
    return caseSensitive ? text.indexOf(needle) !== -1 : text.toLowerCase().indexOf(needle.toLowerCase()) !== -1;
  }

  // 一条已选条目在本轮扫描文本下是否应注入。
  // mode：auto(跟随酒馆) / const(强制常驻) / key(强制关键词) / off(关闭)。
  function isEntryActive(entry, scanText, mode) {
    const m = mode || 'auto';
    if (m === 'off') return false;
    if (m === 'const') return true;
    if (m === 'auto' && entry.constant) return true;            // 🔵 常驻：恒注入
    // 🟢 关键词路径（m==='key' 强制走关键词；m==='auto' 且非常驻条目）
    const primary = entry.keys || [];
    if (!primary.length) return false;                          // 无主关键词的非常驻条目不会被触发（与酒馆一致）
    const cs = entry.caseSensitive, mw = entry.matchWholeWords;
    if (!primary.some(k => matchKey(scanText, k, cs, mw))) return false;
    const sec = entry.secondaryKeys || [];
    if (!entry.selective || !sec.length) return true;
    const anySec = sec.some(k => matchKey(scanText, k, cs, mw));
    const allSec = sec.every(k => matchKey(scanText, k, cs, mw));
    switch (entry.selectiveLogic) {
      case LOGIC.AND_ALL: return allSec;
      case LOGIC.NOT_ALL: return !allSec;
      case LOGIC.NOT_ANY: return !anySec;
      case LOGIC.AND_ANY:
      default: return anySec;
    }
  }

  // scanText：本扩展喂给推演的上下文文本（近期对话等）。触发关闭时忽略，维持「全部已选注入」的现状。
  async function buildPromptSection(scanText) {
    const stored = readStored();
    const selectedIds = new Set(stored.ids);
    if (!selectedIds.size) return '';

    const triggerOn = triggerEnabled();
    const overrides = stored.overrides || {};
    const text = String(scanText || '');

    try {
      const entries = await loadCurrentEntries();
      const pool = entries.filter(entry => selectedIds.has(entry.id) && !entry.disabled);
      if (!pool.length) return '';

      const selectedEntries = triggerOn
        ? pool.filter(entry => isEntryActive(entry, text, overrides[entry.id]))
        : pool; // 触发关闭：维持现状，全部已选条目注入

      if (!selectedEntries.length) return '';

      const content = selectedEntries.map(entry =>
        `【${entry.world} / ${entry.title}】\n${entry.content}`
      ).join('\n\n');

      return `========== 已选世界书条目 ==========
以下内容是当前聊天的世界观事实与约束。后台推演必须遵守；不得擅自改写其既定设定。

${content}`;
    } catch(error) {
      console.warn('[世界引擎] 读取已选世界书失败:', error);
      return '';
    }
  }

  return {
    getChatId,
    hasSelection,
    getSelectedIds,
    getOverrides,
    saveSelectedIds,
    saveSelection,
    loadCurrentEntries,
    buildPromptSection,
    triggerEnabled,
    isEntryActive,
    matchKey
  };
})();
