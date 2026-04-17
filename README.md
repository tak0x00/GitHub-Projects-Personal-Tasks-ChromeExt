# GitHub Projects Personal Tasks

GitHub Projects V2 のカンバンボードに、issue ではない個人タスクを追加できる Chrome 拡張機能です。

開発タスク（issue）と個人 TODO（MTG 準備、ドキュメント作成など）を同じボード上で一元管理できます。

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)

## Features

- **カンバンにカード注入** — 各カラム末尾に個人タスクカードを表示
- **ドラッグ & ドロップ** — カラム間でカードを移動するとステータスが自動更新
- **視覚的な区別** — 色付き左ボーダーと「PERSONAL」バッジで issue カードと区別
- **デバイス間同期** — `chrome.storage.sync` により、同じ Google アカウントでログインしたブラウザ間で同期
- **ポップアップ UI** — 拡張アイコンからタスクの一覧確認・クイック追加が可能
- **表示トグル** — ポップアップ / ボードヘッダーのトグルボタンでカード表示を ON/OFF

### Google Tasks 連携

- **Import from Google Tasks** — 「+ Add personal task」→「Import from Google Tasks」から tasks.google.com のタスクをボードにインポート。API 不要のスクレイピング方式
- **Writeback** — インポートしたカードを Done カラムに移動すると tasks.google.com 側でも完了チェック。Done 以外に戻すと未完了に戻す
- **自動 Sync** — tasks.google.com を開くと自動でタスクをキャッシュ。設定画面の Sync ボタンで手動更新も可能
- **アカウント管理** — 設定画面で連携アカウントの確認・削除が可能。アカウント削除時、インポート済みタスクはローカルタスクとして保持

## Install

1. このリポジトリをクローン（または ZIP ダウンロード）
   ```
   git clone https://github.com/tak0x00/GitHub-Projects-Personal-Tasks-ChromeExt.git
   ```
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパーモード」を ON
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. クローンしたフォルダを選択

## Usage

1. GitHub Projects のボードビュー（`github.com/orgs/*/projects/*` or `github.com/users/*/projects/*`）を開く
2. 各カラムの末尾に表示される **「+ Add personal task」** ボタンからタスクを追加
3. カードをクリックして編集、ホバーで表示される **×** ボタンで削除
4. カードをドラッグして別カラムに移動

拡張アイコンのポップアップからも、タスクの確認・追加・削除が可能です。

### Google Tasks のインポート手順

1. 設定画面（拡張アイコン → Settings）で **「+ Add Account」** をクリック
2. 開いた tasks.google.com で連携したい Google アカウントにログイン（自動 Sync が走ります）
3. GitHub Projects ボードの **「+ Add personal task」→「Import from Google Tasks」** を選択
4. タスクを選択して **「Import Selected」**

## File Structure

```
├── manifest.json              # Chrome Extension Manifest V3
├── background/
│   └── service-worker.js      # タブグループ管理・メッセージ中継・Writeback
├── content/
│   ├── content.js             # カード注入・D&D・Import モーダル
│   └── styles.css             # GitHub Primer CSS に合わせたスタイル
├── popup/
│   ├── index.html
│   ├── popup.js               # タスク一覧・クイック追加・Sync
│   └── popup.css
├── options/
│   ├── options.html           # 設定画面
│   ├── options.js             # アカウント管理・Sync
│   └── options.css
├── tasks-scraper/
│   └── scraper.js             # tasks.google.com スクレイパー・Writeback 実行
└── icons/
```

## Data Model

タスクは `chrome.storage.sync` に保存されます（上限 5MB、デバイス間同期対応）。

```json
{
  "id": "uuid",
  "title": "タスク名",
  "description": "詳細（任意）",
  "status": "Backlog",
  "projectUrl": "/orgs/myorg/projects/1",
  "color": "#8b5cf6",
  "createdAt": 1713340800000,
  "updatedAt": 1713340800000,
  "gcalSource": {
    "email": "you@example.com",
    "taskListTitle": "マイタスク",
    "taskId": "abc123",
    "importedProjectUrl": "/orgs/myorg/projects/1"
  }
}
```

`gcalSource` は Google Tasks からインポートしたカードのみ付与されます。`null` の場合は手動作成のローカルタスクです。

Google Tasks のキャッシュは `chrome.storage.local`（`gp_gcal_cache`）に保存されます。

## Notes

- ビルドツール不要。クローンしてそのまま Chrome に読み込めます
- Google Tasks 連携はシングルアカウント動作です。GP Tasks タブグループの最初のタブが Active アカウントとして扱われます
- tasks.google.com の DOM 構造が変更された場合、`tasks-scraper/scraper.js` 内のセレクタ調整が必要になることがあります
- GitHub Projects の DOM 構造が変更された場合、`content/content.js` 内のセレクタ（`getBoardColumns()` / `getColumnCardList()`）の調整が必要になることがあります

## License

MIT
