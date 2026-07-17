// main.js - 登録画面の動作（index.html と組み合わせ）
(() => {
    // 要素取得
    const allowanceInput = document.getElementById("allowanceInput");
    const allowanceDisplay = document.getElementById("allowanceDisplay");
    const saveAllowanceBtn = document.getElementById("saveAllowanceBtn");

    const saveExpenseBtn = document.getElementById("saveExpenseBtn");
    const itemInput = document.getElementById("item");
    const amountInput = document.getElementById("amount");
    const categoryInput = document.getElementById("category");
    const dateInput = document.getElementById("dateInput");
    const balanceDisplay = document.getElementById("balanceDisplay");

    // 満足度セレクター
    const satisfactionGroup = document.getElementById("satisfactionGroup");
    let selectedSatisfaction = "ok";
    if (satisfactionGroup) {
        satisfactionGroup.querySelectorAll(".sat-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                satisfactionGroup.querySelectorAll(".sat-btn").forEach(b => b.classList.remove("selected"));
                btn.classList.add("selected");
                selectedSatisfaction = btn.dataset.value;
            });
        });
    }

    // ペース ダッシュボード要素
    const mascotEl = document.getElementById("mascot");
    const paceMessageEl = document.getElementById("paceMessage");
    const paceSubEl = document.getElementById("paceSub");
    const paceBarFillEl = document.getElementById("paceBarFill");
    const paceBarCaptionEl = document.getElementById("paceBarCaption");

    // ✅ メッセージ表示用エリア（バランスの下に一時的に表示）
    const messageBox = document.createElement("p");
    messageBox.style.color = "#4CAF50";
    messageBox.style.fontWeight = "bold";
    messageBox.style.transition = "opacity 0.5s";
    messageBox.style.opacity = "0";
    balanceDisplay.insertAdjacentElement("afterend", messageBox);

    // ✅ 一時メッセージ表示関数
    function showMessage(text, color = "#4CAF50") {
        messageBox.textContent = text;
        messageBox.style.color = color;
        messageBox.style.opacity = "1";
        setTimeout(() => (messageBox.style.opacity = "0"), 2000);
    }

    // 今月のキー（例: "2026-07"）
    function getCurrentMonthKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    // 一意なIDを生成（編集・削除で確実に対象を特定するため）
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // 💰 お小遣い保存（月ごとに保持）
    saveAllowanceBtn.addEventListener("click", () => {
        const amount = Number(allowanceInput.value);
        if (!amount || amount <= 0) {
            showMessage("金額を正しく入力してください。", "red");
            return;
        }

        const allowances = JSON.parse(localStorage.getItem("allowances") || "{}");
        allowances[getCurrentMonthKey()] = amount;
        localStorage.setItem("allowances", JSON.stringify(allowances));

        allowanceDisplay.textContent = `今月のお小遣い：${amount.toLocaleString()} 円`;
        allowanceDisplay.style.color = "";
        allowanceDisplay.style.fontSize = "";
        updateBalance();
        updatePace();
        allowanceInput.value = "";
        showMessage("お小遣いを保存しました！");
    });

    // 💸 支出保存
    saveExpenseBtn.addEventListener("click", () => {
        const date = dateInput.value || new Date().toISOString().split("T")[0];
        const item = itemInput.value.trim();
        const amount = Number(amountInput.value);
        const category = categoryInput.value;

        if (!item || !amount || amount <= 0) {
            showMessage("項目と金額を正しく入力してください。", "red");
            return;
        }

        // 月データを自動付与（タイムゾーンずれ防止のため文字列から直接取得）
        const monthKey = date.slice(0, 7);

        const expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
        expenses.push({ id: generateId(), date, item, amount, category, month: monthKey, satisfaction: selectedSatisfaction });
        localStorage.setItem("expenses", JSON.stringify(expenses));

        itemInput.value = "";
        amountInput.value = "";
        dateInput.value = new Date().toISOString().split("T")[0];
        updateBalance();
        updatePace();
        showMessage("支出を保存しました！");
    });

    // 💹 残高計算（今月分のみ）
    function updateBalance() {
        const monthKey = getCurrentMonthKey();
        const allowances = JSON.parse(localStorage.getItem("allowances") || "{}");
        const allowance = Number(allowances[monthKey] || 0);
        const expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
        const totalExpense = expenses
            .filter(e => (e.month || e.date.slice(0, 7)) === monthKey)
            .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        const balance = allowance - totalExpense;
        balanceDisplay.textContent = `今月の残高：${balance.toLocaleString()} 円`;
    }

    // 🐱 今月のペース予測＋応援キャラ
    function updatePace() {
        if (!mascotEl) return;

        const now = new Date();
        const monthKey = getCurrentMonthKey();
        const allowances = JSON.parse(localStorage.getItem("allowances") || "{}");
        const allowance = Number(allowances[monthKey] || 0);
        const expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
        const spent = expenses
            .filter(e => (e.month || e.date.slice(0, 7)) === monthKey)
            .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

        // お小遣い未設定
        if (allowance <= 0) {
            mascotEl.textContent = "🐱";
            paceMessageEl.textContent = "まずは今月のお小遣いを登録してね";
            paceSubEl.textContent = "登録すると、使いすぎていないかを毎日チェックできるよ";
            paceBarFillEl.style.width = "0%";
            paceBarCaptionEl.textContent = "";
            return;
        }

        const dayOfMonth = now.getDate();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        // 経過日数から月末の支出を予測（1日あたりのペース × 日数）
        const projected = spent / dayOfMonth * daysInMonth;
        const overDiff = projected - allowance;      // プラスなら予測オーバー額
        const remaining = allowance - spent;          // 現在の残高
        const usedRatio = spent / allowance;          // 使用済み割合

        // バーは「使った割合」を表示（100%超は赤で振り切り）
        const fillPercent = Math.min(usedRatio * 100, 100);
        paceBarFillEl.style.width = fillPercent + "%";
        paceBarCaptionEl.textContent =
            `使用 ${spent.toLocaleString()} 円 / ${allowance.toLocaleString()} 円（${Math.round(usedRatio * 100)}%）`;

        // 状態判定（月末予測 ÷ お小遣い）
        const projectedRatio = projected / allowance;
        let mascot, message, color;

        if (spent > allowance) {
            mascot = "🙀";
            color = "#f44336";
            message = `お小遣いを ${Math.abs(remaining).toLocaleString()} 円オーバー！`;
        } else if (projectedRatio > 1.2) {
            mascot = "🙀";
            color = "#f44336";
            message = `このペースだと月末に約 ${Math.round(overDiff).toLocaleString()} 円オーバーしそう…`;
        } else if (projectedRatio > 1.0) {
            mascot = "😿";
            color = "#ff9800";
            message = `ちょっとペース早め。月末は約 ${Math.round(overDiff).toLocaleString()} 円オーバー予測`;
        } else if (projectedRatio > 0.8) {
            mascot = "🐱";
            color = "#4CAF50";
            message = `ちょうどいいペース！残り ${remaining.toLocaleString()} 円`;
        } else {
            mascot = "😺";
            color = "#4CAF50";
            message = `余裕があるニャ♪ 残り ${remaining.toLocaleString()} 円`;
        }

        mascotEl.textContent = mascot;
        paceMessageEl.textContent = message;
        paceBarFillEl.style.background = color;

        // 1日あたりの目安（残り日数で残額を割る）
        const daysLeft = daysInMonth - dayOfMonth + 1;
        if (remaining > 0 && daysLeft > 0) {
            const perDay = Math.floor(remaining / daysLeft);
            paceSubEl.textContent = `1日あたり約 ${perDay.toLocaleString()} 円まで使えるよ（残り${daysLeft}日）`;
        } else if (remaining <= 0) {
            paceSubEl.textContent = `今月はもうお小遣いを使い切っています`;
        } else {
            paceSubEl.textContent = "";
        }
    }

    // 🚀 初期表示
    window.addEventListener("load", () => {
        // 日付の初期値を今日にしておく
        if (dateInput && !dateInput.value) {
            dateInput.value = new Date().toISOString().split("T")[0];
        }

        // お小遣いは月ごとに独立。新しい月になったら必ず0円スタート（自動の繰り越しはしない）
        const allowances = JSON.parse(localStorage.getItem("allowances") || "{}");
        const allowance = allowances[getCurrentMonthKey()];
        if (allowance) {
            allowanceDisplay.textContent = `今月のお小遣い：${Number(allowance).toLocaleString()} 円`;
        } else {
            allowanceDisplay.textContent = "今月はまだ未登録です（月ごとに設定します）";
            allowanceDisplay.style.color = "#999";
            allowanceDisplay.style.fontSize = "0.85em";
        }
        updateBalance();
        updatePace();
    });
})();
