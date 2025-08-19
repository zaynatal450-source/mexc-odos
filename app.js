import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// Загружаем токены
const TOKENS = JSON.parse(fs.readFileSync("./tokens.json", "utf-8"));

const CHAIN_ID = 137; // Polygon
const USDT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f"; // USDT (Polygon)
const ODOS_FEE = 0.002; // 0.2%
const MEXC_FEE = 0.001; // 0.1%

// API для фронтенда: токены + цены
app.get("/data", async (req, res) => {
  try {
    const mexcPrices = {};
    const odosPrices = {};
    const spread = {};
    const profit = {};

    for (const token of TOKENS) {
      let tokensBought = null;

      // MEXC: покупка токенов за 50 USDT
      try {
        const depthRes = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${token.symbol}USDT&limit=50`);
        const depthData = await depthRes.json();
        const asks = depthData.asks;

        if (asks && asks.length > 0) {
          let remainingUSDT = 50 * (1 - MEXC_FEE);
          let totalTokens = 0;

          for (const [priceStr, qtyStr] of asks) {
            const price = parseFloat(priceStr);
            const qty = parseFloat(qtyStr);
            const cost = price * qty;

            if (remainingUSDT >= cost) {
              totalTokens += qty;
              remainingUSDT -= cost;
            } else {
              totalTokens += remainingUSDT / price;
              remainingUSDT = 0;
              break;
            }
          }

          tokensBought = totalTokens;
          mexcPrices[token.symbol] = 50 / totalTokens; // средняя цена
        } else {
          mexcPrices[token.symbol] = null;
        }
      } catch {
        mexcPrices[token.symbol] = null;
      }

      // ODOS: продажа токенов за USDT
      try {
        if (tokensBought) {
          const odosRes = await fetch("https://api.odos.xyz/sor/quote/v2", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chainId: CHAIN_ID,
              inputTokens: [{ tokenAddress: token.address, amount: String(tokensBought * 1e18) }],
              outputTokens: [{ tokenAddress: USDT }],
              slippageLimitPercent: 1
            })
          });

          const odosData = await odosRes.json();
          const out = odosData.outAmounts?.[0];

          if (out) {
            const usdtOut = Number(out) / 1e6;
            const usdtAfterFee = usdtOut * (1 - ODOS_FEE);
            odosPrices[token.symbol] = usdtAfterFee / tokensBought;
            profit[token.symbol] = usdtAfterFee - 50;
          } else {
            odosPrices[token.symbol] = null;
            profit[token.symbol] = null;
          }
        } else {
          odosPrices[token.symbol] = null;
          profit[token.symbol] = null;
        }
      } catch {
        odosPrices[token.symbol] = null;
        profit[token.symbol] = null;
      }

      // Спред
      if (mexcPrices[token.symbol] && odosPrices[token.symbol]) {
        spread[token.symbol] = ((odosPrices[token.symbol] - mexcPrices[token.symbol]) / mexcPrices[token.symbol]) * 100;
      } else {
        spread[token.symbol] = null;
      }
    }

    res.json({ tokens: TOKENS, mexc: mexcPrices, odos: odosPrices, spread, profit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при получении цен" });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
