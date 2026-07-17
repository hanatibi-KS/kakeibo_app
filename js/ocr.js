// ocr.js - レシート読み取り（Tesseract.js を使ったOCR）
//
// 【考え方】
// 日本語レシートのOCRは難しい（感熱紙の滲み・特殊フォント・店ごとに違うレイアウト）。
// そこで「機械が苦手なこと」と「人間が苦手なこと」で役割を分けている。
//
//   合計がどこにあるか探す … 人間なら一瞬（指でなぞって囲んでもらう）
//   数字を正確に読む       … 機械の方が速くて正確（文字種を数字に限定して読む）
//
// 範囲を絞ってから数字専用モードで読むため、精度が大きく上がる。
// なお読み取り結果は入力欄に入れるだけで、最終確認は必ずユーザーが行う。
(() => {
    const receiptInput = document.getElementById("receiptInput");
    if (!receiptInput) return;

    const cropArea = document.getElementById("cropArea");
    const viewCanvas = document.getElementById("receiptCanvas");
    const zoomWrap = document.getElementById("cropZoomWrap");
    const zoomCanvas = document.getElementById("cropZoom");
    const readSelectionBtn = document.getElementById("readSelectionBtn");
    const readAllBtn = document.getElementById("readAllBtn");
    const progressBox = document.getElementById("ocrProgress");
    const barFill = document.getElementById("ocrBarFill");
    const statusText = document.getElementById("ocrStatus");
    const resultBox = document.getElementById("ocrResult");

    // 入力欄（読み取った内容をここに流し込む）
    // 項目名は意図的に自動入力しない（OCRで最も外しやすく、直す手間の方が大きいため）
    const dateInput = document.getElementById("dateInput");
    const amountInput = document.getElementById("amount");

    // 前処理済みのレシート画像（白黒）と、画面表示との倍率
    let processedCanvas = null;
    let imgScale = 1;          // 画像の実ピクセル ÷ 表示ピクセル
    let selection = null;      // 選択範囲（表示座標）{x0,y0,x1,y1}
    let dragging = false;
    let busy = false;

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

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // ------------------------------------------------------------
    // 金額・日付の抽出
    // ------------------------------------------------------------

    // 「合計」を表す言葉（この行にある数字を最優先で採用する）
    const TOTAL_KEYWORD = /(合\s*計|お買\s*上|お買い上げ|総\s*額|税込\s*合?\s*計|ご請求)/;

    // 金額と紛らわしい行を除外する。
    // ・「お預り」「お釣り」「現金」… 合計より大きい数字が載ることがある
    // ・「番号」「No」「取引」「会員」… 責任番号・伝票番号・会員番号などを
    //   金額と誤認する事故が実際に起きたため除外
    // 「商品数」「点数」は『お買上商品数:12』の 12 を金額と誤認しないため。
    // 「小計」は税抜の途中金額なので、合計と混同しないよう除外する
    //（「合計」のラベルが読めなかった時に小計の金額を拾ってしまう事故を防ぐ）。
    // レシートは「現 金」「小 計」のように文字間にスペースを入れて印字することが
    // 多いため、漢字の熟語は \s* を挟んでスペース入りでも一致するようにしている。
    const EXCLUDE_KEYWORD = /(預|釣|つり|お\s*返し|ポイント|point|残\s*高|カード|クレジット|現\s*金|電話|TEL|〒|番\s*号|No\.|取\s*引|会\s*員|伝\s*票|領\s*収|レジ|商\s*品\s*数|点\s*数|個\s*数|小\s*計)/i;

    // 金額と間違えやすい数字（日付・時刻・電話番号）を先に取り除く。
    // これをやらないと「2026-07-10」の "2026" を金額として拾ってしまう。
    function stripNoise(line) {
        return line
            .replace(/令和\s*\d{1,2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?/g, " ")
            .replace(/20\d{2}\s*[年\/\-\.]\s*\d{1,2}\s*[月\/\-\.]\s*\d{1,2}\s*日?/g, " ")
            .replace(/\d{1,2}\s*[:：]\s*\d{2}(\s*[:：]\s*\d{2})?/g, " ")
            .replace(/(TEL|電話)[\s:：]*[\d\-()]+/gi, " ")
            .replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, " ");
    }

    // 1行の中から金額らしき数字を全部取り出す。
    // OCRは「¥」を「Y」と誤読することが多いので、Y付きの数字も金額とみなす。
    function findNumbers(line) {
        const cleaned = stripNoise(line);
        const matches = cleaned.match(/[¥￥Yy]\s*\d{1,3}(?:,\d{3})*|\d{1,3}(?:,\d{3})+|[¥￥Yy]\s*\d+|\d{2,7}/g) || [];
        return matches
            .map(s => Number(s.replace(/[¥￥Yy,\s]/g, "")))
            .filter(n => !isNaN(n) && n > 0 && n < 10000000);
    }

    // 「金額らしい形」をした数字だけを取り出す（推定モード専用の厳しい版）。
    //
    // 「合計」の行が見つからないとき、以前は「一番大きい数字」を金額として
    // いたが、それだとレシートの責任番号や伝票番号（例: 39910）を
    // 金額として出してしまう事故が起きた。
    // そこで推定のときは、
    //   ・¥マーク付き（Yと誤読されたものも含む）… ¥580 / Y58
    //   ・カンマ区切り … 1,234
    // という"値段の見た目"をした数字だけを信用する。
    // ただの数字の羅列（39910 など）は、金額かどうか判断できないので使わない。
    function findPriceLikeNumbers(line) {
        const cleaned = stripNoise(line);
        const matches = cleaned.match(/[¥￥Yy]\s*\d{1,3}(?:,\d{3})*|[¥￥Yy]\s*\d+|\d{1,3}(?:,\d{3})+/g) || [];
        return matches
            .map(s => Number(s.replace(/[¥￥Yy,\s]/g, "")))
            .filter(n => !isNaN(n) && n > 0 && n < 10000000);
    }

    // レシート全体のテキストから合計金額を推定する（自動モード用）
    function extractAmount(text) {
        const lines = text.split("\n")
            .map(l => toHalfWidth(l).trim())
            .filter(l => l.length > 0);

        // ① 「合計」と書かれた行を探す（下から探す。小計→合計の順に並ぶため）
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (EXCLUDE_KEYWORD.test(line)) continue;
            if (TOTAL_KEYWORD.test(line)) {
                const nums = findNumbers(line);
                if (nums.length > 0) {
                    return { amount: Math.max(...nums), confident: true };
                }
            }
        }

        // ② 見つからなければ「金額らしい形」の数字（¥付き・カンマ区切り）の中から
        //    一番大きいものを合計とみなす。
        //    形が金額らしくない数字は、番号類の可能性があるので採用しない。
        let best = null;
        for (const line of lines) {
            if (EXCLUDE_KEYWORD.test(line)) continue;
            for (const n of findPriceLikeNumbers(line)) {
                if (best === null || n > best) best = n;
            }
        }
        return best === null ? null : { amount: best, confident: false };
    }

    function extractDate(text) {
        const t = toHalfWidth(text);

        // 「2026年7月17日」「2026/07/17」「2026-07-17」「2026.7.17」
        let m = t.match(/(20\d{2})\s*[年\/\-\.]\s*(\d{1,2})\s*[月\/\-\.]\s*(\d{1,2})/);
        if (m) {
            const [, y, mo, d] = m;
            if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
        }

        // 「令和6年7月17日」（令和1年 = 2019年）
        m = t.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
        if (m) {
            const [, r, mo, d] = m;
            if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${2018 + Number(r)}-${pad2(mo)}-${pad2(d)}`;
        }
        return null;
    }

    // ------------------------------------------------------------
    // 画像の前処理（ここがOCR精度の9割を決める）
    //
    // Tesseractは「スキャナで取り込んだ、白背景に黒文字のくっきりした画像」を想定している。
    // スマホで撮った写真をそのまま渡すと、影・傾き・低コントラストのせいでほぼ読めない。
    // そこでOCRにかける前に、写真を「スキャナで取ったような白黒画像」に変換する。
    // ------------------------------------------------------------

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
    // 画像全体で1つのしきい値を決める方法だと、レシートの左半分に影が落ちているだけで
    // その部分が真っ黒に潰れてしまう。
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
        // 大きすぎる写真は遅いだけ。小さすぎると文字が潰れて読めない。
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

        // グレースケール化（人間の目の感度に合わせた重み付け）
        const gray = new Uint8ClampedArray(w * h);
        for (let i = 0, j = 0; i < px.length; i += 4, j++) {
            gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        }

        // 適応的二値化で白黒はっきりさせる
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
    // Tesseractの結果を扱う補助
    // ------------------------------------------------------------

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

    function getWords(data) {
        if (Array.isArray(data.words) && data.words.length > 0) return data.words;
        const words = [];
        getLines(data).forEach(line => {
            (line.words || []).forEach(w => words.push(w));
        });
        return words;
    }

    // 「合計」が書かれている行を探して、その位置(bbox)を返す（自動モード用）
    function findTotalLine(lines) {
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const text = toHalfWidth(line.text || "").trim();
            if (!text) continue;
            if (EXCLUDE_KEYWORD.test(text)) continue;
            if (TOTAL_KEYWORD.test(text) && line.bbox) return { bbox: line.bbox, text };
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
        const w = x1 - x0, h = y1 - y0;
        if (w <= 2 || h <= 2) return null;

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
    // OCR本体
    // ------------------------------------------------------------

    function setProgress(percent, label) {
        progressBox.style.display = "block";
        barFill.style.width = percent + "%";
        statusText.textContent = label;
    }

    // 切り出した画像から「数字だけ」を読む（ここが精度の要）
    // psm: "7"=1行だけを読む / "6"=複数行の塊を読む
    async function readDigitsFrom(cropCanvas, progressBase, psm = "7") {
        let worker;
        try {
            // 数字認識には英語辞書の精度重視版(_best)を使う。
            // 英語辞書は小さいので、日本語の_best（数十MB）と違って負担が軽い。
            worker = await Tesseract.createWorker("eng", 1, {
                langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
                logger: (m) => {
                    if (m.status === "recognizing text") {
                        setProgress(progressBase + Math.round(m.progress * 10), "金額を読み取り中…");
                    }
                }
            });

            await worker.setParameters({
                tessedit_pageseg_mode: psm,
                // 読み取る文字を数字と記号だけに限定する。
                // こうすると「8」を「日」と誤読するような事故が起きなくなる。
                tessedit_char_whitelist: "0123456789,.¥￥"
            });

            const { data } = await worker.recognize(cropCanvas, {}, { text: true, blocks: true });

            // 金額の選び方:
            // ・明らかに大きい文字は合計金額であることが多い（レシートは合計を強調する）ので優先
            // ・同じくらいの大きさなら、一番右にあるものを採用する。
            //   文字種を数字に限定した副作用で「合計」ラベル自体も数字に誤読されるが、
            //   それは行の左側に出るので、右端優先で無視できる。
            let best = null;
            for (const word of getWords(data)) {
                if (!word.bbox) continue;
                const nums = findNumbers(toHalfWidth(word.text || ""));
                if (nums.length === 0) continue;
                const c = {
                    h: word.bbox.y1 - word.bbox.y0,
                    x1: word.bbox.x1,
                    amount: Math.max(...nums)
                };
                if (!best) best = c;
                else if (c.h > best.h * 1.25) best = c;                       // 明らかに大きい文字
                else if (c.h >= best.h * 0.8 && c.x1 > best.x1) best = c;     // 同格なら右端
            }
            if (best) return best.amount;

            // 単語の位置が取れない場合はテキスト全体から拾う
            const nums = findNumbers(toHalfWidth(data.text || ""));
            return nums.length > 0 ? Math.max(...nums) : null;
        } finally {
            if (worker) await worker.terminate();
        }
    }

    // 日本語で読む（囲んだ範囲の中から「合計」などのラベルを見つけるために使う）
    async function readJapanese(canvas, progressBase, progressSpan, label) {
        let worker;
        try {
            worker = await Tesseract.createWorker("jpn", 1, {
                logger: (m) => {
                    if (m.status === "recognizing text") {
                        setProgress(progressBase + Math.round(m.progress * progressSpan), label);
                    } else if (m.status === "loading language traineddata") {
                        setProgress(progressBase, "日本語辞書をダウンロード中…");
                    }
                }
            });
            await worker.setParameters({
                tessedit_pageseg_mode: "6",       // 1列に並んだ文字の塊として読む
                preserve_interword_spaces: "1"
            });
            const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
            return data;
        } finally {
            if (worker) await worker.terminate();
        }
    }

    // 読み取り結果を表示し、入力欄へ流し込む
    function showResult({ amount, date, cropUrl, rawText, note }) {
        let html = "<h4>📄 読み取り結果</h4>";

        if (amount !== null && amount !== undefined) {
            html += `<div class="ocr-found">${amount.toLocaleString()} 円</div>`;
            amountInput.value = amount;
            if (note) html += `<p class="ocr-note">${note}</p>`;
            if (cropUrl) {
                html += `<p class="ocr-note" style="margin-top:6px;">この部分を読みました:</p>
                         <img src="${cropUrl}" alt="読み取った範囲" style="max-width:100%; border:1px solid #ddd; border-radius:4px;">`;
            }
        } else {
            html += `<p class="ocr-note">⚠️ 金額を読み取れませんでした。<b>画像の上で合計の金額を指で囲んで「選択した範囲を読み取る」</b>を試すか、手で入力してください。</p>`;
            if (cropUrl) {
                html += `<p class="ocr-note" style="margin-top:6px;">読もうとした部分:</p>
                         <img src="${cropUrl}" alt="読み取った範囲" style="max-width:100%; border:1px solid #ddd; border-radius:4px;">`;
            }
        }

        if (date) {
            dateInput.value = date;
            html += `<p class="ocr-note">日付: ${escapeHtml(date)}</p>`;
        }

        // 店名の自動入力はしない。
        // 店名はOCRで最も読み取りが不安定なうえ、間違った文字が入ると
        // 消して打ち直す手間が増えて、かえって遅くなるため。
        html += `<p class="ocr-note" style="margin-top:8px;">金額を入れました。<b>項目名はご自身で入力してください</b>。内容を確認して保存を。</p>`;

        // 読み取った生テキストも見られるようにする（うまくいかない時の原因調査用）
        if (rawText !== undefined) {
            html += `
                <div class="ocr-raw-toggle" id="rawToggle">▶ 読み取った文字を見る</div>
                <div class="ocr-raw" id="rawText" style="display:none;">${escapeHtml(rawText.trim() || "(何も読み取れませんでした)")}</div>
            `;
        }

        resultBox.innerHTML = html;
        resultBox.style.display = "block";

        const toggle = document.getElementById("rawToggle");
        if (toggle) {
            const raw = document.getElementById("rawText");
            toggle.addEventListener("click", () => {
                const open = raw.style.display !== "none";
                raw.style.display = open ? "none" : "block";
                toggle.textContent = open ? "▶ 読み取った文字を見る" : "▼ 読み取った文字を隠す";
            });
        }

        amountInput.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // ------------------------------------------------------------
    // 範囲選択のUI（指でなぞって囲む）
    // ------------------------------------------------------------

    // 選択範囲（表示座標）を、画像の実座標に変換する
    function selectionToImageBox(sel) {
        return {
            x0: sel.x0 * imgScale,
            y0: sel.y0 * imgScale,
            x1: sel.x1 * imgScale,
            y1: sel.y1 * imgScale
        };
    }

    function normalized(sel) {
        return {
            x0: Math.min(sel.x0, sel.x1),
            y0: Math.min(sel.y0, sel.y1),
            x1: Math.max(sel.x0, sel.x1),
            y1: Math.max(sel.y0, sel.y1)
        };
    }

    // レシート画像と選択枠を描き直す
    function drawView() {
        const ctx = viewCanvas.getContext("2d");
        ctx.clearRect(0, 0, viewCanvas.width, viewCanvas.height);
        ctx.drawImage(processedCanvas, 0, 0, viewCanvas.width, viewCanvas.height);

        if (!selection) return;
        const s = normalized(selection);

        // 選択範囲の外側を暗くして、選んだ場所を目立たせる
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, viewCanvas.width, viewCanvas.height);
        ctx.drawImage(
            processedCanvas,
            s.x0 * imgScale, s.y0 * imgScale, (s.x1 - s.x0) * imgScale, (s.y1 - s.y0) * imgScale,
            s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0
        );

        ctx.strokeStyle = "#FF9800";
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
    }

    // 選択範囲を拡大して見せる（囲んだ場所が合っているか確認できる）
    function drawZoom() {
        if (!selection) { zoomWrap.style.display = "none"; return; }
        const s = normalized(selection);
        if (s.x1 - s.x0 < 4 || s.y1 - s.y0 < 4) { zoomWrap.style.display = "none"; return; }

        const box = selectionToImageBox(s);
        const w = box.x1 - box.x0, h = box.y1 - box.y0;
        const zoom = Math.min(4, Math.max(1, 600 / w));

        zoomCanvas.width = Math.round(w * zoom);
        zoomCanvas.height = Math.round(h * zoom);
        const ctx = zoomCanvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(processedCanvas, box.x0, box.y0, w, h, 0, 0, zoomCanvas.width, zoomCanvas.height);
        zoomWrap.style.display = "block";
    }

    // 指・マウスの位置を、canvas内の座標に変換する
    function pointerPos(e) {
        const rect = viewCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (viewCanvas.width / rect.width);
        const y = (e.clientY - rect.top) * (viewCanvas.height / rect.height);
        return {
            x: Math.min(Math.max(x, 0), viewCanvas.width),
            y: Math.min(Math.max(y, 0), viewCanvas.height)
        };
    }

    // pointerイベントを使うと、指でもマウスでも同じコードで扱える
    viewCanvas.addEventListener("pointerdown", (e) => {
        if (!processedCanvas || busy) return;
        e.preventDefault();
        viewCanvas.setPointerCapture(e.pointerId);
        const p = pointerPos(e);
        selection = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        dragging = true;
        drawView();
    });

    viewCanvas.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        e.preventDefault();
        const p = pointerPos(e);
        selection.x1 = p.x;
        selection.y1 = p.y;
        drawView();
    });

    function endDrag() {
        if (!dragging) return;
        dragging = false;
        const s = normalized(selection);
        // 小さすぎる選択（誤タップ）は無効にする
        if (s.x1 - s.x0 < 8 || s.y1 - s.y0 < 8) {
            selection = null;
            readSelectionBtn.disabled = true;
            zoomWrap.style.display = "none";
        } else {
            readSelectionBtn.disabled = false;
            drawZoom();
        }
        drawView();
    }

    viewCanvas.addEventListener("pointerup", endDrag);
    viewCanvas.addEventListener("pointercancel", endDrag);

    // ------------------------------------------------------------
    // メイン処理
    // ------------------------------------------------------------

    // ① 写真が選ばれたら、前処理して範囲選択の画面を出す
    receiptInput.addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        resultBox.style.display = "none";
        zoomWrap.style.display = "none";
        selection = null;
        readSelectionBtn.disabled = true;

        if (typeof Tesseract === "undefined") {
            setProgress(0, "OCRの読み込みに失敗しました（通信環境を確認してください）");
            return;
        }

        try {
            setProgress(30, "画像を処理しています…");
            const img = await loadImage(file);
            processedCanvas = preprocessToCanvas(img);

            // 表示用のサイズを決める（画面に収まる範囲で、なるべく大きく）
            const displayWidth = Math.min(processedCanvas.width, 700);
            viewCanvas.width = displayWidth;
            viewCanvas.height = Math.round(processedCanvas.height * (displayWidth / processedCanvas.width));
            imgScale = processedCanvas.width / viewCanvas.width;

            drawView();
            cropArea.style.display = "block";
            setProgress(100, "合計の金額を指でなぞって囲んでください");
            setTimeout(() => { progressBox.style.display = "none"; }, 1500);
        } catch (err) {
            console.error("画像処理エラー:", err);
            setProgress(0, "画像を読み込めませんでした。");
        }
    });

    // ② 「選択した範囲を読み取る」
    //
    // 以前はここで「数字専用・1行モード」で直接読んでいたが、
    // ユーザーは自然に合計のあたりを"数行まとめて"囲む（実際にそうだった）。
    // 1行モードに複数行を渡すと何も読めなくなるため、3段構えに変更した。
    //   ① 囲んだ範囲を日本語で読み「合計」の行を特定 → その行だけ数字専用で読む
    //   ② 行の特定に失敗したら、日本語の読み取り結果から金額らしい数字を探す
    //   ③ それでもダメなら、範囲全体を数字専用の複数行モードで読む
    readSelectionBtn.addEventListener("click", async () => {
        if (!processedCanvas || !selection || busy) return;
        busy = true;
        readSelectionBtn.disabled = true;
        readAllBtn.disabled = true;
        // 前回の結果を消す。これをしないと、再読み取り中も古い結果が
        // 表示されたままになり「押したのに変化がない」ように見えてしまう。
        resultBox.style.display = "none";

        try {
            setProgress(10, "準備しています…（初回は辞書のダウンロードがあります）");
            const box = selectionToImageBox(normalized(selection));
            // 拡大率は「拡大後の幅が2000px程度」を上限に（大きすぎるとスマホで重い）
            const zoom = Math.max(1.5, Math.min(3, 2000 / (box.x1 - box.x0)));
            const crop = cropAndZoom(processedCanvas, box, zoom, 4);
            if (!crop) {
                setProgress(0, "範囲が小さすぎます。もう少し大きく囲んでください。");
                return;
            }

            // ① 日本語で読んで「合計」の行を探す
            const data = await readJapanese(crop, 15, 55, "選択した範囲を読み取り中…");
            const text = data.text || "";
            let amount = null;
            let note = null;
            let cropUrl = crop.toDataURL("image/png");

            const totalLine = findTotalLine(getLines(data));
            if (totalLine) {
                setProgress(72, "「合計」の行を数字専用モードで読み直しています…");
                const lineCrop = cropAndZoom(crop, totalLine.bbox, 2, 6);
                if (lineCrop) {
                    amount = await readDigitsFrom(lineCrop, 80, "7");
                    if (amount !== null) {
                        cropUrl = lineCrop.toDataURL("image/png");
                        // どの行を「合計」と判断したかを見せる（小計との混同にすぐ気づけるように）
                        note = `✅ この行を合計と判断しました:「${escapeHtml(totalLine.text)}」`;
                    }
                }
            }

            // ② 日本語の読み取り結果から金額を探す
            if (amount === null) {
                const info = extractAmount(text);
                if (info) {
                    amount = info.amount;
                    note = info.confident
                        ? "「合計」の行から読み取りました"
                        : "⚠️ 囲んだ範囲から金額らしい数字を拾いました。違っていたら直してください。";
                }
            }

            // ③ 数字専用の複数行モードで読む
            //    （1行だけをきっちり囲んだ場合や、日本語が全滅した場合の保険）
            if (amount === null) {
                setProgress(85, "数字だけを読み直しています…");
                amount = await readDigitsFrom(crop, 88, "6");
                if (amount !== null) {
                    note = "⚠️ 数字だけを読み取りました。合計の金額か確認してください。";
                }
            }

            setProgress(100, "完了！");
            showResult({ amount, cropUrl, rawText: text, note });
        } catch (err) {
            console.error("OCRエラー:", err);
            setProgress(0, "読み取りに失敗しました。もう一度お試しください。");
        } finally {
            busy = false;
            readSelectionBtn.disabled = false;
            readAllBtn.disabled = false;
            setTimeout(() => { progressBox.style.display = "none"; }, 1200);
        }
    });

    // ③ 「全体から自動で探す」… 日本語OCRで「合計」の行を探してから数字を読む
    readAllBtn.addEventListener("click", async () => {
        if (!processedCanvas || busy) return;
        busy = true;
        readSelectionBtn.disabled = true;
        readAllBtn.disabled = true;
        // 前回の結果を消す（再読み取りだと分かるように）
        resultBox.style.display = "none";

        let jpnWorker;
        try {
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
                tessedit_pageseg_mode: "6",       // 1列に並んだ文字の塊として読む
                preserve_interword_spaces: "1"    // 「合計 842」を分けて読むため
            });

            const { data } = await jpnWorker.recognize(processedCanvas, {}, { text: true, blocks: true });
            const text = data.text || "";
            const date = extractDate(text);

            // 「合計」の行が見つかれば、その行だけを数字専用で読み直す（2段階OCR）
            const totalLine = findTotalLine(getLines(data));
            if (totalLine) {
                setProgress(72, "合計の行を数字専用モードで読み直しています…");
                const crop = cropAndZoom(processedCanvas, totalLine.bbox, 3, 6);
                if (crop) {
                    const amount = await readDigitsFrom(crop, 80);
                    if (amount !== null) {
                        setProgress(100, "完了！");
                        showResult({
                            amount, date, rawText: text,
                            cropUrl: crop.toDataURL("image/png"),
                            note: `✅ この行を合計と判断しました:「${escapeHtml(totalLine.text)}」`
                        });
                        return;
                    }
                }
            }

            // 見つからなければ、テキスト全体から推定する
            const fallback = extractAmount(text);
            setProgress(100, "完了！");
            showResult({
                amount: fallback ? fallback.amount : null,
                date,
                rawText: text,
                note: fallback && !fallback.confident
                    ? "⚠️ 「合計」が見つからず、一番大きい数字を採用しました。<b>指で囲む方が正確です</b>。"
                    : (fallback ? "「合計」の行から読み取りました" : null)
            });
        } catch (err) {
            console.error("OCRエラー:", err);
            setProgress(0, "読み取りに失敗しました。もう一度お試しください。");
        } finally {
            if (jpnWorker) await jpnWorker.terminate();
            busy = false;
            readSelectionBtn.disabled = !selection;
            readAllBtn.disabled = false;
            setTimeout(() => { progressBox.style.display = "none"; }, 1200);
        }
    });
})();
