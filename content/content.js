/**
 * GitHub Projects Personal Tasks - Content Script
 * Injects personal task cards into GitHub Projects board views.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "gp_personal_tasks";
  const CARD_CLASS = "gp-personal-task-card";
  const ADD_BTN_CLASS = "gp-personal-task-add-btn";
  const MODAL_CLASS = "gp-personal-task-modal";
  const TOGGLE_CLASS = "gp-personal-task-toggle";
  const DEFAULT_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899"];
  const DEFAULT_COLOR = DEFAULT_COLORS[0];

  // ── Storage ──────────────────────────────────────────────

  async function loadAll() {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    return result[STORAGE_KEY] ?? [];
  }

  async function saveAll(tasks) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: tasks });
  }

  async function getTasks(projectUrl) {
    const all = await loadAll();
    return all.filter((t) => t.projectUrl === projectUrl);
  }

  async function addTask(title, status, projectUrl, description = "", color = DEFAULT_COLOR, gcalSource = null) {
    const task = {
      id: crypto.randomUUID(),
      title,
      description,
      status,
      projectUrl,
      color,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      gcalSource,
    };
    const all = await loadAll();
    all.push(task);
    await saveAll(all);
    return task;
  }

  async function updateTask(id, updates) {
    const all = await loadAll();
    const idx = all.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    Object.assign(all[idx], updates, { updatedAt: Date.now() });
    await saveAll(all);
    return all[idx];
  }

  async function deleteTask(id) {
    const all = await loadAll();
    const filtered = all.filter((t) => t.id !== id);
    if (filtered.length === all.length) return false;
    await saveAll(filtered);
    return true;
  }

  // ── Context Guard ────────────────────────────────────────

  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  // ── GitHub DOM Helpers ───────────────────────────────────

  function isProjectBoardView() {
    return /\/(orgs|users)\/[^/]+\/projects\/\d+/.test(window.location.pathname);
  }

  function getProjectUrl() {
    const match = window.location.pathname.match(/\/(orgs|users)\/[^/]+\/projects\/\d+/);
    return match ? match[0] : window.location.pathname;
  }

  function getBoardColumns() {
    const columns = [];

    // Primary: GitHub Projects V2 uses data-board-column attribute on column containers
    // DOM structure: div[data-board-column="Backlog"][data-dnd-drop-type="column"]
    const columnElements = document.querySelectorAll("[data-board-column]");
    if (columnElements.length > 0) {
      columnElements.forEach((el) => {
        const name = el.getAttribute("data-board-column");
        if (name) columns.push({ element: el, name });
      });
      return columns;
    }

    // Fallback selectors for other layouts
    const fallbackSelectors = [
      '[data-testid="board-view-column"]',
      ".ProjectBoard-column",
    ];

    for (const selector of fallbackSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        elements.forEach((el) => {
          const name = getColumnName(el);
          if (name) columns.push({ element: el, name });
        });
        return columns;
      }
    }

    return columns;
  }

  function getColumnName(columnEl) {
    // First check data-board-column attribute (primary method)
    const dataName = columnEl.getAttribute("data-board-column");
    if (dataName) return dataName;

    // Fallback: search for header text
    const headerSelectors = [
      '[data-testid="board-view-column-header"] span',
      '[data-testid="column-header-text"]',
      "h3",
      '[role="columnheader"]',
    ];

    for (const selector of headerSelectors) {
      const header = columnEl.querySelector(selector);
      if (header) {
        const text = header.textContent?.trim();
        if (text) return text;
      }
    }
    return null;
  }

  function getColumnCardList(columnEl) {
    // Primary: GitHub Projects uses data-dnd-drop-type="card" for the card drop zone
    // DOM: div.column-drop-zone[data-dnd-drop-type="card"]
    const dropZone = columnEl.querySelector('[data-dnd-drop-type="card"]');
    if (dropZone) return dropZone;

    // Fallback selectors
    const selectors = [
      '[data-testid="board-view-column-items"]',
      '[role="list"]',
      ".ProjectBoard-columnItems",
    ];
    for (const selector of selectors) {
      const list = columnEl.querySelector(selector);
      if (list) return list;
    }
    return columnEl;
  }

  // ── Toggle Button ────────────────────────────────────────

  async function injectToggleButton() {
    if (!isContextValid()) return;
    if (document.querySelector(`.${TOGGLE_CLASS}`)) return;

    // Insert near the board header area
    const headerBar =
      document.querySelector('[data-testid="board-view-filter-bar"]') ??
      document.querySelector(".Board-module__boardHeaderContainer") ??
      document.querySelector('[data-hpc] > div > div');

    const anchor = headerBar ?? document.querySelector('[data-board-column]')?.parentElement;
    if (!anchor) return;

    const { gp_visible } = await chrome.storage.sync.get("gp_visible");
    const visible = gp_visible !== false;

    const btn = document.createElement("button");
    btn.className = TOGGLE_CLASS;
    btn.title = visible ? "Hide personal tasks" : "Show personal tasks";
    btn.innerHTML = `<span class="gp-toggle-icon">${visible ? "👤" : "👤"}</span><span class="gp-toggle-label">${visible ? "Personal: ON" : "Personal: OFF"}</span>`;
    btn.classList.toggle("gp-toggle-off", !visible);

    btn.addEventListener("click", async () => {
      const { gp_visible: current } = await chrome.storage.sync.get("gp_visible");
      const next = current === false;
      await chrome.storage.sync.set({ gp_visible: next });
      btn.title = next ? "Hide personal tasks" : "Show personal tasks";
      btn.querySelector(".gp-toggle-label").textContent = next ? "Personal: ON" : "Personal: OFF";
      btn.classList.toggle("gp-toggle-off", !next);
      injectCards();
    });

    isSelfMutation = true;
    if (headerBar) {
      headerBar.appendChild(btn);
    } else {
      anchor.insertBefore(btn, anchor.firstChild);
    }
    isSelfMutation = false;
  }

  // ── Card Injection ───────────────────────────────────────

  function clearInjectedCards() {
    document.querySelectorAll(`.${CARD_CLASS}, .${ADD_BTN_CLASS}`).forEach((el) => el.remove());
  }

  let injectLock = false;

  async function injectCards() {
    // Prevent concurrent runs — if already injecting, skip
    if (injectLock || !isContextValid()) return;
    injectLock = true;
    isSelfMutation = true;

    try {
      // Check visibility setting
      const { gp_visible } = await chrome.storage.sync.get("gp_visible");
      if (gp_visible === false) {
        clearInjectedCards();
        return;
      }

      clearInjectedCards();
      const projectUrl = getProjectUrl();
      const tasks = await getTasks(projectUrl);
      const columns = getBoardColumns();

      if (columns.length === 0) return;

      for (const col of columns) {
        const cardList = getColumnCardList(col.element);
        if (!cardList) continue;

        const columnTasks = tasks.filter((t) => t.status === col.name);
        for (const task of columnTasks) {
          cardList.appendChild(createTaskCard(task));
        }

        cardList.appendChild(createAddButton(col.name, projectUrl));
      }
    } finally {
      isSelfMutation = false;
      injectLock = false;
    }
  }

  function createTaskCard(task) {
    const card = document.createElement("div");
    card.className = CARD_CLASS;
    card.dataset.taskId = task.id;
    card.draggable = true;

    const isGcal = !!task.gcalSource;
    card.style.borderLeftColor = isGcal ? "#4285f4" : task.color;

    const badgeClass = isGcal ? "gp-task-badge gp-task-badge-gcal" : "gp-task-badge";
    const badgeText = isGcal ? "Google Tasks" : "Personal";

    card.innerHTML = `
      <div class="gp-task-header">
        <span class="${badgeClass}">${badgeText}</span>
        <button class="gp-task-delete" title="Delete task">&times;</button>
      </div>
      <div class="gp-task-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<div class="gp-task-desc">${escapeHtml(task.description)}</div>` : ""}
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest(".gp-task-delete")) return;
      openEditModal(task);
    });

    card.querySelector(".gp-task-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${task.title}"?`)) {
        await deleteTask(task.id);
        injectCards();
      }
    });

    card.addEventListener("dragstart", (e) => {
      isDragging = true;
      e.dataTransfer.setData("text/plain", task.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("gp-task-dragging");
    });

    card.addEventListener("dragend", () => {
      isDragging = false;
      card.classList.remove("gp-task-dragging");
    });

    return card;
  }

  function createAddButton(columnName, projectUrl) {
    const wrapper = document.createElement("div");
    wrapper.className = ADD_BTN_CLASS;

    const btn = document.createElement("button");
    btn.className = "gp-add-btn-main";
    btn.textContent = "+ Add personal task";

    const menu = document.createElement("div");
    menu.className = "gp-add-menu";
    menu.style.display = "none";
    menu.innerHTML = `
      <button class="gp-add-menu-item" data-action="create">Create new</button>
      <button class="gp-add-menu-item gp-add-menu-import" data-action="import">Import from Google Tasks</button>
    `;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = menu.style.display !== "none";
      // Close all other menus first
      document.querySelectorAll(".gp-add-menu").forEach((m) => (m.style.display = "none"));
      menu.style.display = isVisible ? "none" : "block";
    });

    menu.querySelector('[data-action="create"]').addEventListener("click", (e) => {
      e.stopPropagation();
      menu.style.display = "none";
      openAddModal(columnName, projectUrl);
    });

    menu.querySelector('[data-action="import"]').addEventListener("click", (e) => {
      e.stopPropagation();
      menu.style.display = "none";
      openImportModal(columnName, projectUrl);
    });

    // Close menu on outside click
    document.addEventListener("click", () => { menu.style.display = "none"; });

    wrapper.appendChild(btn);
    wrapper.appendChild(menu);
    return wrapper;
  }

  // ── Drop Zones ───────────────────────────────────────────

  function setupDropZones() {
    const columns = getBoardColumns();
    for (const col of columns) {
      const cardList = getColumnCardList(col.element);
      if (!cardList || cardList.dataset.gpDropSetup) continue;
      cardList.dataset.gpDropSetup = "true";

      cardList.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        cardList.classList.add("gp-drop-target");
      });

      cardList.addEventListener("dragleave", () => {
        cardList.classList.remove("gp-drop-target");
      });

      cardList.addEventListener("drop", async (e) => {
        e.preventDefault();
        cardList.classList.remove("gp-drop-target");
        const taskId = e.dataTransfer.getData("text/plain");
        if (taskId) {
          const updated = await updateTask(taskId, { status: col.name });
          injectCards();

          // Writeback for Google Tasks imported cards
          if (updated?.gcalSource && isContextValid()) {
            const isDone = col.name.toLowerCase() === "done";
            chrome.runtime.sendMessage({
              type: isDone ? "WRITEBACK_DONE" : "WRITEBACK_UNDONE",
              gcalSource: updated.gcalSource,
            });
          }
        }
      });
    }
  }

  // ── Modals ───────────────────────────────────────────────

  function openAddModal(status, projectUrl) {
    openTaskModal({
      title: "",
      description: "",
      color: DEFAULT_COLOR,
      async onSave(title, description, color) {
        await addTask(title, status, projectUrl, description, color);
        injectCards();
      },
    });
  }

  function openEditModal(task) {
    openTaskModal({
      title: task.title,
      description: task.description,
      color: task.color,
      async onSave(title, description, color) {
        await updateTask(task.id, { title, description, color });
        injectCards();
      },
    });
  }

  // ── Import Modal ──────────────────────────────────────────

  async function openImportModal(status, projectUrl) {
    document.querySelector(`.${MODAL_CLASS}`)?.remove();

    const overlay = document.createElement("div");
    overlay.className = MODAL_CLASS;

    overlay.innerHTML = `
      <div class="gp-modal-content gp-import-modal">
        <h3>Import from Google Tasks</h3>
        <div class="gp-import-loading">Loading tasks...</div>
        <div class="gp-import-body" style="display:none">
          <div class="gp-import-account-select"></div>
          <div class="gp-import-task-list"></div>
        </div>
        <div class="gp-import-empty" style="display:none">
          <p>No Google Tasks found.</p>
          <p class="gp-import-help">Open <strong>tasks.google.com</strong> to sync your tasks, or click "Sync Now" below.</p>
          <button class="gp-import-sync-btn">Sync Now</button>
        </div>
        <div class="gp-modal-actions" style="display:none">
          <button class="gp-modal-cancel">Cancel</button>
          <button class="gp-modal-save gp-import-btn" disabled>Import Selected</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector(".gp-modal-cancel")?.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Sync button for empty state
    overlay.querySelector(".gp-import-sync-btn")?.addEventListener("click", async () => {
      overlay.querySelector(".gp-import-empty").style.display = "none";
      overlay.querySelector(".gp-import-loading").style.display = "block";
      await chrome.runtime.sendMessage({ type: "SYNC_TASKS" });
      // Wait for sync
      await new Promise((r) => setTimeout(r, 2000));
      await populateImportModal(overlay, status, projectUrl);
    });

    // Load cached tasks
    await populateImportModal(overlay, status, projectUrl);
  }

  async function populateImportModal(overlay, status, projectUrl) {
    const loading = overlay.querySelector(".gp-import-loading");
    const body = overlay.querySelector(".gp-import-body");
    const empty = overlay.querySelector(".gp-import-empty");
    const actions = overlay.querySelector(".gp-modal-actions");

    // Get cached data
    const response = await chrome.runtime.sendMessage({ type: "GET_CACHED_TASKS" });
    const cache = response?.cache ?? {};
    const accounts = Object.values(cache);

    // Get existing imported task IDs for this project
    const existingTasks = await getTasks(projectUrl);
    const importedIds = new Set(
      existingTasks
        .filter((t) => t.gcalSource)
        .map((t) => t.gcalSource.taskId)
    );

    loading.style.display = "none";

    if (accounts.length === 0 || accounts.every((a) => a.taskLists.length === 0)) {
      empty.style.display = "block";
      return;
    }

    body.style.display = "block";
    actions.style.display = "flex";

    // Account selector (if multiple)
    const accountSelect = overlay.querySelector(".gp-import-account-select");
    if (accounts.length > 1) {
      accountSelect.innerHTML = `
        <label>Account
          <select class="gp-import-account-dropdown">
            ${accounts.map((a) => `<option value="${escapeAttr(a.email)}">${escapeHtml(a.email)}</option>`).join("")}
          </select>
        </label>
      `;
      accountSelect.querySelector("select").addEventListener("change", () => {
        renderTaskList(overlay, accounts, importedIds, projectUrl);
      });
    } else {
      accountSelect.innerHTML = `<div class="gp-import-account-label">${escapeHtml(accounts[0].email)}</div>`;
    }

    renderTaskList(overlay, accounts, importedIds, projectUrl);

    // Import button handler
    const importBtn = overlay.querySelector(".gp-import-btn");
    importBtn.addEventListener("click", async () => {
      const checked = overlay.querySelectorAll('.gp-import-checkbox:checked');
      if (checked.length === 0) return;

      const selectedEmail = overlay.querySelector(".gp-import-account-dropdown")?.value ?? accounts[0].email;

      for (const cb of checked) {
        const taskData = JSON.parse(cb.dataset.task);
        await addTask(
          taskData.title,
          status,
          projectUrl,
          taskData.notes ?? "",
          "#4285f4", // Google blue
          {
            email: selectedEmail,
            taskListTitle: cb.dataset.listTitle,
            taskId: taskData.id,
            importedProjectUrl: projectUrl,
          }
        );
      }

      overlay.remove();
      injectCards();
    });
  }

  function renderTaskList(overlay, accounts, importedIds, projectUrl) {
    const selectedEmail = overlay.querySelector(".gp-import-account-dropdown")?.value ?? accounts[0].email;
    const account = accounts.find((a) => a.email === selectedEmail);
    if (!account) return;

    const listContainer = overlay.querySelector(".gp-import-task-list");
    const importBtn = overlay.querySelector(".gp-import-btn");

    let html = "";
    for (const taskList of account.taskLists) {
      const incompleteTasks = taskList.tasks.filter((t) => !t.completed);
      if (incompleteTasks.length === 0) continue;

      html += `<div class="gp-import-list-group">
        <div class="gp-import-list-title">${escapeHtml(taskList.title)}</div>`;

      for (const task of incompleteTasks) {
        const alreadyImported = importedIds.has(task.id);
        const disabled = alreadyImported ? "disabled" : "";
        const label = alreadyImported ? " (already imported)" : "";

        html += `
          <label class="gp-import-task-row ${alreadyImported ? "gp-import-disabled" : ""}">
            <input type="checkbox" class="gp-import-checkbox" ${disabled}
              data-task='${escapeAttr(JSON.stringify(task))}'
              data-list-title="${escapeAttr(taskList.title)}">
            <span class="gp-import-task-title">${escapeHtml(task.title)}${label}</span>
            ${task.due ? `<span class="gp-import-task-due">${escapeHtml(task.due)}</span>` : ""}
          </label>`;
      }

      html += "</div>";
    }

    if (!html) {
      html = '<div class="gp-import-no-tasks">No incomplete tasks found.</div>';
    }

    listContainer.innerHTML = html;

    // Update import button state on checkbox change
    listContainer.querySelectorAll(".gp-import-checkbox").forEach((cb) => {
      cb.addEventListener("change", () => {
        const anyChecked = listContainer.querySelector(".gp-import-checkbox:checked");
        importBtn.disabled = !anyChecked;
      });
    });
  }

  // ── Task Modal (Create/Edit) ─────────────────────────────

  function openTaskModal(opts) {
    document.querySelector(`.${MODAL_CLASS}`)?.remove();

    const overlay = document.createElement("div");
    overlay.className = MODAL_CLASS;

    const colorOptions = DEFAULT_COLORS.map(
      (c) =>
        `<label class="gp-color-option">
          <input type="radio" name="gp-task-color" value="${c}" ${c === opts.color ? "checked" : ""}>
          <span class="gp-color-swatch" style="background:${c}"></span>
        </label>`
    ).join("");

    overlay.innerHTML = `
      <div class="gp-modal-content">
        <h3>${opts.title ? "Edit Task" : "Add Personal Task"}</h3>
        <label>
          Title
          <input type="text" class="gp-modal-title" value="${escapeAttr(opts.title)}" placeholder="Task title..." autofocus>
        </label>
        <label>
          Description
          <textarea class="gp-modal-desc" placeholder="Optional description...">${escapeHtml(opts.description)}</textarea>
        </label>
        <div class="gp-color-picker">
          <span>Color</span>
          <div class="gp-color-options">${colorOptions}</div>
        </div>
        <div class="gp-modal-actions">
          <button class="gp-modal-cancel">Cancel</button>
          <button class="gp-modal-save">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const titleInput = overlay.querySelector(".gp-modal-title");
    const descInput = overlay.querySelector(".gp-modal-desc");

    setTimeout(() => titleInput.focus(), 50);

    overlay.querySelector(".gp-modal-cancel").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector(".gp-modal-save").addEventListener("click", async () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.classList.add("gp-input-error");
        return;
      }
      const color =
        overlay.querySelector('input[name="gp-task-color"]:checked')?.value ?? DEFAULT_COLOR;
      await opts.onSave(title, descInput.value.trim(), color);
      overlay.remove();
    });

    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) overlay.querySelector(".gp-modal-save").click();
    });
  }

  // ── Utilities ────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Observer & Init ──────────────────────────────────────

  let initialized = false;
  let debounceTimer = null;
  let isDragging = false;
  let isSelfMutation = false;

  function debouncedRefresh() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (isProjectBoardView() && !isDragging) {
        injectCards();
        setupDropZones();
      }
    }, 300);
  }

  function init() {
    if (!isProjectBoardView()) {
      initialized = false;
      return;
    }
    if (initialized) return;
    initialized = true;

    setTimeout(() => {
      injectToggleButton();
      injectCards();
      setupDropZones();
    }, 500);
  }

  // Check if a mutation is within the board column area (card-level changes we should ignore)
  function isBoardCardMutation(mutation) {
    const target = mutation.target;
    if (!target || !target.closest) return false;
    // Ignore changes inside our own injected elements
    if (target.closest(`.${CARD_CLASS}`) || target.closest(`.${ADD_BTN_CLASS}`) || target.closest(`.${MODAL_CLASS}`) || target.closest(`.${TOGGLE_CLASS}`)) return true;
    // Ignore changes inside existing GitHub board cards (tooltips, hover effects, etc.)
    if (target.closest('[data-board-column]') && !target.hasAttribute('data-board-column')) return true;
    return false;
  }

  // MutationObserver for SPA navigation
  const observer = new MutationObserver((mutations) => {
    if (isSelfMutation || isDragging || !isContextValid()) return;

    const relevant = mutations.some(
      (m) => m.type === "childList" &&
        (m.addedNodes.length > 0 || m.removedNodes.length > 0) &&
        !isBoardCardMutation(m)
    );
    if (relevant) {
      if (isProjectBoardView()) {
        init();
        debouncedRefresh();
      } else {
        initialized = false;
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("popstate", debouncedRefresh);
  document.addEventListener("turbo:load", debouncedRefresh);

  // Re-inject when storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && (changes[STORAGE_KEY] || changes.gp_visible)) {
      if (isProjectBoardView()) injectCards();
    }
  });

  init();
})();
