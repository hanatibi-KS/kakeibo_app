// list.js - 明細一覧画面のスクリプト
(() => {
    const tableBody = document.querySelector("#expenseTable tbody");
    const totalDisplay = document.getElementById("totalDisplay");
    const balanceDisplay = document.getElementById("balanceDisplay");
    const monthSelect = document.getElementById("monthSelect");
    const filterBtn = document.getElementById("filterBtn");
    const toggleChartBtn = document.getElementById("toggleChartBtn");
    const categoryChartCanvas = document.getElementById("categoryChart");

    let chartInstance = null;

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

            // 編集ボタン（モーダル）
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
                    <input id="editCategory" value="${entry.category}" style="width: 90%; margin:5px 0;"><br>
                    <button id="saveEdit" style="background:#4caf50;color:#fff;padding:6px 12px;margin-top:10px;border:none;border-radius:5px;">保存</button>
                    <button id="cancelEdit" style="background:#f44336;color:#fff;padding:6px 12px;margin-top:10px;border:none;border-radius:5px;">キャンセル</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector("#saveEdit").addEventListener("click", () => {
            const newItem = modal.querySelector("#editItem").value.trim();
            const newAmount = Number(modal.querySelector("#editAmount").value);
            const newCategory = modal.querySelector("#editCategory").value.trim();
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

    // 月別表示ボタン
    filterBtn.addEventListener("click", () => {
        const selectedMonth = monthSelect.value;
        loadExpenses(selectedMonth);
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

    // 初期ロード
    window.addEventListener("load", () => loadExpenses());
})();
