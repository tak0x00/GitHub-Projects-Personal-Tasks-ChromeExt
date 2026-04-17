# Design Doc: Google Tasks Import via Scraping + Writeback

## Context
GitHub Projects Personal Tasks 拡張に Google Tasks 連携を追加する。API キーや GCP セットアップを不要にするため、tasks.google.com の DOM をスクレイピングして取得・操作する。Writeback は専用タブグループ（折りたたみ状態）に tasks.google.com を常駐させて実現する。

## 要件
- 設定画面（options page）を追加し、複数 Google アカウント対応
- 「+ Add personal task」ボタン押下時に Import を選択可能にする
- Import したタスクは GitHub Project 単位で管理（複数 Project への Import 不可）
- Done / Done 以外の 2 state でカンバン上のステータスを管理
- カンバンで Done に移動 → tasks.google.com 上のタスクも完了にする（Writeback）

## アーキテクチャ

### 全体フロー
```
tasks.google.com (専用タブグループ)         GitHub Projects
┌──────────────────────────┐            ┌──────────────────────┐
│ Content Script (scraper) │            │ Content Script        │
│                          │            │                       │
│ ・タスク一覧読み取り      │◀─message─│ Import モーダル表示    │
│ ・アカウント検出          │─message─▶│                       │
│ ・完了チェックボックス操作 │◀─message─│ Done移動 → Writeback  │
└──────────────────────────┘            └──────────────────────┘
         ↑↓                                     ↑↓
    Background Service Worker (メッセージ中継・タブグループ管理)
```

### ファイル構成

```
github-projects-personal-tasks/
├── manifest.json                  # permissions, content_scripts, background, options_page
├── background/
│   └── service-worker.js          # タブグループ管理、メッセージ中継
├── content/
│   ├── content.js                 # Import モーダル、Writeback 呼出し
│   └── styles.css                 # Import UI のスタイル
├── tasks-scraper/
│   └── scraper.js                 # tasks.google.com 用 content script
├── options/
│   ├── options.html               # 設定画面
│   ├── options.js                 # アカウント管理
│   └── options.css                # 設定画面スタイル
└── popup/
    ├── popup.js                   # Sync ボタン
    └── index.html                 # Sync セクション
```

### manifest.json 変更点

```json
{
  "permissions": ["storage", "tabs", "tabGroups"],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["https://github.com/*"],
      "js": ["content/content.js"],
      "css": ["content/styles.css"]
    },
    {
      "matches": ["https://tasks.google.com/*"],
      "js": ["tasks-scraper/scraper.js"]
    }
  ],
  "options_page": "options/options.html"
}
```

## ストレージスキーマ

### PersonalTask（既存に追加）
```javascript
{
  id, title, description, status, projectUrl, color, createdAt, updatedAt,
  gcalSource: null | {              // null なら手動作成タスク
    email: "user@gmail.com",
    taskListTitle: "My Tasks",
    taskId: "dom-element-id",
    importedProjectUrl: "/orgs/x/projects/1"
  }
}
```

### Google Tasks キャッシュ（chrome.storage.local）
```javascript
"gp_gcal_cache": {
  "user@gmail.com": {
    email: "user@gmail.com",
    syncedAt: 1713340800000,
    taskLists: [
      {
        title: "My Tasks",
        tasks: [
          { id: "dom-id", title: "タイヤ交換予約", notes: "", due: "2024-04-20", completed: false }
        ]
      }
    ]
  }
}
```

## コンポーネント詳細

### Background Service Worker
- `ensureTasksTab()` — tasks.google.com タブを「GP Tasks」タブグループ（collapsed）内に開く
- メッセージ中継: SYNC_TASKS, WRITEBACK_DONE, WRITEBACK_UNDONE

### Scraper (tasks.google.com)
- ページロード時に自動 Sync
- アカウントメール検出
- Writeback: メッセージ受信 → DOM 操作で完了チェック

### Import モーダル (GitHub Projects)
- 「+ Add」→ ミニメニュー → 「Import from Google Tasks」
- アカウント選択 → タスクリスト → 複数選択 → Import
- 既 Import はグレーアウト

### Writeback
- Done カラム移動 → WRITEBACK_DONE メッセージ送信
- Done 以外に戻す → WRITEBACK_UNDONE 送信

## リスク
- tasks.google.com の DOM 変更でスクレイピングが壊れる可能性
  - 対策: フォールバックセレクタ、エラー時の明確な通知
- chrome.storage.sync の 5MB 上限
  - 対策: キャッシュは chrome.storage.local に保存
