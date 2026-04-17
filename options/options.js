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

    accountList.innerHTML = "";
    for (const account of accounts) {
      const card = document.createElement("div");
      card.className = "account-card";

      const taskCount = account.taskLists.reduce(
        (sum, tl) => sum + tl.tasks.length, 0
      );
      const listNames = account.taskLists.map((tl) => tl.title).join(", ");
      const syncedAt = account.syncedAt
        ? new Date(account.syncedAt).toLocaleString()
        : "Never";

      card.innerHTML = `
        <div class="account-info">
          <div class="account-email">${escapeHtml(account.email)}</div>
          <div class="account-meta">
            ${taskCount} tasks in ${account.taskLists.length} list(s): ${escapeHtml(listNames)}
          </div>
          <div class="account-sync">Last synced: ${syncedAt}</div>
        </div>
        <div class="account-actions">
          <button class="btn btn-small btn-secondary sync-btn" data-email="${escapeAttr(account.email)}">Sync</button>
          <button class="btn btn-small btn-danger remove-btn" data-email="${escapeAttr(account.email)}">Remove</button>
        </div>
      `;

      accountList.appendChild(card);
    }

    // Event handlers
    accountList.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const email = btn.dataset.email;
        if (confirm(`Remove account "${email}" and its cached tasks?`)) {
          const result = await chrome.storage.local.get(CACHE_KEY);
          const cache = result[CACHE_KEY] ?? {};
          delete cache[email];
          await chrome.storage.local.set({ [CACHE_KEY]: cache });
          render();
        }
      });
    });

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
  }

  // ── Add Account ──────────────────────────────────────────

  addAccountBtn.addEventListener("click", async () => {
    // Open tasks.google.com via the background service worker
    const response = await chrome.runtime.sendMessage({ type: "ENSURE_TASKS_TAB" });
    if (response?.success) {
      syncStatus.textContent = "Opened tasks.google.com — tasks will sync automatically.";
      setTimeout(() => { syncStatus.textContent = ""; }, 5000);

      // Wait a bit and re-render to pick up new data
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
