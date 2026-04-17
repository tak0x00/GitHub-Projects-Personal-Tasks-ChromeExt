(() => {
  "use strict";

  const STORAGE_KEY = "gp_personal_tasks";

  async function loadAll() {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    return result[STORAGE_KEY] ?? [];
  }

  async function saveAll(tasks) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: tasks });
  }

  async function addTask(title, status, projectUrl, description = "", color = "#8b5cf6") {
    const task = {
      id: crypto.randomUUID(),
      title,
      description,
      status,
      projectUrl,
      color,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const all = await loadAll();
    all.push(task);
    await saveAll(all);
    return task;
  }

  async function deleteTask(id) {
    const all = await loadAll();
    await saveAll(all.filter((t) => t.id !== id));
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── DOM refs ─────────────────────────────────────────────

  const taskList = document.getElementById("taskList");
  const taskCount = document.getElementById("taskCount");
  const quickTitle = document.getElementById("quickTitle");
  const quickStatus = document.getElementById("quickStatus");
  const toggleVisibility = document.getElementById("toggleVisibility");
  const syncBtn = document.getElementById("syncBtn");
  const syncStatus = document.getElementById("syncStatus");
  const openSettings = document.getElementById("openSettings");

  // ── Render ───────────────────────────────────────────────

  async function render() {
    const tasks = await loadAll();
    taskCount.textContent = String(tasks.length);

    if (tasks.length === 0) {
      taskList.innerHTML = '<div class="empty-state">No tasks yet. Add one above!</div>';
      return;
    }

    const grouped = new Map();
    for (const task of tasks) {
      const list = grouped.get(task.status) ?? [];
      list.push(task);
      grouped.set(task.status, list);
    }

    taskList.innerHTML = "";
    for (const [status, statusTasks] of grouped) {
      const section = document.createElement("div");
      section.className = "task-group";
      section.innerHTML = `<h3>${escapeHtml(status)} <span class="group-count">${statusTasks.length}</span></h3>`;

      for (const task of statusTasks) {
        const item = document.createElement("div");
        item.className = "task-item";
        const isGcal = !!task.gcalSource;
        item.style.borderLeftColor = isGcal ? "#4285f4" : (task.color || "#8b5cf6");
        const badge = isGcal
          ? '<span class="task-item-badge task-item-badge-gcal">GCal</span>'
          : '';
        item.innerHTML = `
          <div class="task-item-title">${badge}${escapeHtml(task.title)}</div>
          <div class="task-item-project">${escapeHtml(task.projectUrl)}</div>
          <button class="task-item-delete" data-id="${task.id}" title="Delete">&times;</button>
        `;
        section.appendChild(item);
      }

      taskList.appendChild(section);
    }

    taskList.querySelectorAll(".task-item-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        await deleteTask(e.target.dataset.id);
        render();
      });
    });
  }

  // ── Quick Add ────────────────────────────────────────────

  quickTitle.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const title = quickTitle.value.trim();
    if (!title) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? "";
    const match = url.match(/\/(orgs|users)\/[^/]+\/projects\/\d+/);
    const projectUrl = match ? match[0] : "/unknown";

    await addTask(title, quickStatus.value, projectUrl);
    quickTitle.value = "";
    render();
  });

  // ── Visibility Toggle ───────────────────────────────────

  toggleVisibility.addEventListener("change", () => {
    chrome.storage.sync.set({ gp_visible: toggleVisibility.checked });
  });

  chrome.storage.sync.get("gp_visible", (result) => {
    toggleVisibility.checked = result.gp_visible !== false;
  });

  // ── Sync Google Tasks ─────────────────────────────────────

  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    syncStatus.textContent = "Syncing...";
    try {
      const response = await chrome.runtime.sendMessage({ type: "SYNC_TASKS" });
      syncStatus.textContent = response?.success ? "Synced!" : "Failed";
    } catch {
      syncStatus.textContent = "Error";
    }
    syncBtn.disabled = false;
    setTimeout(() => { syncStatus.textContent = ""; }, 3000);
  });

  // ── Settings Link ───────────────────────────────────────

  openSettings.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // ── Init ─────────────────────────────────────────────────

  render();
  quickTitle.focus();
})();
