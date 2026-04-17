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
- **表示トグル** — ポップアップからボード上のカード表示を ON/OFF

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

## File Structure

```
├── manifest.json          # Chrome Extension Manifest V3
├── content/
│   ├── content.js         # Content script（カード注入・D&D・モーダル）
│   └── styles.css         # GitHub Primer CSS に合わせたスタイル
├── popup/
│   ├── index.html         # ポップアップ UI
│   ├── popup.js           # タスク一覧・クイック追加
│   └── popup.css
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
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
  "updatedAt": 1713340800000
}
```

## Notes

- ビルドツール不要。クローンしてそのまま Chrome に読み込めます
- GitHub Projects の DOM 構造が変更された場合、`content/content.js` 内のセレクタ（`getBoardColumns()` / `getColumnCardList()`）の調整が必要になることがあります

## License

MIT
