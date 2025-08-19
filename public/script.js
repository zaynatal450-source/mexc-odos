async function fetchPrices() {
  try {
    const res = await fetch("/prices");
    const data = await res.json();

    const tbody = document.getElementById("prices-table");
    tbody.innerHTML = "";

    for (const token of Object.keys(data.odos)) {
      const odosPrice = data.odos[token];
      const mexcPrice = data.mexc[token];
      const spread = data.spread[token];
      const profit = data.profit[token];

      const row = document.createElement("tr");

      const createCell = (value, type) => {
        const td = document.createElement("td");
        if (typeof value === "number") {
          td.textContent = value.toFixed(4);
          if (type === "profit") {
            td.className = value >= 0 ? "profit-positive" : "profit-negative";
          }
        } else if (typeof value === "string") {
          td.textContent = value;
          td.className = value.includes("слишком мало") ? "warning" : "error";
        } else {
          td.textContent = "-";
        }
        return td;
      };

      row.appendChild(createCell(token));
      row.appendChild(createCell(odosPrice));
      row.appendChild(createCell(mexcPrice));
      row.appendChild(createCell(spread));
      row.appendChild(createCell(profit, "profit"));

      tbody.appendChild(row);
    }
  } catch (err) {
    console.error("Ошибка при загрузке цен:", err);
  }
}

// Обновляем каждые 30 секунд
fetchPrices();
setInterval(fetchPrices, 30000);
