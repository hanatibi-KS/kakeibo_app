// ocr.js - レシート読み取り（Tesseract.js を使ったOCR）
//
// 【考え方】
// 日本語レシートのOCRは難しい（感熱紙の滲み・特殊フォント・店ごとに違うレイアウト）。
// そのため「完璧に読み取る」ことは狙わず、
//   OCR = あくまで"下書き"、最終確認は人間
// という方針にしている。読み取り結果は入力欄に入れるだけで、
// ユーザーが目で見て直してから保存する。
(() => {
    const receiptInput = document.getElementById("receiptInput");
    if (!receiptInput) return;

    const preview = document.getElementById("receiptPreview");
    const progressBox = document.getElementById("ocrProgress");
    const barFill = document.getElementById("ocrBarFill");
    const statusText = document.getElementById("ocrStatus");
    const resultBox = document.getElementById("ocrResult");

    // 入力欄（読み取った内容をここに流し込む）
    const dateInput = document.getElementById("dateInput");
    const itemInput = document.getElementById("item");
    const amountInput = document.getElementById("amount");

    // ------------------------------------------------------------
    // 文字列のユーティリティ
    // ------------------------------------------------------------

    // 全角英数字・記号を半角に揃える（「１２３」→「123」）
    function toHalfWidth(str) {
        return str
            .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
            .replace(/　/g, " ");
    }

    function pad2(n) {
        return String(Number(n)).padStart(2, "0");
    }

    // ------------------------------------------------------------
    // 金額の抽出
    // ------------------------------------------------------------

    // 「合計」を表す言葉（この行にある数字を最優先で採用する）
    const TOTAL_KEYWORD = /(合\s*計|お買\s*上|お買い上げ|総\s*額|税込\s*合?\s*計|ご請求)/;

    // 金額と紛らわしい行（「お預り」「お釣り」は合計より大きい数字が載るため除外）
    const EXCLUDE_KEYWORD = /(預|釣|つり|お返し|ポイント|point|残高|カード|クレジット|電話|TEL|〒|登録番号)/i;

    // 金額と間違えやすい数字（日付・時刻・電話番号）を先に取り除く。
    // これをやらないと「2026-07-10」の "2026" を金額として拾ってしまう。
    function stripNoise(line) {
        return line
            .replace(/令和\s*\d{1,2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?/g, " ")  // 令和の日付
            .replace(/20\d{2}\s*[年\/\-\.]\s*\d{1,2}\s*[月\/\-\.]\s*\d{1,2}\s*日?/g, " ")  // 西暦の日付
            .replace(/\d{1,2}\s*[:：]\s*\d{2}(\s*[:：]\s*\d{2})?/g, " ")  // 時刻
            .replace(/(TEL|電話)[\s:：]*[\d\-()]+/gi, " ")  // 電話番号
            .replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, " ");  // ハイフン区切りの番号
    }

    // 1行の中から金額らしき数字を全部取り出す
    function findNumbers(line) {
        const cleaned = stripNoise(line);
        // 「¥1,234」「1,234」「¥980」のような形を優先的に拾う
        const matches = cleaned.match(/[¥￥]\s*\d{1,3}(?:,\d{3})*|\d{1,3}(?:,\d{3})+|[¥￥]\s*\d+|\d{2,7}/g) || [];
        return matches
            .map(s => Number(s.replace(/[¥￥,\s]/g, "")))
            .filter(n => !isNaN(n) && n > 0 && n < 10000000);
    }

    // レシート全体のテキストから合計金額を推定する
    function extractAmount(text) {
        const lines = text.split("\n")
            .map(l => toHalfWidth(l).trim())
            .filter(l => l.length > 0);

        // ① 「合計」と書かれた行を探す（最も信頼できる）
        //    複数ある場合は後ろの行を優先（小計→合計の順で並ぶことが多いため）
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (EXCLUDE_KEYWORD.test(line)) continue;
            if (TOTAL_KEYWORD.test(line)) {
                const nums = findNumbers(line);
                if (nums.length > 0) {
                    return { amount: Math.max(...nums), source: line, confident: true };
                }
            }
        }

        // ② 見つからなければ、レシート全体で一番大きい数字を合計とみなす
        //    （多くのレシートでは合計が最大値になる）
        let best = null;
        let bestLine = "";
        for (const line of lines) {
            if (EXCLUDE_KEYWORD.test(line)) continue;
            for (const n of findNumbers(line)) {
                if (best === null || n > best) {
                    best = n;
                    bestLine = line;
                }
            }
        }
        return best === null ? null : { amount: best, source: bestLine, confident: false };
    }

    // ------------------------------------------------------------
    // 日付の抽出
    // ------------------------------------------------------------
    function extractDate(text) {
        const t = toHalfWidth(text);

        // 「2026年7月17日」「2026/07/17」「2026-07-17」「2026.7.17」
        let m = t.match(/(20\d{2})\s*[年\/\-\.]\s*(\d{1,2})\s*[月\/\-\.]\s*(\d{1,2})/);
        if (m) {
            const [, y, mo, d] = m;
            if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
                return `${y}-${pad2(mo)}-${pad2(d)}`;
            }
        }

        // 「令和6年7月17日」（令和1年 = 2019年）
        m = t.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
        if (m) {
            const [, r, mo, d] = m;
            if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
                return `${2018 + Number(r)}-${pad2(mo)}-${pad2(d)}`;
            }
        }
        return null;
    }

    // ------------------------------------------------------------
    // 店名の推定（レシート上部にあることが多い）
    // ------------------------------------------------------------
    function extractStore(text) {
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        for (const line of lines.slice(0, 5)) {
            // 数字・記号だらけの行や、短すぎ・長すぎる行は店名ではない
            const cleaned = line.replace(/[\s\-–—=*_.]/g, "");
            if (cleaned.length < 2 || cleaned.length > 20) continue;
            if (/^\d+$/.test(cleaned)) continue;
            if (/(TEL|電話|〒|領収|レシート|http)/i.test(cleaned)) continue;
            // 日本語または英字が含まれていれば店名候補とみなす
            if (/[぀-ヿ一-龯A-Za-z]/.test(cleaned)) return cleaned;
        }
        return null;
    }

    // ------------------------------------------------------------
    // 画面の更新
    // ------------------------------------------------------------
    function setProgress(percent, label) {
        progressBox.style.display = "block";
        barFill.style.width = percent + "%";
        statusText.textContent = label;
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // 読み取り結果を表示し、入力欄へ流し込む
    function showResult(text) {
        const amountInfo = extractAmount(text);
        const date = extractDate(text);
        const store = extractStore(text);

        let html = "<h4>📄 読み取り結果</h4>";

        if (amountInfo) {
            html += `<div class="ocr-found">${amountInfo.amount.toLocaleString()} 円</div>`;
            amountInput.value = amountInfo.amount;

            if (!amountInfo.confident) {
                html += `<p class="ocr-note">⚠️ 「合計」の文字が見つからなかったため、一番大きい数字を金額として採用しました。違っていたら直してください。</p>`;
            }
        } else {
            html += `<p class="ocr-note">⚠️ 金額を読み取れませんでした。手で入力してください。</p>`;
        }

        const filled = [];
        if (date) {
            dateInput.value = date;
            filled.push(`日付: ${date}`);
        }
        if (store) {
            itemInput.value = store;
            filled.push(`項目: ${store}（店名から推定）`);
        }
        if (filled.length > 0) {
            html += `<p class="ocr-note">${filled.map(escapeHtml).join("<br>")}</p>`;
        }

        html += `<p class="ocr-note" style="margin-top:8px;">下の「支出の登録」に入れました。<b>内容を確認して</b>保存してください。</p>`;

        // 読み取った生テキストも見られるようにする（うまくいかない時の原因調査用）
        html += `
            <div class="ocr-raw-toggle" id="rawToggle">▶ 読み取った文字を見る</div>
            <div class="ocr-raw" id="rawText" style="display:none;">${escapeHtml(text.trim() || "(何も読み取れませんでした)")}</div>
        `;

        resultBox.innerHTML = html;
        resultBox.style.display = "block";

        // 生テキストの開閉
        const toggle = document.getElementById("rawToggle");
        const raw = document.getElementById("rawText");
        toggle.addEventListener("click", () => {
            const open = raw.style.display !== "none";
            raw.style.display = open ? "none" : "block";
            toggle.textContent = open ? "▶ 読み取った文字を見る" : "▼ 読み取った文字を隠す";
        });

        // 入力欄までスクロールして、確認を促す
        amountInput.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // ------------------------------------------------------------
    // メイン処理: 画像が選ばれたらOCRを実行
    // ------------------------------------------------------------
    receiptInput.addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // プレビュー表示
        const objectUrl = URL.createObjectURL(file);
        preview.src = objectUrl;
        preview.style.display = "block";
        resultBox.style.display = "none";

        if (typeof Tesseract === "undefined") {
            setProgress(0, "OCRの読み込みに失敗しました（通信環境を確認してください）");
            return;
        }

        setProgress(5, "準備しています…（初回は辞書のダウンロードに時間がかかります）");

        let worker;
        try {
            // 日本語の辞書を読み込む（初回のみ十数MBのダウンロードが発生する）
            worker = await Tesseract.createWorker("jpn", 1, {
                logger: (m) => {
                    if (m.status === "recognizing text") {
                        setProgress(20 + Math.round(m.progress * 80), `読み取り中… ${Math.round(m.progress * 100)}%`);
                    } else if (m.status === "loading language traineddata") {
                        setProgress(10, "日本語辞書をダウンロード中…");
                    }
                }
            });

            const { data } = await worker.recognize(file);
            setProgress(100, "完了！");
            showResult(data.text || "");
        } catch (err) {
            console.error("OCRエラー:", err);
            setProgress(0, "読み取りに失敗しました。もう一度お試しください。");
        } finally {
            if (worker) await worker.terminate();
            // メモリを解放
            URL.revokeObjectURL(objectUrl);
            setTimeout(() => { progressBox.style.display = "none"; }, 1200);
        }
    });
})();
