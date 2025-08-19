import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// Загружаем токены
const TOKENS = JSON.parse(fs.readFileSync("tokens.json", "utf-8"));

// Настройки
const CHAIN_ID = 137; // Polygon
const USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
const ODOS_FEE = 0.002;
const MEXC_FEE = 0.001;
const USDT_AMOUNT = 50; // сумма покупки

// Рассчёт средней цены покупки/продажи
function calcAvgPrice(orders, amount, isBuy = true) {
  let remaining = amount;
  let totalTokens = 0;

  for (const [priceStr, qtyStr] of orders) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);

    if (isBuy) {
      const cost = price * qty;
      if (remaining >= cost) {
        totalTokens += qty;
        remaining -= cost;
      } else {
        totalTokens += remaining / price;
        remaining = 0;
        break;
      }
    } else {
      if (remaining >= qty) {
        totalTokens += price * qty;
        remaining -= qty;
      } else {
        totalTokens += price * remaining;
        remaining = 0;
        break;
      }
    }
  }

  if (totalTokens === 0) return null;
  return isBuy ? amount / totalTokens : totalTokens / amount;
}

// Главный роут
app.get("/prices", async (req, res) => {
  const odosPrices = {};
  const mexcPrices = {};
  const spread = {};
  const profit = {};

  for (const token of TOKENS) {
    let tokensBought = null;

    // === Покупка на ODOS ===
    try {
      const effectiveUSDT = USDT_AMOUNT * (1 - ODOS_FEE);
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
        tokensBought = Number(out) / 1e18; // предполагаем decimals = 18
        odosPrices[token.symbol] = effectiveUSDT / tokensBought;
      } else {
        odosPrices[token.symbol] = null;
        console.warn(`ODOS: нет данных для ${token.symbol}`);
      }
    } catch (err) {
      odosPrices[token.symbol] = null;
      console.error(`Ошибка ODOS для ${token.symbol}:`, err.message);
    }

    // === Продажа на MEXC ===
    try {
      const depthRes = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${token.symbol}USDT&limit=50`);
      const depthData = await depthRes.json();
      const asks = depthData.asks;

      if (!asks || asks.length === 0) {
        mexcPrices[token.symbol] = null;
        console.warn(`MEXC: нет ордеров для ${token.symbol}`);
      } else if (tokensBought) {
        const avgPrice = calcAvgPrice(asks, tokensBought, false);
        if (avgPrice) {
          mexcPrices[token.symbol] = avgPrice * (1 - MEXC_FEE);
          profit[token.symbol] = mexcPrices[token.symbol] * tokensBought - USDT_AMOUNT;
        } else {
          mexcPrices[token.symbol] = null;
          profit[token.symbol] = null;
        }
      } else {
        mexcPrices[token.symbol] = null;
        profit[token.symbol] = null;
      }
    } catch (err) {
      mexcPrices[token.symbol] = null;
      profit[token.symbol] = null;
      console.error(`Ошибка MEXC для ${token.symbol}:`, err.message);
    }

    // === Спред ===
    if (odosPrices[token.symbol] && mexcPrices[token.symbol]) {
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
