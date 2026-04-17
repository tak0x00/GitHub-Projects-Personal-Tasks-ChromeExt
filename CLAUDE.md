# CLAUDE.md

## Project Overview
GitHub Projects V2 のカンバンボードに個人タスクを追加する Chrome 拡張機能（Manifest V3）。
ビルドツール不要のプレーン JavaScript プロジェクト。

## Architecture
- **Content Script** (`content/content.js`): GitHub Projects ページにカードを注入
- **Popup** (`popup/`): 拡張アイコンのポップアップUI
- **Tasks Scraper** (`tasks-scraper/scraper.js`): tasks.google.com からタスクをスクレイピング
- **Background** (`background/service-worker.js`): タブグループ管理・メッセージ中継
- **Options** (`options/`): 設定画面（Google アカウント管理）

## Key Patterns
- ビルドなし: プレーン JS のみ。TypeScript や bundler は使わない
- ストレージ: タスクは `chrome.storage.sync`、Google Tasks キャッシュは `chrome.storage.local`
- DOM 注入: `MutationObserver` で SPA ナビゲーションを監視し、カードを再注入
- GitHub Projects のカラム検出: `[data-board-column]` 属性を使用
- カードリスト: `[data-dnd-drop-type="card"]` セレクタ
- `isSelfMutation` / `isDragging` / `injectLock` フラグで不要な再描画を防止
- `isContextValid()` で拡張コンテキスト無効化エラーを防止
- IME 対応: `e.isComposing` チェックで変換確定時の誤発火を防止

## Storage Keys
- `gp_personal_tasks`: PersonalTask[] — メインのタスクデータ
- `gp_visible`: boolean — ボード上の表示/非表示
- `gp_gcal_cache`: object — Google Tasks のキャッシュ（storage.local）

## Development
1. `chrome://extensions` でデベロッパーモード ON
2. 「パッケージ化されていない拡張機能を読み込む」でプロジェクトフォルダを選択
3. 変更後は拡張をリロード、GitHub のタブもリロード

## Commit Convention
- `feat:` 新機能
- `fix:` バグ修正
- `docs:` ドキュメント
- Co-Authored-By トレーラーを含める

## Design Docs
- [Google Tasks Import](docs/design-gcal-import.md)
