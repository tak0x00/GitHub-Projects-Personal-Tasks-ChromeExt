(() => {
  "use strict";

  const CACHE_KEY = "gp_gcal_cache";
  const accountList = document.getElementById("accountList");
  const addAccountBtn = document.getElementById("addAccountBtn");
  const syncAllBtn = document.getElementById("syncAllBtn");
  const syncStatus = document.getElementById("syncStatus");
  const showOnBoard = document.getElementById("showOnBoard");

  // ── Render Accounts ──────────────────────────────────────

  async function render() {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cache = result[CACHE_KEY] ?? {};
    const accounts = Object.values(cache);

    if (accounts.length === 0) {
      accountList.innerHTML = '<div class="empty-state">No accounts synced yet.</div>';
      return;
    }

    // Active = email currently shown in the first GP Tasks group tab (real-time query).
    let activeEmail = null;
    try {
      const r = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_ACCOUNT" });
      activeEmail = r?.email ?? null;
    } catch {}

    accountList.innerHTML = "";
    for (const account of accounts) {
      const isActive = account.email === activeEmail;
      const card = document.createElement("div");
      card.className = "account-card";

      const taskCount = account.taskLists.reduce(
        (sum, tl) => sum + tl.tasks.length, 0
      );
      const listNames = account.taskLists.map((tl) => tl.title).join(", ");
      const syncedAt = account.syncedAt
        ? new Date(account.syncedAt).toLocaleString()
        : "Never";

      const statusBadge = isActive
        ? '<span class="account-status status-active">Active</span>'
        : '<span class="account-status status-inactive">Inactive</span>';

      const actionBtn = isActive
        ? `<button class="btn btn-small btn-secondary sync-btn" data-email="${escapeAttr(account.email)}">Sync</button>`
        : ``;

      card.innerHTML = `
        <div class="account-info">
          <div class="account-email">${escapeHtml(account.email)} ${statusBadge}</div>
          <div class="account-meta">
            ${taskCount} tasks in ${account.taskLists.length} list(s): ${escapeHtml(listNames)}
          </div>
          <div class="account-sync">Last synced: ${syncedAt}</div>
        </div>
        <div class="account-actions">
          ${actionBtn}
          <button class="btn btn-small btn-danger remove-btn" data-email="${escapeAttr(account.email)}">Remove</button>
        </div>
      `;

      accountList.appendChild(card);
    }

    // Remove button — convert imported tasks to local before deleting
    accountList.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const email = btn.dataset.email;
        if (confirm(`Remove account "${email}"?\n\nTasks imported from this account will be kept as local tasks (Google Tasks link will be removed).`)) {
          // Convert imported tasks from this account to local (remove gcalSource)
          const syncResult = await chrome.storage.sync.get("gp_personal_tasks");
          const tasks = syncResult["gp_personal_tasks"] ?? [];
          let changed = false;
          const updated = tasks.map((t) => {
            if (t.gcalSource?.email === email) {
              changed = true;
              const { gcalSource, ...rest } = t;
              return { ...rest, color: rest.color || "#8b5cf6" };
            }
            return t;
          });
          if (changed) {
            await chrome.storage.sync.set({ "gp_personal_tasks": updated });
          }

          // Remove account from cache
          const localResult = await chrome.storage.local.get(CACHE_KEY);
          const cache = localResult[CACHE_KEY] ?? {};
          delete cache[email];
          await chrome.storage.local.set({ [CACHE_KEY]: cache });
          render();
        }
      });
    });

    // Sync button (active accounts)
    accountList.querySelectorAll(".sync-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        syncStatus.textContent = "Syncing...";
        const response = await chrome.runtime.sendMessage({ type: "SYNC_TASKS" });
        syncStatus.textContent = response?.success
          ? "Synced!"
          : "Sync failed: " + (response?.error ?? "unknown");
        setTimeout(() => { syncStatus.textContent = ""; }, 3000);
        render();
      });
    });

    // Button states:
    //   active account exists  → hidden
    //   accounts exist but all inactive → "Open Sync Tab"
    //   no accounts yet        → "+ Add Account"
    if (activeEmail) {
      addAccountBtn.style.display = "none";
    } else {
      addAccountBtn.style.display = "";
      addAccountBtn.textContent = accounts.length > 0 ? "Open Sync Tab" : "+ Add Account";
    }
  }

  // ── Add Account ──────────────────────────────────────────

  addAccountBtn.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "ENSURE_TASKS_TAB" });
    if (response?.success) {
      syncStatus.textContent = "Opened tasks.google.com — tasks will sync automatically.";
      setTimeout(() => { syncStatus.textContent = ""; }, 5000);
      setTimeout(render, 3000);
    }
  });

  // ── Sync All ─────────────────────────────────────────────

  syncAllBtn.addEventListener("click", async () => {
    syncStatus.textContent = "Syncing...";
    const response = await chrome.runtime.sendMessage({ type: "SYNC_TASKS" });
    syncStatus.textContent = response?.success
      ? "Synced!"
      : "Sync failed: " + (response?.error ?? "unknown");
    setTimeout(() => { syncStatus.textContent = ""; }, 3000);
    render();
  });

  // ── Display Toggle ───────────────────────────────────────

  chrome.storage.sync.get("gp_visible", (result) => {
    showOnBoard.checked = result.gp_visible !== false;
  });

  showOnBoard.addEventListener("change", () => {
    chrome.storage.sync.set({ gp_visible: showOnBoard.checked });
  });

  // ── Listen for storage changes ───────────────────────────

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[CACHE_KEY]) {
      render();
    }
  });

  // ── Utilities ────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Init ─────────────────────────────────────────────────
  render();
})();
