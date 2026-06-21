// world-engine-diag.js — 诊断包（一键导出运行状态供排错）
// [FIX] 纯只读模块：仅调用各模块已暴露的 getter 汇总状态，不改任何现有逻辑、不写存储、不动数据结构。
//   导出 { collect, download }；UI 调试区一个按钮调用 download() 即可。
//   撤回成本：删本文件 + 删 world-engine.js MODULES 里一行 + 删 UI 按钮与事件。
window.WORLD_ENGINE_DIAG = (function() {

  // 安全执行：任一区块抛错/模块缺失都不影响整体，记为 { error }
  function safe(fn) {
    try {
      const v = fn();
      return v === undefined ? null : v;
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  }

  // 设置脱敏：apiKey 绝不外泄；apiUrl 只报是否已填（host 不外泄）；其余原样
  function sanitizeSettings(s) {
    if (!s || typeof s !== 'object') return s;
    const out = {};
    for (const k in s) {
      if (k === 'apiKey') {
        const v = s[k];
        out[k] = (v && String(v).length) ? ('***已设置(len=' + String(v).length + ')') : '(空)';
      } else if (k === 'apiUrl') {
        out[k] = (s[k] && String(s[k]).length) ? '(已填)' : '(空)';
      } else {
        out[k] = s[k];
      }
    }
    return out;
  }

  // 统计聊天中 user / ai 条数
  function countChat(chat) {
    let user = 0, ai = 0;
    for (let i = 0; i < chat.length; i++) {
      const m = chat[i];
      if (!m) continue;
      if (m.is_user) user++; else ai++;
    }
    return { total: chat.length, user, ai };
  }

  function collect() {
    const core = window.WORLD_ENGINE_CORE;
    const api = window.WORLD_ENGINE_API;
    const store = window.WORLD_ENGINE_STORE;
    const evo = window.WORLD_ENGINE_EVOLUTION;
    const chatcache = window.WORLD_ENGINE_CHATCACHE;
    const worldbook = window.WORLD_ENGINE_WORLDBOOK;
    const rules = window.WORLD_ENGINE_RULES;

    const diag = {};

    // —— 元信息 ——
    diag.meta = safe(function () {
      return {
        extVersion: window.WORLD_ENGINE_VERSION || '未知（未读到 manifest 版本）',
        collectedAt: new Date().toISOString(),
        userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || '未知'
      };
    });

    // —— 运行环境 ——
    diag.env = safe(function () {
      const ctx = SillyTavern.getContext();
      const chat = (ctx && ctx.chat) || [];
      return {
        chatId: (ctx && ctx.chatId) || null,
        chat: countChat(chat),
        name1: (ctx && ctx.name1) || null,
        name2: (ctx && ctx.name2) || null,
        characterId: (ctx && ctx.characterId != null) ? ctx.characterId : null,
        hasChatMetadata: !!(ctx && ctx.chatMetadata),
        tavernApi: {
          updateChatMetadata: !!(ctx && typeof ctx.updateChatMetadata === 'function'),
          saveMetadataDebounced: !!(ctx && typeof ctx.saveMetadataDebounced === 'function'),
          saveMetadata: !!(ctx && typeof ctx.saveMetadata === 'function'),
          saveChat: !!(ctx && typeof ctx.saveChat === 'function')
        }
      };
    });

    // —— 设置（脱敏）——
    diag.settings = safe(function () {
      if (!api || !api.getSettings) return { error: 'api 模块不可用' };
      return sanitizeSettings(api.getSettings(true));
    });

    // —— 世界状态摘要 ——
    diag.worldState = safe(function () {
      if (!core || !core.loadState) return { error: 'core 模块不可用' };
      const st = core.loadState() || {};
      const len = function (a) { return Array.isArray(a) ? a.length : 0; };
      return {
        round: st.round,
        chatLayer: st.chatLayer,
        worldDigestLen: (st.worldDigest || '').length,
        counts: {
          events: len(st.events),
          factions: len(st.factions),
          winds: len(st.winds),
          worldTrends: len(st.worldTrends),
          memories: len(st.memories),
          enemies: len(st.enemies),
          influenceChain: len(st.influenceChain),
          economySignals: len(st.economy && st.economy.signals),
          secretActions: len(st.blackbox && st.blackbox.secretActions),
          secretAssets: len(st.blackbox && st.blackbox.secretAssets)
        },
        regionalIncidentActive: !!(st.regionalIncident && st.regionalIncident.active),
        hasLastInjection: !!st.lastInjection,
        hasLastEvolveResult: !!st.lastEvolveResult,
        hasState: core.hasState ? core.hasState() : null
      };
    });

    // —— 存档点 ——
    diag.checkpoint = safe(function () {
      if (!core || !core.restoreCheckpoint) return { error: 'core 模块不可用' };
      const cp = core.restoreCheckpoint();
      if (!cp) return { exists: false };
      return { exists: true, round: cp.round, chatLayer: cp.chatLayer };
    });

    // —— 指纹 / 层数 ——
    diag.fingerprint = safe(function () {
      if (!core) return { error: 'core 模块不可用' };
      return {
        fingerprint: core.loadFingerprint ? core.loadFingerprint() : null,
        chatLayer: core.getChatLayer ? core.getChatLayer() : null,
        isNewRound: core.isNewRound ? core.isNewRound() : null,
        lastStoryDay: core.getLastStoryDay ? core.getLastStoryDay() : null,
        anchorLayer: core.getAnchorLayer ? core.getAnchorLayer() : null
      };
    });

    // —— 推演状态（含完整 prompt / 原始返回，用户已同意含对话原文）——
    diag.evolution = safe(function () {
      if (!evo) return { error: 'evolution 模块不可用' };
      const dbg = evo.getLastDebug ? evo.getLastDebug() : {};
      return {
        isRunning: evo.isRunning ? evo.isRunning() : null,
        lastError: evo.getLastError ? evo.getLastError() : null,
        lastPrompt: (dbg && dbg.prompt) || '',
        lastRawResult: (dbg && dbg.rawResult) || '',
        lastPromptLen: ((dbg && dbg.prompt) || '').length,
        lastRawResultLen: ((dbg && dbg.rawResult) || '').length
      };
    });

    // —— 酒馆缓存 ——
    diag.chatcache = safe(function () {
      if (!chatcache || !chatcache.getStatus) return { error: 'chatcache 模块不可用' };
      const status = chatcache.getStatus();
      const snaps = chatcache.listSnapshots ? chatcache.listSnapshots() : [];
      return {
        status: status,
        snapshots: snaps.map(function (s) {
          return { id: s.id, name: s.name, auto: !!s.auto, round: s.round, createdAt: s.createdAt, v: s.v };
        })
      };
    });

    // —— 世界书 ——
    diag.worldbook = safe(function () {
      if (!worldbook) return { error: 'worldbook 模块不可用' };
      const ids = worldbook.getSelectedIds ? worldbook.getSelectedIds() : [];
      return {
        selectedCount: Array.isArray(ids) ? ids.length : 0,
        hasSelection: worldbook.hasSelection ? worldbook.hasSelection() : null,
        triggerEnabled: worldbook.triggerEnabled ? worldbook.triggerEnabled() : null
      };
    });

    // —— 存储键（仅 key 名，不导 value：避免泄露与体积膨胀）——
    diag.store = safe(function () {
      if (!store || !store.keys) return { error: 'store 模块不可用' };
      const keys = store.keys();
      return { count: keys.length, keys: keys };
    });

    // —— 规则 ——
    diag.rules = safe(function () {
      if (!rules || !rules.getRuleCount) return { error: 'rules 模块不可用' };
      return { ruleCount: rules.getRuleCount() };
    });

    return diag;
  }

  // 下载诊断包为 JSON 文件
  function download() {
    const diag = collect();
    const content = JSON.stringify(diag, null, 2);
    let chatId = 'unknown';
    try {
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.chatId) chatId = String(ctx.chatId).replace(/[^\w.-]+/g, '_').slice(0, 40);
    } catch (e) {}
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'world-engine-diag-' + chatId + '-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    return content;
  }

  return { collect, download };
})();
