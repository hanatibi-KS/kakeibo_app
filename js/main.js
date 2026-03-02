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

    // 💰 お小遣い保存
    saveAllowanceBtn.addEventListener("click", () => {
        const amount = Number(allowanceInput.value);
        if (!amount || amount <= 0) {
            showMessage("金額を正しく入力してください。", "red");
            return;
        }

        localStorage.setItem("monthlyAllowance", amount);
        allowanceDisplay.textContent = `今月のお小遣い：${amount.toLocaleString()} 円`;
        updateBalance();
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

        // ✅ 月データを自動付与（タイムゾーンずれ防止のため文字列から直接取得）
        const monthKey = date.slice(0, 7);

        const expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
        expenses.push({ date, item, amount, category, month: monthKey });
        localStorage.setItem("expenses", JSON.stringify(expenses));

        itemInput.value = "";
        amountInput.value = "";
        dateInput.value = "";
        updateBalance();
        showMessage("支出を保存しました！");
    });

    // 💹 残高計算
    function updateBalance() {
        const allowance = Number(localStorage.getItem("monthlyAllowance") || 0);
        const expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
        const totalExpense = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        const balance = allowance - totalExpense;
        balanceDisplay.textContent = `現在の残高：${balance.toLocaleString()} 円`;
    }

    // 🚀 初期表示
    window.addEventListener("load", () => {
        const allowance = localStorage.getItem("monthlyAllowance");
        if (allowance)
            allowanceDisplay.textContent = `今月のお小遣い：${Number(allowance).toLocaleString()} 円`;
        updateBalance();
    });
})();
