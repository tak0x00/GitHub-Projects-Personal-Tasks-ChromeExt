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

  /**
   * Find existing tasks.google.com tabs managed by this extension.
   */
  async function findTasksTabs() {
    const tabs = await chrome.tabs.query({ url: "https://tasks.google.com/*" });
    return tabs;
  }

  /**
   * Find or create the "GP Tasks" tab group.
   */
  async function findOrCreateTabGroup(windowId) {
    const groups = await chrome.tabGroups.query({ title: TAB_GROUP_TITLE, windowId });
    return groups.length > 0 ? groups[0] : null;
  }

  /**
   * Ensure at least one tasks.google.com tab exists (for writeback).
   * Returns the first available tab.
   */
  async function ensureTasksTab() {
    const existingTabs = await findTasksTabs();

    if (existingTabs.length > 0) {
      const tab = existingTabs[0];
      await ensureTabInGroup(tab);
      return tab;
    }

    const tab = await chrome.tabs.create({ url: TASKS_URL, active: false });
    await ensureTabInGroup(tab);
    return tab;
  }

  /**
   * Open a new tasks.google.com tab for adding an account.
   * Always creates a fresh tab so the user can log into a different account.
   */
  async function openNewTasksTab() {
    const tab = await chrome.tabs.create({ url: TASKS_URL, active: true });
    await ensureTabInGroup(tab);
    return tab;
  }

  /**
   * Put a tab into the GP Tasks group (collapsed).
   */
  async function ensureTabInGroup(tab) {
    try {
      const existingGroup = await findOrCreateTabGroup(tab.windowId);

      if (existingGroup && tab.groupId === existingGroup.id) {
        // Already in the right group, just ensure collapsed
        await chrome.tabGroups.update(existingGroup.id, { collapsed: true });
        return;
      }

      const groupId = await chrome.tabs.group({
        tabIds: [tab.id],
        ...(existingGroup ? { groupId: existingGroup.id } : {}),
      });

      await chrome.tabGroups.update(groupId, {
        title: TAB_GROUP_TITLE,
        color: TAB_GROUP_COLOR,
        collapsed: true,
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
        openNewTasksTab()
          .then((tab) => sendResponse({ success: true, tabId: tab.id }))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true; // async response

      case "SYNC_TASKS":
        handleSyncTasks()
          .then((result) => sendResponse(result))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;

      case "SYNC_COMPLETE":
        // Store tabId so the options page can show Active/Inactive status
        if (message.email && sender.tab?.id) {
          chrome.storage.local.get("gp_gcal_cache").then((result) => {
            const cache = result["gp_gcal_cache"] ?? {};
            if (cache[message.email]) {
              cache[message.email].tabId = sender.tab.id;
              return chrome.storage.local.set({ "gp_gcal_cache": cache });
            }
          }).catch(() => {});
        }
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
   * Trigger a sync by reloading the tasks tab and waiting for autoSync to complete.
   * Background tabs don't render task DOM unless freshly loaded, so we reload the tab
   * and let the scraper's autoSync (which runs on document_idle) write to the cache.
   * We avoid sending SCRAPE_TASKS via sendMessage to prevent "Receiving end does not exist" errors.
   */
  async function handleSyncTasks() {
    let tabs = await findTasksTabs();

    if (tabs.length === 0) {
      // No tabs yet — open one and wait for it
      const tab = await ensureTasksTab();
      tabs = [tab];
    }

    // Reload all account tabs in parallel so each autoSync fires
    await Promise.all(tabs.map(async (tab) => {
      await chrome.tabs.reload(tab.id);
      await waitForTabLoad(tab.id);
    }));

    // Wait for all autoSyncs to write to cache (one update per account)
    await waitForNCacheUpdates(tabs.length, 6000);

    return { success: true };
  }

  /**
   * Wait until the cache has been updated N times, or until timeout elapses.
   */
  function waitForNCacheUpdates(n, timeout) {
    return new Promise((resolve) => {
      let count = 0;
      const timer = setTimeout(resolve, timeout);
      const listener = (changes, area) => {
        if (area === "local" && changes["gp_gcal_cache"]) {
          count++;
          if (count >= n) {
            clearTimeout(timer);
            chrome.storage.onChanged.removeListener(listener);
            resolve();
          }
        }
      };
      chrome.storage.onChanged.addListener(listener);
    });
  }

  /**
   * Forward a writeback request to the tasks.google.com content script.
   */
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

      // Timeout after 15s
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15000);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
