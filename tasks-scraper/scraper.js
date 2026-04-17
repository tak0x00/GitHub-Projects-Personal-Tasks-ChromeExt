/**
 * tasks.google.com Content Script — Scraper & Writeback
 *
 * Scrapes task lists and tasks from the Google Tasks web UI.
 * Also handles writeback (completing/uncompleting tasks via DOM manipulation).
 *
 * NOTE: Google Tasks DOM selectors are discovered empirically and may break
 * when Google updates their UI. Update selectors as needed.
 */
(() => {
  "use strict";

  const CACHE_KEY = "gp_gcal_cache";

  // ── DOM Selectors ────────────────────────────────────────
  // These selectors target tasks.google.com's current DOM structure.
  // They may need updating if Google changes their UI.

  const SELECTORS = {
    // Active task list container
    taskList: [
      'div[role="list"][aria-label]',   // div.KSMG5.rymPhb role="list" aria-label="アクティブなタスク"
      '.KSMG5[role="list"]',
    ],
    // Active/visible task list name — header text above the list
    taskListTitle: [
      'h2',                            // "マイタスク" heading
      '[jsname] > span',               // fallback
    ],
    // Individual task rows — div.MnEwWd.CkZkVb role="listitem" data-id="..."
    taskRows: [
      'div[role="listitem"][data-id]',  // primary: role + data-id attribute
      'div.MnEwWd[data-id]',           // class-based fallback
      'div.CkZkVb[role="listitem"]',   // alternative class
    ],
    // Task title within a row — the visible text content
    taskTitle: [
      '[contenteditable="true"]',       // editable title field
      '[data-placeholder]',             // field with placeholder attr
      'span[role="link"]',              // fallback
    ],
    // Task completion checkbox — the circle icon on the left
    taskCheckbox: [
      'div[role="checkbox"]',
      'button[role="checkbox"]',
      '[aria-label*="完了"]',            // Japanese: "完了としてマーク"
      '[aria-label*="complete"]',        // English
      '[aria-label*="Complete"]',
      '[aria-label*="Mark"]',
    ],
    // Task details
    taskNotes: [
      '[data-placeholder*="詳細"]',      // Japanese details field
      '[data-placeholder*="Details"]',
      '[contenteditable][aria-label*="detail"]',
    ],
    taskDueDate: [
      '[data-date]',
      '[aria-label*="日付"]',            // Japanese
      '[aria-label*="Date"]',
    ],
    // User account info — Google account button in header
    userEmail: [
      'a[aria-label*="Google アカウント"]',  // Japanese
      'a[aria-label*="Google Account"]',      // English
      '[data-email]',
      'img[data-profileimagefallback]',
    ],
  };

  /**
   * Try multiple selectors and return the first match.
   */
  function querySelector(parent, selectorList) {
    for (const sel of selectorList) {
      const el = parent.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function querySelectorAll(parent, selectorList) {
    for (const sel of selectorList) {
      const els = parent.querySelectorAll(sel);
      if (els.length > 0) return Array.from(els);
    }
    return [];
  }

  // ── Account Detection ────────────────────────────────────

  function detectAccountEmail() {
    // Try to find email from Google account widget
    for (const sel of SELECTORS.userEmail) {
      const el = document.querySelector(sel);
      if (el) {
        const label = el.getAttribute("aria-label") ?? "";
        const emailMatch = label.match(/[\w.+-]+@[\w.-]+/);
        if (emailMatch) return emailMatch[0];

        const dataEmail = el.getAttribute("data-email");
        if (dataEmail) return dataEmail;
      }
    }

    // Try meta tags
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta) {
      // Can't get email from client_id, but presence indicates logged in
    }

    // Fallback: extract from URL or cookies
    return "unknown@account";
  }

  // ── Task Scraping ────────────────────────────────────────

  function scrapeCurrentTaskList() {
    const title = getTaskListTitle();
    const tasks = scrapeTaskRows();
    return { title: title ?? "Tasks", tasks };
  }

  function getTaskListTitle() {
    for (const sel of SELECTORS.taskListTitle) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim()) return el.textContent.trim();
    }
    return null;
  }

  function scrapeTaskRows() {
    const rows = querySelectorAll(document, SELECTORS.taskRows);
    const tasks = [];

    for (const row of rows) {
      const titleEl = querySelector(row, SELECTORS.taskTitle);
      const rawTitle = titleEl?.textContent?.trim() ?? "";
      const titlePlaceholder = titleEl?.getAttribute("data-placeholder") ?? "";
      // Skip if empty or if text is just the placeholder
      const title = (rawTitle && rawTitle !== titlePlaceholder) ? rawTitle : "";
      if (!title) continue;

      // Detect completed tasks:
      // 1. checkbox aria-checked
      // 2. row or ancestor has completed-related styling/class
      // 3. row is inside a "completed" section (折りたたみ「完了」セクション)
      const checkboxEl = querySelector(row, SELECTORS.taskCheckbox);
      const isCompleted =
        checkboxEl?.getAttribute("aria-checked") === "true" ||
        checkboxEl?.classList.contains("checked") ||
        row.classList.contains("completed") ||
        row.closest('[aria-label*="完了"]') !== null ||
        row.closest('[aria-label*="Completed"]') !== null ||
        row.closest('[data-completed="true"]') !== null ||
        // Check if the row has strikethrough text (common for completed tasks)
        (titleEl && getComputedStyle(titleEl).textDecoration.includes("line-through"));

      const notesEl = querySelector(row, SELECTORS.taskNotes);
      const dueDateEl = querySelector(row, SELECTORS.taskDueDate);

      // Read notes carefully: contenteditable fields show placeholder text
      // when empty, so only read if there's actual user content
      let notes = "";
      if (notesEl) {
        const hasPlaceholder = notesEl.hasAttribute("data-placeholder");
        const text = notesEl.textContent?.trim() ?? "";
        const placeholder = notesEl.getAttribute("data-placeholder") ?? "";
        // If the text matches the placeholder, it's empty
        if (text && text !== placeholder) {
          notes = text;
        }
      }

      // Use data-id attribute (e.g. "86ri0OoHBh7YRcTh") or generate stable ID
      const id = row.getAttribute("data-id") ?? row.getAttribute("data-task-id") ?? generateStableId(title);

      tasks.push({
        id,
        title,
        notes,
        due: dueDateEl?.textContent?.trim() ?? "",
        completed: isCompleted,
      });
    }

    return tasks;
  }

  function generateStableId(title) {
    // Simple hash for stable identification
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
    }
    return "gpt_" + Math.abs(hash).toString(36);
  }

  // ── Cache ────────────────────────────────────────────────

  async function saveToCache(email, taskListData) {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] ?? {};

    if (!cache[email]) {
      cache[email] = { email, syncedAt: 0, taskLists: [] };
    }

    // Update or add the task list
    const existing = cache[email].taskLists.findIndex(
      (tl) => tl.title === taskListData.title
    );
    if (existing >= 0) {
      cache[email].taskLists[existing] = taskListData;
    } else {
      cache[email].taskLists.push(taskListData);
    }

    cache[email].syncedAt = Date.now();
    await chrome.storage.local.set({ [CACHE_KEY]: cache });

    return cache[email];
  }

  // ── Writeback ────────────────────────────────────────────

  function completeTask(taskId) {
    return toggleTaskCompletion(taskId, true);
  }

  function uncompleteTask(taskId) {
    return toggleTaskCompletion(taskId, false);
  }

  async function toggleTaskCompletion(taskId, shouldComplete) {
    let rows = querySelectorAll(document, SELECTORS.taskRows);

    // If uncompleting, the task is in the collapsed "完了" section.
    // We need to expand it first and wait for DOM to render.
    if (!shouldComplete) {
      const found = findTaskRow(rows, taskId);

      if (!found) {
        // Expand completed section using aria-label (actual DOM attribute)
        const expandBtn = document.querySelector(
          'button[aria-label*="完了したタスクのリスト"][aria-expanded="false"]'
        ) ?? document.querySelector(
          'button[aria-label*="Completed tasks"][aria-expanded="false"]'
        ) ?? document.querySelector(
          'button[aria-label*="completed"][aria-expanded="false"]'
        );

        if (expandBtn) {
          expandBtn.click();
          // Wait for the completed section to render
          await new Promise((resolve) => setTimeout(resolve, 500));
          rows = querySelectorAll(document, SELECTORS.taskRows);
        }
      }
    }

    const row = findTaskRow(rows, taskId);
    if (!row) {
      return { success: false, error: "Task not found: " + taskId };
    }

    const checkbox = querySelector(row, SELECTORS.taskCheckbox);
    if (!checkbox) {
      return { success: false, error: "Checkbox not found for task" };
    }

    const isCompleted =
      checkbox.getAttribute("aria-checked") === "true" ||
      checkbox.classList.contains("checked");

    if (isCompleted === shouldComplete) {
      return { success: true, alreadyInState: true };
    }

    checkbox.click();
    return { success: true };
  }

  function findTaskRow(rows, taskId) {
    for (const row of rows) {
      const rowId = row.getAttribute("data-id") ?? row.getAttribute("data-task-id") ?? "";
      const titleEl = querySelector(row, SELECTORS.taskTitle);
      const title = titleEl?.textContent?.trim() ?? "";
      const stableId = generateStableId(title);
      if (rowId === taskId || stableId === taskId) return row;
    }
    return null;
  }

  // ── Auto Sync on Page Load ───────────────────────────────

  async function autoSync() {
    // Wait for tasks to render
    await waitForTasks();

    const email = detectAccountEmail();
    const taskListData = scrapeCurrentTaskList();

    await saveToCache(email, taskListData);

    try {
      await chrome.runtime.sendMessage({
        type: "SYNC_COMPLETE",
        email,
        taskCount: taskListData.tasks.length,
      });
    } catch { /* SW inactive or extension context invalidated after reload */ }
  }

  function waitForTasks() {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        const rows = querySelectorAll(document, SELECTORS.taskRows);
        if (rows.length > 0 || attempts > 20) {
          resolve();
          return;
        }
        attempts++;
        setTimeout(check, 500);
      };
      check();
    });
  }

  // ── Message Listener ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    switch (message.type) {
      case "SCRAPE_TASKS": {
        (async () => {
          await waitForTasks();
          const email = detectAccountEmail();
          const taskListData = scrapeCurrentTaskList();
          const cached = await saveToCache(email, taskListData);
          sendResponse({
            success: true,
            email,
            taskCount: taskListData.tasks.length,
          });
        })();
        return true;
      }

      case "COMPLETE_TASK": {
        completeTask(message.gcalSource?.taskId)
          .then((result) => sendResponse(result))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true; // async
      }

      case "UNCOMPLETE_TASK": {
        uncompleteTask(message.gcalSource?.taskId)
          .then((result) => sendResponse(result))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true; // async
      }

      case "GET_CURRENT_EMAIL": {
        sendResponse({ email: detectAccountEmail() });
        return false;
      }

      default:
        return false;
    }
  });

  // ── Indicator Badge ──────────────────────────────────────

  function injectSyncIndicator() {
    if (document.querySelector(".gp-sync-indicator")) return;

    const badge = document.createElement("div");
    badge.className = "gp-sync-indicator";
    badge.style.cssText = `
      position: fixed; bottom: 16px; right: 16px; z-index: 99999;
      background: #8b5cf6; color: #fff; padding: 6px 12px;
      border-radius: 8px; font-size: 12px; font-family: sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3); opacity: 0.9;
      cursor: default; user-select: none;
    `;
    badge.textContent = "✓ GP Tasks synced";
    document.body.appendChild(badge);

    // Fade out after 3 seconds
    setTimeout(() => {
      badge.style.transition = "opacity 0.5s ease";
      badge.style.opacity = "0";
      setTimeout(() => badge.remove(), 500);
    }, 3000);
  }

  // ── Init ─────────────────────────────────────────────────

  autoSync().then(() => {
    injectSyncIndicator();
  });
})();
