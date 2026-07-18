// health.js - 健康管理画面のスクリプト
//
// 【考え方】
// 家計簿アプリの健康管理なので、「運動の記録」と「お金」をつなげるのが特徴。
// 支出カテゴリ「健康」の合計を『健康への投資』として表示し、
// 運動回数で割った「運動1回あたりのコスト」を出す。
// 運動するほど1回あたりが安くなる＝サボるともったいない、という動機づけ。
(() => {
    const dateInput = document.getElementById("dateInput");
    const typeSelect = document.getElementById("typeSelect");
    const minutesInput = document.getElementById("minutesInput");
    const saveWorkoutBtn = document.getElementById("saveWorkoutBtn");
    const saveMessage = document.getElementById("saveMessage");

    const mascotEl = document.getElementById("mascot");
    const healthMessage = document.getElementById("healthMessage");
    const statCount = document.getElementById("statCount");
    const statMinutes = document.getElementById("statMinutes");
    const statStreak = document.getElementById("statStreak");

    const investDisplay = document.getElementById("investDisplay");
    const costPerDisplay = document.getElementById("costPerDisplay");

    const monthLabel = document.getElementById("monthLabel");
    const prevMonthBtn = document.getElementById("prevMonthBtn");
    const nextMonthBtn = document.getElementById("nextMonthBtn");
    const tableBody = document.getElementById("workoutTableBody");

    // 表示中の年月
    const now = new Date();
    let currentYear = now.getFullYear();
    let currentMonth = now.getMonth() + 1;

    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    // タイムゾーンのずれが出ないよう、ローカル時刻で日付文字列を作る
    function localDateStr(d) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    function getCurrentMonthStr() {
        return `${currentYear}-${pad2(currentMonth)}`;
    }

    // 一意なIDを生成（削除で確実に対象を特定するため）
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function loadWorkouts() {
        return JSON.parse(localStorage.getItem("workouts") || "[]");
    }

    function showMessage(text, color = "#4CAF50") {
        saveMessage.textContent = text;
        saveMessage.style.color = color;
        saveMessage.style.fontWeight = "bold";
        setTimeout(() => { saveMessage.textContent = ""; }, 2500);
    }

    // 💪 運動を記録
    saveWorkoutBtn.addEventListener("click", () => {
        const date = dateInput.value || localDateStr(new Date());
        const type = typeSelect.value;
        const minutes = Number(minutesInput.value);

        if (!minutes || minutes <= 0) {
            showMessage("時間（分）を正しく入力してください。", "red");
            return;
        }

        const workouts = loadWorkouts();
        workouts.push({ id: generateId(), date, type, minutes, month: date.slice(0, 7) });
        localStorage.setItem("workouts", JSON.stringify(workouts));

        minutesInput.value = "";
        showMessage("記録しました！おつかれさま 💪");
        render();
    });

    // 連続日数: 今日（まだ運動していなければ昨日）からさかのぼって数える
    function calcStreak(workouts) {
        const days = new Set(workouts.map(w => w.date));
        const d = new Date();
        if (!days.has(localDateStr(d))) d.setDate(d.getDate() - 1);
        let streak = 0;
        while (days.has(localDateStr(d))) {
            streak++;
            d.setDate(d.getDate() - 1);
        }
        return streak;
    }

    // 🐱 応援メッセージ（直近7日の運動日数で判定）
    function updateMascot(workouts, streak) {
        const days = new Set(workouts.map(w => w.date));
        let recent = 0;
        const d = new Date();
        for (let i = 0; i < 7; i++) {
            if (days.has(localDateStr(d))) recent++;
            d.setDate(d.getDate() - 1);
        }

        let mascot, message;
        if (recent >= 4) {
            mascot = "😸";
            message = `すごい！この1週間で${recent}日も動いてる！`;
        } else if (recent >= 2) {
            mascot = "😺";
            message = "いい調子！この習慣を続けよう";
        } else if (recent === 1) {
            mascot = "🐱";
            message = "まず1回、えらい！次はいつにする？";
        } else {
            mascot = "🐱";
            message = "今日の1回が、最初の1回だよ";
        }
        if (streak >= 3) message += `（🔥連続${streak}日）`;

        mascotEl.textContent = mascot;
        healthMessage.textContent = message;
    }

    // 画面全体を描き直す
    function render() {
        const month = getCurrentMonthStr();
        monthLabel.textContent = `${currentYear}年${currentMonth}月`;

        const workouts = loadWorkouts();
        const monthWorkouts = workouts
            .filter(w => (w.month || w.date.slice(0, 7)) === month)
            .sort((a, b) => b.date.localeCompare(a.date));

        // 履歴テーブル
        tableBody.innerHTML = "";
        if (monthWorkouts.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" style="color:#999; padding:16px;">この月の記録はまだありません</td></tr>`;
        }
        monthWorkouts.forEach(w => {
            const [, m, d] = w.date.split("-");
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${Number(m)}/${Number(d)}</td>
                <td>${w.type}</td>
                <td>${w.minutes}分</td>
                <td><button class="del-btn">削除</button></td>
            `;
            // 削除ボタン — IDで対象を特定
            row.querySelector(".del-btn").addEventListener("click", () => {
                if (confirm("この記録を削除しますか？")) {
                    const all = loadWorkouts().filter(x => x.id !== w.id);
                    localStorage.setItem("workouts", JSON.stringify(all));
                    render();
                }
            });
            tableBody.appendChild(row);
        });

        // 統計
        const totalMinutes = monthWorkouts.reduce((s, w) => s + (Number(w.minutes) || 0), 0);
        const streak = calcStreak(workouts);
        statCount.textContent = monthWorkouts.length;
        statMinutes.textContent = totalMinutes;
        statStreak.textContent = streak;

        // 応援メッセージ（月の切り替えに関係なく「今」を基準にする）
        updateMascot(workouts, streak);

        // 💰 健康への投資（支出カテゴリ「健康」の合計）
        const expenses = JSON.parse(localStorage.getItem("expenses") || "[]");
        const invest = expenses
            .filter(e => e.category === "健康" && (e.month || e.date.slice(0, 7)) === month)
            .reduce((s, e) => s + (Number(e.amount) || 0), 0);
        investDisplay.textContent = `${invest.toLocaleString()} 円`;

        if (invest > 0 && monthWorkouts.length > 0) {
            const per = Math.round(invest / monthWorkouts.length);
            costPerDisplay.textContent = `運動1回あたり 約${per.toLocaleString()}円。動くほどおトク！`;
        } else if (invest > 0) {
            costPerDisplay.textContent = "投資済み！運動して回収しよう";
        } else {
            costPerDisplay.textContent = "";
        }
    }

    // 前月・次月
    prevMonthBtn.addEventListener("click", () => {
        currentMonth--;
        if (currentMonth < 1) { currentMonth = 12; currentYear--; }
        render();
    });
    nextMonthBtn.addEventListener("click", () => {
        currentMonth++;
        if (currentMonth > 12) { currentMonth = 1; currentYear++; }
        render();
    });

    // 🚀 初期表示
    window.addEventListener("load", () => {
        dateInput.value = localDateStr(new Date());
        render();
    });
})();
