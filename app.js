import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// Загружаем токены из файла
const TOKENS = JSON.parse(fs.readFileSync("tokens.json"));

// Настройки
const CHAIN_ID = 137; // Polygon
const USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f"; // USDT (Polygon)
const ODOS_FEE = 0.002;
const MEXC_FEE = 0.001;

// Рассчёт средней цены покупки/продажи
function calcAvgPrice(orders, amount) {
  let remaining = amount;
  let totalTokens = 0;

  for (const [priceStr, qtyStr] of orders) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    const cost = price * qty;

    if (remaining >= cost) {
      totalTokens += qty;
      remaining -= cost;
    } else {
      totalTokens += remaining / price;
      remaining = 0;
      break;
    }
  }

  if (totalTokens === 0) return null;
  return amount / totalTokens;
}

app.get("/prices", async (req, res) => {
  const odosPrices = {};
  const mexcPrices = {};
  const spread = {};
  const profit = {};

  for (const token of TOKENS) {
    let tokensBought = null;

    // --- ODOS ---
    try {
      const effectiveUSDT = 50 * (1 - ODOS_FEE);
      const odosRes = await fetch("https://api.odos.xyz/sor/quote/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: CHAIN_ID,
          inputTokens: [{ tokenAddress: USDT, amount: String(effectiveUSDT * 1e6) }],
          outputTokens: [{ tokenAddress: token.address }],
          slippageLimitPercent: 1
        })
      });

      const odosData = await odosRes.json();
      const out = odosData.outAmounts?.[0];

      if (out) {
        tokensBought = Number(out) / 1e18;
        odosPrices[token.symbol] = effectiveUSDT / tokensBought;
      } else {
        odosPrices[token.symbol] = "слишком мало ликвидности";
      }
    } catch {
      odosPrices[token.symbol] = "ошибка API ODOS";
    }

    // --- MEXC ---
    try {
      const depthRes = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${token.symbol}USDT&limit=50`);
      const depthData = await depthRes.json();
      const asks = depthData.asks;

      if (asks?.length && tokensBought) {
        let remainingTokens = tokensBought;
        let totalUSDT = 0;

        for (const [priceStr, qtyStr] of asks) {
          const price = parseFloat(priceStr);
          const qty = parseFloat(qtyStr);

          if (remainingTokens >= qty) {
            totalUSDT += price * qty;
            remainingTokens -= qty;
          } else {
            totalUSDT += price * remainingTokens;
            remainingTokens = 0;
            break;
          }
        }

        if (remainingTokens === 0) {
          const usdtAfterFee = totalUSDT * (1 - MEXC_FEE);
          mexcPrices[token.symbol] = totalUSDT / tokensBought;
          profit[token.symbol] = usdtAfterFee - 50;
        } else {
          mexcPrices[token.symbol] = "слишком мало ликвидности";
          profit[token.symbol] = null;
        }
      } else {
        mexcPrices[token.symbol] = "нет данных";
        profit[token.symbol] = null;
      }
    } catch {
      mexcPrices[token.symbol] = "ошибка API MEXC";
      profit[token.symbol] = null;
    }

    // --- Спред ---
    if (typeof odosPrices[token.symbol] === "number" && typeof mexcPrices[token.symbol] === "number") {
      spread[token.symbol] = ((odosPrices[token.symbol] - mexcPrices[token.symbol]) / mexcPrices[token.symbol]) * 100;
    } else {
      spread[token.symbol] = null;
    }
  }

  res.json({ odos: odosPrices, mexc: mexcPrices, spread, profit });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
