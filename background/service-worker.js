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
   * Ensure a tasks.google.com tab exists in the GP Tasks tab group.
   * Returns the tab.
   */
  async function ensureTasksTab() {
    const existingTabs = await findTasksTabs();

    if (existingTabs.length > 0) {
      // Already have a tasks tab, ensure it's in a group
      const tab = existingTabs[0];
      await ensureTabInGroup(tab);
      return tab;
    }

    // Create a new tab (inactive)
    const tab = await chrome.tabs.create({
      url: TASKS_URL,
      active: false,
    });

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
        ensureTasksTab()
          .then((tab) => sendResponse({ success: true, tabId: tab.id }))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true; // async response

      case "SYNC_TASKS":
        handleSyncTasks()
          .then((result) => sendResponse(result))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;

      case "SYNC_COMPLETE":
        // Scraper finished syncing — just acknowledge
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
   * Trigger a sync by ensuring the tasks tab exists and sending it a scrape request.
   */
  async function handleSyncTasks() {
    const tab = await ensureTasksTab();

    // Wait for the tab to finish loading
    if (tab.status !== "complete") {
      await waitForTabLoad(tab.id);
    }

    // Send scrape request to the content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_TASKS" });
      return response ?? { success: true };
    } catch (e) {
      // Content script may not be ready yet — reload and retry
      await chrome.tabs.reload(tab.id);
      await waitForTabLoad(tab.id);
      await sleep(1000);
      const response = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_TASKS" });
      return response ?? { success: true };
    }
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
