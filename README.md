# Yohaku（余白）

口座残高と楽天カードの数字から「本当に使えるお金」を出す、iPhone 用の家計アプリ（PWA）。
このフォルダの中身をそのまま GitHub Pages に置き、Safari の「ホーム画面に追加」で全画面アプリとして使う。

- index.html … アプリ本体。データは端末内（localStorage）のみで、金額はこのファイルに含まれない
- manifest.webmanifest … 全画面起動の設定
- sw.js … キャッシュ優先で即起動・オフライン対応
- icons/ … アプリアイコン
- splash/ … iPhone の起動画面
