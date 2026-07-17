// list.js - 明細一覧画面のスクリプト
(() => {
    const tableBody = document.querySelector("#expenseTable tbody");
    const totalDisplay = document.getElementById("totalDisplay");
    const balanceDisplay = document.getElementById("balanceDisplay");
    const monthLabel = document.getElementById("monthLabel");
    const prevMonthBtn = document.getElementById("prevMonthBtn");
    const nextMonthBtn = document.getElementById("nextMonthBtn");
    const toggleChartBtn = document.getElementById("toggleChartBtn");
    const categoryChartCanvas = document.getElementById("categoryChart");
    const reviewBox = document.getElementById("reviewBox");

    let chartInstance = null;

    // 満足度の表示用マップ
    const SAT_EMOJI = { good: "◎", ok: "○", bad: "△" };

    // 現在表示中の年月（例: "2026-07"）
    const now = new Date();
    let currentYear = now.getFullYear();
    let currentMonth = now.getMonth() + 1;

    function getCurrentMonthStr() {
        return `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
    }

    function updateMonthLabel() {
        monthLabel.textContent = `${currentYear}年${currentMonth}月`;
    }

    // 古いデータにID・monthが無ければ補完する（後方互換）
    function normalizeExpenses(expenses) {
        let changed = false;
        expenses.forEach(e => {
            if (!e.id) {
                e.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
                changed = true;
            }
            if (!e.month && e.date) {
                e.month = e.date.slice(0, 7);
                changed = true;
            }
        });
        if (changed) localStorage.setItem("expenses", JSON.stringify(expenses));
        return expenses;
    }

    // 支出データ読み込み＆表示
    function loadExpenses() {
        const month = getCurrentMonthStr();
        const expenses = normalizeExpenses(JSON.parse(localStorage.getItem("expenses") || "[]"));
        const allowances = JSON.parse(localStorage.getItem("allowances") || "{}");
        const allowance = Number(allowances[month] || 0);

        const filtered = expenses.filter(e => (e.month || e.date.slice(0, 7)) === month);

        tableBody.innerHTML = "";
        let total = 0;
        const categoryTotals = {};

        if (filtered.length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = `<td colspan="6" style="color:#999; padding:16px;">この月の支出はまだありません</td>`;
            tableBody.appendChild(row);
        }

        filtered.forEach((e) => {
            const row = document.createElement("tr");
            const satMark = SAT_EMOJI[e.satisfaction] || "-";
            // 月はヘッダーに出ているので、日付は「7/17」形式に短縮して横幅を節約
            const [, m, d] = e.date.split("-");
            const shortDate = `${Number(m)}/${Number(d)}`;
            row.innerHTML = `
                <td>${shortDate}</td>
                <td>${escapeHtml(e.item)}</td>
                <td>${Number(e.amount).toLocaleString()}円</td>
                <td>${escapeHtml(e.category)}</td>
                <td class="sat-emoji">${satMark}</td>
                <td class="ops">
                    <button class="editBtn row-btn">編集</button>
                    <button class="deleteBtn row-btn del">削除</button>
                </td>
            `;
            tableBody.appendChild(row);

            total += Number(e.amount);
            categoryTotals[e.category] = (categoryTotals[e.category] || 0) + Number(e.amount);

            // 編集ボタン（モーダル）— IDで対象を特定
            row.querySelector(".editBtn").addEventListener("click", () => openEditModal(e.id));

            // 削除ボタン — IDで対象を特定
            row.querySelector(".deleteBtn").addEventListener("click", () => {
                if (confirm("この項目を削除しますか？")) {
                    const all = JSON.parse(localStorage.getItem("expenses") || "[]");
                    const next = all.filter(x => x.id !== e.id);
                    localStorage.setItem("expenses", JSON.stringify(next));
                    loadExpenses();
                }
            });
        });

        totalDisplay.textContent = `合計支出：${total.toLocaleString()} 円`;
        const balance = allowance - total;
        balanceDisplay.textContent = `残高：${balance.toLocaleString()} 円`;
        balanceDisplay.style.color = balance < 0 ? "#f44336" : "#333";

        updateChart(categoryTotals);
        updateReview(filtered);
    }

    // 振り返り：満足度が「△いまいち」の支出を集計し、ムダ遣い候補として提示
    function updateReview(list) {
        if (!reviewBox) return;

        const regrets = list
            .filter(e => e.satisfaction === "bad")
            .sort((a, b) => Number(b.amount) - Number(a.amount));

        if (list.length === 0) {
            reviewBox.className = "review-box";
            reviewBox.innerHTML = "";
            return;
        }

        if (regrets.length === 0) {
            reviewBox.className = "review-box all-good";
            reviewBox.innerHTML = `😊 この月は「いまいち」な支出ゼロ！満足のいくお金の使い方ができています。`;
            return;
        }

        const regretTotal = regrets.reduce((sum, e) => sum + Number(e.amount), 0);
        const items = regrets
            .slice(0, 5)
            .map(e => `<div class="review-item">・${escapeHtml(e.item)}（${escapeHtml(e.category)}）— ${Number(e.amount).toLocaleString()} 円</div>`)
            .join("");

        reviewBox.className = "review-box has-items";
        reviewBox.innerHTML = `
            <p class="review-title">🔍 ムダ遣い候補（満足度△）</p>
            ${items}
            <p class="review-total">合計 ${regretTotal.toLocaleString()} 円ぶんが「いまいち」でした</p>
            <p class="review-item" style="margin-top:6px;">次に同じ場面が来たら、ちょっと立ち止まってみよう。</p>
        `;
    }

    // HTMLエスケープ（項目名などの入力を安全に表示）
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // グラフ描画
    function updateChart(categoryTotals) {
        if (chartInstance) chartInstance.destroy();
        const categories = Object.keys(categoryTotals);
        const amounts = Object.values(categoryTotals);
        const totalAmount = amounts.reduce((a, b) => a + b, 0);

        if (totalAmount === 0) {
            // データが無ければグラフは描かない
            return;
        }

        const percentages = amounts.map(a => ((a / totalAmount) * 100).toFixed(1) + "%");

        chartInstance = new Chart(categoryChartCanvas, {
            type: "pie",
            data: {
                labels: categories.map((c, i) => `${c} (${percentages[i]})`),
                datasets: [{
                    data: amounts,
                    backgroundColor: ["#ff6384", "#36a2eb", "#ffce56", "#4caf50", "#9c27b0", "#ff9800"]
                }]
            },
            options: {
                plugins: { legend: { position: "bottom" } }
            }
        });
    }

    // 編集モーダル（IDで対象を特定）
    function openEditModal(id) {
        const expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
        const entry = expenses.find(e => e.id === id);
        if (!entry) return;

        const modal = document.createElement("div");
        modal.innerHTML = `
            <div style="
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;
            ">
                <div style="background: #fff; padding: 20px; border-radius: 10px; width: 300px; text-align: center;">
                    <h3>編集</h3>
                    <label>項目：</label><br>
                    <input id="editItem" value="${escapeHtml(entry.item)}" style="width: 90%; margin:5px 0;"><br>
                    <label>金額：</label><br>
                    <input id="editAmount" type="number" value="${entry.amount}" style="width: 90%; margin:5px 0;"><br>
                    <label>カテゴリ：</label><br>
                    <select id="editCategory" style="width: 90%; margin:5px 0; padding:6px; border:1px solid #ccc; border-radius:6px;">
                        <option value="食費" ${entry.category === "食費" ? "selected" : ""}>食費</option>
                        <option value="交通費" ${entry.category === "交通費" ? "selected" : ""}>交通費</option>
                        <option value="娯楽費" ${entry.category === "娯楽費" ? "selected" : ""}>娯楽費</option>
                        <option value="その他" ${entry.category === "その他" ? "selected" : ""}>その他</option>
                    </select><br>
                    <label>満足度：</label><br>
                    <select id="editSatisfaction" style="width: 90%; margin:5px 0; padding:6px; border:1px solid #ccc; border-radius:6px;">
                        <option value="good" ${entry.satisfaction === "good" ? "selected" : ""}>◎ 満足</option>
                        <option value="ok" ${(!entry.satisfaction || entry.satisfaction === "ok") ? "selected" : ""}>○ 普通</option>
                        <option value="bad" ${entry.satisfaction === "bad" ? "selected" : ""}>△ いまいち</option>
                    </select><br>
                    <button id="saveEdit" style="background:#4caf50;color:#fff;padding:6px 12px;margin-top:10px;border:none;border-radius:5px;">保存</button>
                    <button id="cancelEdit" style="background:#f44336;color:#fff;padding:6px 12px;margin-top:10px;border:none;border-radius:5px;">キャンセル</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector("#saveEdit").addEventListener("click", () => {
            const newItem = modal.querySelector("#editItem").value.trim();
            const newAmount = Number(modal.querySelector("#editAmount").value);
            const newCategory = modal.querySelector("#editCategory").value;
            const newSatisfaction = modal.querySelector("#editSatisfaction").value;
            if (!newItem || !newAmount || newAmount <= 0 || !newCategory) {
                alert("すべての項目を正しく入力してください。");
                return;
            }
            const all = JSON.parse(localStorage.getItem("expenses") || "[]");
            const idx = all.findIndex(e => e.id === id);
            if (idx !== -1) {
                all[idx] = { ...all[idx], item: newItem, amount: newAmount, category: newCategory, satisfaction: newSatisfaction };
                localStorage.setItem("expenses", JSON.stringify(all));
            }
            document.body.removeChild(modal);
            loadExpenses();
        });

        modal.querySelector("#cancelEdit").addEventListener("click", () => {
            document.body.removeChild(modal);
        });
    }

    // 前月ボタン
    prevMonthBtn.addEventListener("click", () => {
        currentMonth--;
        if (currentMonth < 1) { currentMonth = 12; currentYear--; }
        updateMonthLabel();
        loadExpenses();
    });

    // 次月ボタン
    nextMonthBtn.addEventListener("click", () => {
        currentMonth++;
        if (currentMonth > 12) { currentMonth = 1; currentYear++; }
        updateMonthLabel();
        loadExpenses();
    });

    // グラフの表示切り替え
    toggleChartBtn.addEventListener("click", () => {
        if (categoryChartCanvas.style.display === "none") {
            categoryChartCanvas.style.display = "block";
            toggleChartBtn.textContent = "グラフを隠す";
        } else {
            categoryChartCanvas.style.display = "none";
            toggleChartBtn.textContent = "グラフを表示";
        }
    });

    // 初期ロード（今月を表示）
    window.addEventListener("load", () => {
        updateMonthLabel();
        loadExpenses();
    });
})();
