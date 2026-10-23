import type { SearchResult } from "./types";

/**
 * Static fast-path for search: famous tickers match instantly with zero
 * network. Remote provider search only fills in what this list misses.
 */
export const POPULAR_ASSETS: SearchResult[] = [
  // mega-cap stocks
  { symbol: "AAPL", name: "Apple Inc.", class: "stock" },
  { symbol: "MSFT", name: "Microsoft Corp.", class: "stock" },
  { symbol: "GOOGL", name: "Alphabet Inc. (Class A)", class: "stock" },
  { symbol: "AMZN", name: "Amazon.com Inc.", class: "stock" },
  { symbol: "NVDA", name: "NVIDIA Corp.", class: "stock" },
  { symbol: "META", name: "Meta Platforms Inc.", class: "stock" },
  { symbol: "TSLA", name: "Tesla Inc.", class: "stock" },
  { symbol: "AVGO", name: "Broadcom Inc.", class: "stock" },
  { symbol: "BRK-B", name: "Berkshire Hathaway (Class B)", class: "stock" },
  { symbol: "LLY", name: "Eli Lilly & Co.", class: "stock" },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", class: "stock" },
  { symbol: "V", name: "Visa Inc.", class: "stock" },
  { symbol: "MA", name: "Mastercard Inc.", class: "stock" },
  { symbol: "UNH", name: "UnitedHealth Group", class: "stock" },
  { symbol: "XOM", name: "Exxon Mobil Corp.", class: "stock" },
  { symbol: "COST", name: "Costco Wholesale Corp.", class: "stock" },
  { symbol: "HD", name: "Home Depot Inc.", class: "stock" },
  { symbol: "PG", name: "Procter & Gamble Co.", class: "stock" },
  { symbol: "NFLX", name: "Netflix Inc.", class: "stock" },
  { symbol: "JNJ", name: "Johnson & Johnson", class: "stock" },
  { symbol: "ABBV", name: "AbbVie Inc.", class: "stock" },
  { symbol: "CRM", name: "Salesforce Inc.", class: "stock" },
  { symbol: "BAC", name: "Bank of America Corp.", class: "stock" },
  { symbol: "AMD", name: "Advanced Micro Devices", class: "stock" },
  { symbol: "KO", name: "Coca-Cola Co.", class: "stock" },
  { symbol: "PEP", name: "PepsiCo Inc.", class: "stock" },
  { symbol: "WMT", name: "Walmart Inc.", class: "stock" },
  { symbol: "DIS", name: "Walt Disney Co.", class: "stock" },
  { symbol: "CSCO", name: "Cisco Systems Inc.", class: "stock" },
  { symbol: "QCOM", name: "Qualcomm Inc.", class: "stock" },
  { symbol: "INTC", name: "Intel Corp.", class: "stock" },
  { symbol: "IBM", name: "IBM Corp.", class: "stock" },
  { symbol: "ORCL", name: "Oracle Corp.", class: "stock" },
  { symbol: "CAT", name: "Caterpillar Inc.", class: "stock" },
  { symbol: "GE", name: "GE Aerospace", class: "stock" },
  { symbol: "PLTR", name: "Palantir Technologies", class: "stock" },
  { symbol: "UBER", name: "Uber Technologies", class: "stock" },
  { symbol: "ABNB", name: "Airbnb Inc.", class: "stock" },
  { symbol: "COIN", name: "Coinbase Global Inc.", class: "stock" },
  { symbol: "SHOP", name: "Shopify Inc.", class: "stock" },
  // ETFs / index funds
  { symbol: "SPY", name: "SPDR S&P 500 ETF", class: "etf" },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", class: "etf" },
  { symbol: "VTI", name: "Vanguard Total Stock Market ETF", class: "etf" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", class: "etf" },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", class: "etf" },
  { symbol: "VEA", name: "Vanguard FTSE Developed Markets ETF", class: "etf" },
  { symbol: "VXUS", name: "Vanguard Total International Stock ETF", class: "etf" },
  { symbol: "BND", name: "Vanguard Total Bond Market ETF", class: "etf" },
  { symbol: "SCHD", name: "Schwab US Dividend Equity ETF", class: "etf" },
  { symbol: "VGT", name: "Vanguard Information Technology ETF", class: "etf" },
  // crypto (Coinbase Exchange products; providerRef = CoinGecko id for fallback)
  { symbol: "BTC", name: "Bitcoin", class: "crypto", providerRef: "bitcoin" },
  { symbol: "ETH", name: "Ethereum", class: "crypto", providerRef: "ethereum" },
  { symbol: "SOL", name: "Solana", class: "crypto", providerRef: "solana" },
  { symbol: "DOGE", name: "Dogecoin", class: "crypto", providerRef: "dogecoin" },
  { symbol: "XRP", name: "XRP", class: "crypto", providerRef: "ripple" },
  { symbol: "ADA", name: "Cardano", class: "crypto", providerRef: "cardano" },
  { symbol: "LTC", name: "Litecoin", class: "crypto", providerRef: "litecoin" },
  { symbol: "LINK", name: "Chainlink", class: "crypto", providerRef: "chainlink" },
];

/** Case-insensitive match on symbol prefix or name substring. */
export function searchPopular(query: string, limit = 8): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const bySymbol = POPULAR_ASSETS.filter((a) =>
    a.symbol.toLowerCase().startsWith(q),
  );
  const byName = POPULAR_ASSETS.filter(
    (a) =>
      !a.symbol.toLowerCase().startsWith(q) &&
      a.name.toLowerCase().includes(q),
  );
  return [...bySymbol, ...byName].slice(0, limit);
}
