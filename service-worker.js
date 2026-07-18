// service-worker.js - オフラインでもアプリが動くようにする仕組み
//
// 【役割】
// アプリのファイル（HTML/CSS/JS/アイコン）をスマホ内に保存しておき、
// 電波が無いときは保存済みのファイルを使って動かす。
//
// 【更新のしかた】
// ファイルを修正したら下の CACHE_NAME の数字を上げる（v1 → v2）。
// そうするとスマホ側の古い保存分が捨てられ、新しいファイルに入れ替わる。

const CACHE_NAME = "kakeibo-v13";

// 最初に保存しておくファイル一覧（これだけあればオフラインで完全に動く）
const ASSETS = [
    "./",
    "./index.html",
    "./list.html",
    "./health.html",
    "./js/main.js",
    "./js/list.js",
    "./js/health.js",
    "./js/ocr.js",
    "./js/chart.min.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png"
];

// 【インストール時】アプリのファイルをまとめて保存する
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting()) // すぐ新しいバージョンに切り替える
    );
});

// 【有効化時】古いバージョンの保存分を削除する
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim()) // 開いているページにすぐ適用
    );
});

// 【ファイル取得時】まずネットを試し、ダメなら保存済みを使う
// （こうすると「修正したのにスマホに反映されない」問題が起きにくい）
self.addEventListener("fetch", (event) => {
    // GET以外（データ送信など）はそのまま通す
    if (event.request.method !== "GET") return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // 取得できたら、次のオフラインに備えて保存を更新しておく。
                // ただし保存できないもの（他サイトの一部の応答など）はスキップする。
                // これをやらないと cache.put でエラーになる。
                const cacheable = response &&
                    response.ok &&
                    (response.type === "basic" || response.type === "cors");

                if (cacheable) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(event.request, copy))
                        .catch(() => { /* 保存できなくてもアプリは動くので無視 */ });
                }
                return response;
            })
            .catch(() => {
                // ネットが無い場合は保存済みファイルを返す
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    // ページ遷移で見つからなければトップpage を返す
                    if (event.request.mode === "navigate") {
                        return caches.match("./index.html");
                    }
                });
            })
    );
});
