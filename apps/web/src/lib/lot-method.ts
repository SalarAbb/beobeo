// How the broker picks which purchases a sale uses (an account's `lotMethod`
// / `cryptoLotMethod`). Every gain in the app follows it; crypto exchanges
// often use highest cost first.
export const LOT_METHOD_LABEL = {
  fifo: "oldest first",
  hifo: "highest cost first",
} as const;

export type LotMethod = keyof typeof LOT_METHOD_LABEL;
