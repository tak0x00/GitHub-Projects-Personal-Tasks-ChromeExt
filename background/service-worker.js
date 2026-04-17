/**
 * Background Service Worker
 * Manages the tasks.google.com tab group and relays messages between content scripts.
 */
(() => {
  "use strict";

  const TAB_GROUP_TITLE = "GP Tasks";
  const TAB_GROUP_COLOR = "purple";
  const TASKS_URL = "https://tasks.google.com/";

  // ── Tab Group Management ─────────────────────────────────

  async function findTasksTabs() {
    return chrome.tabs.query({ url: "https://tasks.google.com/*" });
  }

  async function findOrCreateTabGroup(windowId) {
    const groups = await chrome.tabGroups.query({ title: TAB_GROUP_TITLE, windowId });
    return groups.length > 0 ? groups[0] : null;
  }

  /**
   * Ensure a single tasks.google.com tab exists. Returns the tab.
   */
  async function ensureTasksTab() {
    const existingTabs = await findTasksTabs();

    if (existingTabs.length > 0) {
      const tab = existingTabs[0];
      await ensureTabInGroup(tab);
      return tab;
    }

    const tab = await chrome.tabs.create({ url: TASKS_URL, active: true });
    await ensureTabInGroup(tab);
    return tab;
  }

  async function ensureTabInGroup(tab) {
    // Chrome throws if you try to collapse a group containing the active tab
    const shouldCollapse = !tab.active;
    try {
      const existingGroup = await findOrCreateTabGroup(tab.windowId);

      if (existingGroup && tab.groupId === existingGroup.id) {
        if (shouldCollapse) {
          await chrome.tabGroups.update(existingGroup.id, { collapsed: true });
        }
        return;
      }

      const groupId = await chrome.tabs.group({
        tabIds: [tab.id],
        ...(existingGroup ? { groupId: existingGroup.id } : {}),
      });

      await chrome.tabGroups.update(groupId, {
        title: TAB_GROUP_TITLE,
        color: TAB_GROUP_COLOR,
        collapsed: shouldCollapse,
      });
    } catch (e) {
      console.warn("[GP Tasks] Failed to manage tab group:", e);
    }
  }

  // ── Message Handling ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    switch (message.type) {
      case "ENSURE_TASKS_TAB":
        ensureTasksTab()
          .then((tab) => sendResponse({ success: true, tabId: tab.id }))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;

      case "SYNC_TASKS":
        handleSyncTasks()
          .then((result) => sendResponse(result))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;

      case "SYNC_COMPLETE":
        sendResponse({ success: true });
        return false;

      case "WRITEBACK_DONE":
      case "WRITEBACK_UNDONE":
        handleWriteback(message)
          .then((result) => sendResponse(result))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;

      case "GET_CACHED_TASKS":
        chrome.storage.local.get("gp_gcal_cache", (result) => {
          sendResponse({ success: true, cache: result.gp_gcal_cache ?? {} });
        });
        return true;

      default:
        return false;
    }
  });

  /**
   * Reload the single tasks.google.com tab and wait for autoSync to update the cache.
   */
  async function handleSyncTasks() {
    const tab = await ensureTasksTab();
    await chrome.tabs.reload(tab.id);
    await waitForTabLoad(tab.id);
    await waitForCacheUpdate(6000);
    return { success: true };
  }

  function waitForCacheUpdate(timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout);
      const listener = (changes, area) => {
        if (area === "local" && changes["gp_gcal_cache"]) {
          clearTimeout(timer);
          chrome.storage.onChanged.removeListener(listener);
          resolve();
        }
      };
      chrome.storage.onChanged.addListener(listener);
    });
  }

  async function handleWriteback(message) {
    const tab = await ensureTasksTab();

    if (tab.status !== "complete") {
      await waitForTabLoad(tab.id);
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: message.type === "WRITEBACK_DONE" ? "COMPLETE_TASK" : "UNCOMPLETE_TASK",
        gcalSource: message.gcalSource,
      });
      return response ?? { success: true };
    } catch (e) {
      return { success: false, error: "Could not reach tasks.google.com tab: " + e.message };
    }
  }

  // ── Utilities ────────────────────────────────────────────

  function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15000);
    });
  }
})();
