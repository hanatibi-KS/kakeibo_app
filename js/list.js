// list.js - 明細一覧画面のスクリプト
(() => {
    const tableBody = document.querySelector("#expenseTable tbody");
    const totalDisplay = document.getElementById("totalDisplay");
    const balanceDisplay = document.getElementById("balanceDisplay");
<<<<<<< HEAD
    const monthLabel = document.getElementById("monthLabel");
    const prevMonthBtn = document.getElementById("prevMonthBtn");
    const nextMonthBtn = document.getElementById("nextMonthBtn");
=======
    const monthSelect = document.getElementById("monthSelect");
    const filterBtn = document.getElementById("filterBtn");
>>>>>>> 4c0a4cb6356b44965b37547af93aa14d8da8af35
    const toggleChartBtn = document.getElementById("toggleChartBtn");
    const categoryChartCanvas = document.getElementById("categoryChart");

    let chartInstance = null;

<<<<<<< HEAD
    // 現在表示中の年月（例: "2026-03"）
    const now = new Date();
    let currentYear = now.getFullYear();
    let currentMonth = now.getMonth() + 1;

    function getCurrentMonthStr() {
        return `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
    }

    function updateMonthLabel() {
        monthLabel.textContent = `${currentYear}年${currentMonth}月`;
    }

=======
>>>>>>> 4c0a4cb6356b44965b37547af93aa14d8da8af35
    // 支出データ読み込み＆表示
    function loadExpenses(month = "") {
        const expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
        const allowance = Number(localStorage.getItem("monthlyAllowance") || 0);
        const filtered = month ? expenses.filter(e => e.date.startsWith(month)) : expenses;

        tableBody.innerHTML = "";
        let total = 0;
        const categoryTotals = {};

        filtered.forEach((e, index) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${e.date}</td>
                <td>${e.item}</td>
                <td>${Number(e.amount).toLocaleString()} 円</td>
                <td>${e.category}</td>
                <td>
                    <button class="editBtn" style="background-color:#2196f3;color:#fff;border:none;padding:4px 10px;border-radius:5px;">編集</button>
                    <button class="deleteBtn" style="background-color:#f44336;color:#fff;border:none;padding:4px 10px;border-radius:5px;">削除</button>
                </td>
            `;
            tableBody.appendChild(row);

            total += Number(e.amount);
            categoryTotals[e.category] = (categoryTotals[e.category] || 0) + Number(e.amount);

<<<<<<< HEAD
            // 編集ボタン
=======
            // 編集ボタン（モーダル）
>>>>>>> 4c0a4cb6356b44965b37547af93aa14d8da8af35
            row.querySelector(".editBtn").addEventListener("click", () => openEditModal(e, index, month));

            // 削除ボタン
            row.querySelector(".deleteBtn").addEventListener("click", () => {
                if (confirm("この項目を削除しますか？")) {
                    expenses.splice(index, 1);
                    localStorage.setItem("expenses", JSON.stringify(expenses));
                    loadExpenses(month);
                }
            });
        });

        totalDisplay.textContent = `合計支出：${total.toLocaleString()} 円`;
        balanceDisplay.textContent = `残高：${(allowance - total).toLocaleString()} 円`;

        updateChart(categoryTotals);
    }

    // グラフ描画
    function updateChart(categoryTotals) {
        if (chartInstance) chartInstance.destroy();
        const categories = Object.keys(categoryTotals);
        const amounts = Object.values(categoryTotals);
        const totalAmount = amounts.reduce((a, b) => a + b, 0);
        const percentages = amounts.map(a => ((a / totalAmount) * 100).toFixed(1) + "%");

        chartInstance = new Chart(categoryChartCanvas, {
            type: "pie",
            data: {
                labels: categories.map((c, i) => `${c} (${percentages[i]})`),
                datasets: [{
                    data: amounts,
                    backgroundColor: ["#ff6384", "#36a2eb", "#ffce56", "#4caf50"]
                }]
            },
            options: {
                plugins: { legend: { position: "bottom" } }
            }
        });
    }

    // 編集モーダル
    function openEditModal(entry, index, month) {
        const modal = document.createElement("div");
        modal.innerHTML = `
            <div style="
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
            ">
                <div style="background: #fff; padding: 20px; border-radius: 10px; width: 300px; text-align: center;">
                    <h3>編集</h3>
                    <label>項目：</label><br>
                    <input id="editItem" value="${entry.item}" style="width: 90%; margin:5px 0;"><br>
                    <label>金額：</label><br>
                    <input id="editAmount" type="number" value="${entry.amount}" style="width: 90%; margin:5px 0;"><br>
                    <label>カテゴリ：</label><br>
<<<<<<< HEAD
                    <select id="editCategory" style="width: 90%; margin:5px 0; padding:6px; border:1px solid #ccc; border-radius:6px;">
                        <option value="食費" ${entry.category === "食費" ? "selected" : ""}>食費</option>
                        <option value="交通費" ${entry.category === "交通費" ? "selected" : ""}>交通費</option>
                        <option value="娯楽費" ${entry.category === "娯楽費" ? "selected" : ""}>娯楽費</option>
                        <option value="その他" ${entry.category === "その他" ? "selected" : ""}>その他</option>
                    </select><br>
=======
                    <input id="editCategory" value="${entry.category}" style="width: 90%; margin:5px 0;"><br>
>>>>>>> 4c0a4cb6356b44965b37547af93aa14d8da8af35
                    <button id="saveEdit" style="background:#4caf50;color:#fff;padding:6px 12px;margin-top:10px;border:none;border-radius:5px;">保存</button>
                    <button id="cancelEdit" style="background:#f44336;color:#fff;padding:6px 12px;margin-top:10px;border:none;border-radius:5px;">キャンセル</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector("#saveEdit").addEventListener("click", () => {
            const newItem = modal.querySelector("#editItem").value.trim();
            const newAmount = Number(modal.querySelector("#editAmount").value);
<<<<<<< HEAD
            const newCategory = modal.querySelector("#editCategory").value;
=======
            const newCategory = modal.querySelector("#editCategory").value.trim();
>>>>>>> 4c0a4cb6356b44965b37547af93aa14d8da8af35
            if (!newItem || !newAmount || !newCategory) {
                alert("すべての項目を入力してください。");
                return;
            }
            const expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
            expenses[index] = { ...expenses[index], item: newItem, amount: newAmount, category: newCategory };
            localStorage.setItem("expenses", JSON.stringify(expenses));
            document.body.removeChild(modal);
            loadExpenses(month);
        });

        modal.querySelector("#cancelEdit").addEventListener("click", () => {
            document.body.removeChild(modal);
        });
    }

<<<<<<< HEAD
    // 前月ボタン
    prevMonthBtn.addEventListener("click", () => {
        currentMonth--;
        if (currentMonth < 1) { currentMonth = 12; currentYear--; }
        updateMonthLabel();
        loadExpenses(getCurrentMonthStr());
    });

    // 次月ボタン
    nextMonthBtn.addEventListener("click", () => {
        currentMonth++;
        if (currentMonth > 12) { currentMonth = 1; currentYear++; }
        updateMonthLabel();
        loadExpenses(getCurrentMonthStr());
=======
    // 月別表示ボタン
    filterBtn.addEventListener("click", () => {
        const selectedMonth = monthSelect.value;
        loadExpenses(selectedMonth);
>>>>>>> 4c0a4cb6356b44965b37547af93aa14d8da8af35
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

<<<<<<< HEAD
    // 初期ロード（今月を表示）
    window.addEventListener("load", () => {
        updateMonthLabel();
        loadExpenses(getCurrentMonthStr());
    });
=======
    // 初期ロード
    window.addEventListener("load", () => loadExpenses());
>>>>>>> 4c0a4cb6356b44965b37547af93aa14d8da8af35
})();
