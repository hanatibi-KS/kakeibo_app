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
    // 項目名は意図的に自動入力しない（OCRで最も外しやすく、直す手間の方が大きいため）
    const dateInput = document.getElementById("dateInput");
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
    // 画像の前処理（ここがOCR精度の9割を決める）
    //
    // Tesseractは「スキャナで取り込んだ、白背景に黒文字のくっきりした画像」を想定している。
    // スマホで撮った写真をそのまま渡すと、影・傾き・低コントラストのせいでほぼ読めない。
    // そこで OCRにかける前に、写真を「スキャナで取ったような白黒画像」に変換する。
    // ------------------------------------------------------------

    // ファイルを<img>として読み込む
    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めませんでした")); };
            img.src = url;
        });
    }

    // 適応的二値化（Bradley法）
    //
    // 画像全体で1つのしきい値を決める方法（大津の二値化など）だと、
    // レシートの左半分に影が落ちているだけで、その部分が真っ黒に潰れてしまう。
    // この方法は「各画素の周辺だけを見て」しきい値を決めるので、影に強い。
    function adaptiveThreshold(gray, w, h, windowSize, tPercent) {
        // 積分画像（各画素までの合計を先に計算しておく高速化テクニック）
        const integral = new Float64Array(w * h);
        for (let y = 0; y < h; y++) {
            let rowSum = 0;
            for (let x = 0; x < w; x++) {
                rowSum += gray[y * w + x];
                integral[y * w + x] = (y === 0 ? 0 : integral[(y - 1) * w + x]) + rowSum;
            }
        }

        const out = new Uint8ClampedArray(w * h);
        const half = Math.floor(windowSize / 2);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const x1 = Math.max(0, x - half), x2 = Math.min(w - 1, x + half);
                const y1 = Math.max(0, y - half), y2 = Math.min(h - 1, y + half);
                const count = (x2 - x1 + 1) * (y2 - y1 + 1);

                // 周辺領域の合計を、積分画像から4回の参照だけで求める
                const A = (x1 > 0 && y1 > 0) ? integral[(y1 - 1) * w + (x1 - 1)] : 0;
                const B = (y1 > 0) ? integral[(y1 - 1) * w + x2] : 0;
                const C = (x1 > 0) ? integral[y2 * w + (x1 - 1)] : 0;
                const D = integral[y2 * w + x2];
                const sum = D - B - C + A;

                // 周辺の平均より一定以上暗ければ「文字（黒）」とみなす
                out[y * w + x] = (gray[y * w + x] * count <= sum * (100 - tPercent) / 100) ? 0 : 255;
            }
        }
        return out;
    }

    // 写真 → OCR用の白黒画像に変換する
    function preprocessToCanvas(img) {
        // ① 大きさを揃える
        //    大きすぎる写真は遅いだけ。小さすぎると文字が潰れて読めない。
        //    レシートの文字が判別できる目安として、長辺1600px程度に正規化する。
        const TARGET = 1600;
        const scale = TARGET / Math.max(img.width, img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const px = imageData.data;

        // ② グレースケール化（人間の目の感度に合わせた重み付け）
        const gray = new Uint8ClampedArray(w * h);
        for (let i = 0, j = 0; i < px.length; i += 4, j++) {
            gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        }

        // ③ 適応的二値化で白黒はっきりさせる
        //    窓の大きさは画像幅の約1/12。文字の太さに対して十分大きく、影より小さく。
        const windowSize = Math.max(15, Math.round(w / 12) | 1);
        const binary = adaptiveThreshold(gray, w, h, windowSize, 12);

        for (let i = 0, j = 0; i < px.length; i += 4, j++) {
            px[i] = px[i + 1] = px[i + 2] = binary[j];
            px[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);

        return canvas;
    }

    // ------------------------------------------------------------
    // 2段階OCRのための補助
    //
    // 【作戦】
    // 日本語OCRは精度が低いが「合計」という2文字を見つけるくらいはできる。
    // 一方、数字だけに限定した認識（文字種を0-9に絞る）は非常に正確。
    // そこで役割を分ける:
    //   1回目(日本語) … 「合計」がある行の"位置"だけを特定する
    //   2回目(数字専用) … その行だけ切り出して拡大し、金額を正確に読む
    // ------------------------------------------------------------

    // Tesseractの結果から行の一覧を取り出す（バージョン差を吸収する）
    function getLines(data) {
        if (Array.isArray(data.lines) && data.lines.length > 0) return data.lines;
        const lines = [];
        (data.blocks || []).forEach(block => {
            (block.paragraphs || []).forEach(para => {
                (para.lines || []).forEach(line => lines.push(line));
            });
        });
        return lines;
    }

    // Tesseractの結果から単語の一覧を取り出す
    function getWords(data) {
        if (Array.isArray(data.words) && data.words.length > 0) return data.words;
        const words = [];
        getLines(data).forEach(line => {
            (line.words || []).forEach(w => words.push(w));
        });
        return words;
    }

    // 「合計」が書かれている行を探して、その位置(bbox)を返す
    function findTotalLine(lines) {
        // 下から探す（レシートは 小計 → 合計 の順に並ぶため、後ろの方が本物）
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const text = toHalfWidth(line.text || "").trim();
            if (!text) continue;
            if (EXCLUDE_KEYWORD.test(text)) continue;
            if (TOTAL_KEYWORD.test(text) && line.bbox) {
                return { bbox: line.bbox, text };
            }
        }
        return null;
    }

    // 指定範囲を切り出して拡大する。
    // 小さい文字のままだとOCRが潰すので、拡大してから読ませると精度が上がる。
    function cropAndZoom(srcCanvas, bbox, zoom, padding) {
        const x0 = Math.max(0, Math.floor(bbox.x0 - padding));
        const y0 = Math.max(0, Math.floor(bbox.y0 - padding));
        const x1 = Math.min(srcCanvas.width, Math.ceil(bbox.x1 + padding));
        const y1 = Math.min(srcCanvas.height, Math.ceil(bbox.y1 + padding));
        const w = x1 - x0;
        const h = y1 - y0;
        if (w <= 0 || h <= 0) return null;

        const canvas = document.createElement("canvas");
        canvas.width = w * zoom;
        canvas.height = h * zoom;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(srcCanvas, x0, y0, w, h, 0, 0, w * zoom, h * zoom);
        return canvas;
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
    // amountInfo: { amount, confident, method } / cropUrl: 実際に読んだ部分の画像
    function showResult(text, amountInfo, cropUrl) {
        const date = extractDate(text);

        let html = "<h4>📄 読み取り結果</h4>";

        if (amountInfo) {
            html += `<div class="ocr-found">${amountInfo.amount.toLocaleString()} 円</div>`;
            amountInput.value = amountInfo.amount;

            if (amountInfo.method === "two-pass") {
                html += `<p class="ocr-note">✅ 「合計」の行を見つけて、数字専用モードで読み直しました（最も精度が高い方法です）</p>`;
            } else if (amountInfo.confident) {
                html += `<p class="ocr-note">「合計」の行から読み取りました</p>`;
            } else {
                html += `<p class="ocr-note">⚠️ 「合計」の文字が見つからなかったため、一番大きい数字を金額として採用しました。違っていたら直してください。</p>`;
            }

            // 実際に読み取った部分を見せる（外した時に原因が分かる）
            if (cropUrl) {
                html += `<p class="ocr-note" style="margin-top:6px;">この部分を読みました:</p>
                         <img src="${cropUrl}" alt="読み取った合計行" style="max-width:100%; border:1px solid #ddd; border-radius:4px;">`;
            }
        } else {
            html += `<p class="ocr-note">⚠️ 金額を読み取れませんでした。手で入力してください。</p>`;
        }

        if (date) {
            dateInput.value = date;
            html += `<p class="ocr-note">日付: ${escapeHtml(date)}</p>`;
        }

        // 店名の自動入力はしない。
        // 店名はOCRで最も読み取りが不安定なうえ、間違った文字が入ると
        // 消して打ち直す手間が増えて、かえって遅くなるため。
        // 項目名はユーザーに入力してもらう方が速くて確実。
        html += `<p class="ocr-note" style="margin-top:8px;">金額と日付を入れました。<b>項目名はご自身で入力してください</b>（この方が速くて確実です）。内容を確認して保存を。</p>`;

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

        resultBox.style.display = "none";

        if (typeof Tesseract === "undefined") {
            setProgress(0, "OCRの読み込みに失敗しました（通信環境を確認してください）");
            return;
        }

        let jpnWorker, engWorker;
        try {
            // ① 写真をOCR用の白黒画像に変換する
            setProgress(5, "画像を処理しています…");
            const img = await loadImage(file);
            const canvas = preprocessToCanvas(img);

            // 変換後の画像をプレビューに出す。
            // 「OCRが実際に見ている画像」が見えると、読めない原因が一目で分かる。
            // （文字が潰れている／影で真っ黒 など）
            preview.src = canvas.toDataURL("image/png");
            preview.style.display = "block";

            // ② 1回目: 日本語OCR（「合計」の行を探すのが目的）
            setProgress(10, "準備しています…（初回は辞書のダウンロードに時間がかかります）");
            jpnWorker = await Tesseract.createWorker("jpn", 1, {
                logger: (m) => {
                    if (m.status === "recognizing text") {
                        setProgress(25 + Math.round(m.progress * 45), `レシートを読み取り中… ${Math.round(m.progress * 100)}%`);
                    } else if (m.status === "loading language traineddata") {
                        setProgress(15, "日本語辞書をダウンロード中…");
                    }
                }
            });

            await jpnWorker.setParameters({
                // レシートは1列に文字が並んだ塊なので、それ用のモードにする
                tessedit_pageseg_mode: "6",
                // 単語の区切りスペースを保持する（「合計 842」を分けて読むため）
                preserve_interword_spaces: "1"
            });

            // 行ごとの位置情報が欲しいので blocks を要求する
            const { data } = await jpnWorker.recognize(canvas, {}, { text: true, blocks: true });
            const text = data.text || "";

            // ③ 2回目: 「合計」の行だけを数字専用モードで読み直す
            let amountInfo = null;
            let cropUrl = null;
            const totalLine = findTotalLine(getLines(data));

            if (totalLine) {
                setProgress(72, "合計の行を数字専用モードで読み直しています…");
                const crop = cropAndZoom(canvas, totalLine.bbox, 3, 6);

                if (crop) {
                    cropUrl = crop.toDataURL("image/png");

                    // 数字認識には英語辞書を使う。
                    // さらに精度重視版(_best)を指定する。英語辞書は小さいので追加負担は軽い。
                    engWorker = await Tesseract.createWorker("eng", 1, {
                        langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
                        logger: (m) => {
                            if (m.status === "recognizing text") {
                                setProgress(80 + Math.round(m.progress * 18), "金額を読み取り中…");
                            }
                        }
                    });

                    await engWorker.setParameters({
                        // 1行だけを読むモード
                        tessedit_pageseg_mode: "7",
                        // 読み取る文字を数字と記号だけに限定する。
                        // こうすると「8」を「日」と誤読するような事故が起きなくなる。
                        tessedit_char_whitelist: "0123456789,.¥￥"
                    });

                    const { data: d2 } = await engWorker.recognize(crop, {}, { text: true, blocks: true });

                    // 「一番右にある数字」を金額として採用する。
                    //
                    // 文字種を数字に限定しているため、「合計」というラベル自体も
                    // 無理やり数字として読まれてしまう（例: 「合計」→「60」）。
                    // しかしレシートの合計行では、金額は必ず行の右端にある。
                    // そこで最大値ではなく"右端"で選ぶことで、ラベルの誤読を無視できる。
                    let rightmost = null;
                    for (const word of getWords(d2)) {
                        if (!word.bbox) continue;
                        const nums = findNumbers(toHalfWidth(word.text || ""));
                        if (nums.length === 0) continue;
                        if (!rightmost || word.bbox.x1 > rightmost.x1) {
                            rightmost = { x1: word.bbox.x1, amount: Math.max(...nums) };
                        }
                    }

                    if (rightmost) {
                        amountInfo = { amount: rightmost.amount, confident: true, method: "two-pass" };
                    } else {
                        // 単語の位置が取れない場合は、テキスト全体から最大値を拾う
                        const nums = findNumbers(toHalfWidth(d2.text || ""));
                        if (nums.length > 0) {
                            amountInfo = { amount: Math.max(...nums), confident: true, method: "two-pass" };
                        }
                    }
                }
            }

            // 2段階で読めなければ、1回目の結果から推定する（従来どおり）
            if (!amountInfo) {
                amountInfo = extractAmount(text);
                cropUrl = null;
            }

            setProgress(100, "完了！");
            showResult(text, amountInfo, cropUrl);
        } catch (err) {
            console.error("OCRエラー:", err);
            setProgress(0, "読み取りに失敗しました。もう一度お試しください。");
        } finally {
            if (jpnWorker) await jpnWorker.terminate();
            if (engWorker) await engWorker.terminate();
            setTimeout(() => { progressBox.style.display = "none"; }, 1200);
        }
    });
})();
