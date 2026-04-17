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

  async function addTask(title, status, projectUrl, description = "", color = DEFAULT_COLOR) {
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

  // ── Card Injection ───────────────────────────────────────

  function clearInjectedCards() {
    document.querySelectorAll(`.${CARD_CLASS}, .${ADD_BTN_CLASS}`).forEach((el) => el.remove());
  }

  let injectLock = false;

  async function injectCards() {
    // Prevent concurrent runs — if already injecting, skip
    if (injectLock) return;
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
    card.style.borderLeftColor = task.color;

    card.innerHTML = `
      <div class="gp-task-header">
        <span class="gp-task-badge">Personal</span>
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
    const btn = document.createElement("button");
    btn.className = ADD_BTN_CLASS;
    btn.textContent = "+ Add personal task";
    btn.addEventListener("click", () => openAddModal(columnName, projectUrl));
    return btn;
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
          await updateTask(taskId, { status: col.name });
          injectCards();
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
      injectCards();
      setupDropZones();
    }, 500);
  }

  // Check if a mutation is within the board column area (card-level changes we should ignore)
  function isBoardCardMutation(mutation) {
    const target = mutation.target;
    if (!target || !target.closest) return false;
    // Ignore changes inside our own injected elements
    if (target.closest(`.${CARD_CLASS}`) || target.closest(`.${ADD_BTN_CLASS}`) || target.closest(`.${MODAL_CLASS}`)) return true;
    // Ignore changes inside existing GitHub board cards (tooltips, hover effects, etc.)
    if (target.closest('[data-board-column]') && !target.hasAttribute('data-board-column')) return true;
    return false;
  }

  // MutationObserver for SPA navigation
  const observer = new MutationObserver((mutations) => {
    if (isSelfMutation || isDragging) return;

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
