export enum ChainId {
  MAINNET = 253368190,
  FLAME_DEVNET = 912559,
  FLAME_TESTNET = 16604737732183
}

export interface FlameNetwork {
  id: ChainId;
  name: string;
  url: string;
}

export interface GetQuoteParams {
  // no cross chain swaps yet, so we only need to specify one chain right now,
  // which will be one of the Flame networks
  chainId: ChainId;
  tokenInAddress: string;
  tokenInDecimals: number;
  tokenInSymbol: string;
  tokenOutAddress: string;
  tokenOutDecimals: number;
  tokenOutSymbol: string;
  amount: string;
  type: "exactIn" | "exactOut";
}

export interface GetQuoteResult {
  quoteId?: string;
  blockNumber: string;
  amount: string;
  amountDecimals: string;
  gasPriceWei: string;
  gasUseEstimate: string;
  gasUseEstimateQuote: string;
  gasUseEstimateQuoteDecimals: string;
  gasUseEstimateUSD: string;
  methodParameters?: { calldata: string; value: string };
  quote: string;
  quoteDecimals: string;
  quoteGasAdjusted: string;
  quoteGasAdjustedDecimals: string;
  route: Array<V3PoolInRoute[]>;
  routeString: string;
}

export interface TokenInRoute {
  address: string;
  chainId: number;
  symbol: string;
  decimals: number;
}

export type V3PoolInRoute = {
  type: "v3-pool";
  tokenIn: TokenInRoute;
  tokenOut: TokenInRoute;
  sqrtRatioX96: string;
  liquidity: string;
  tickCurrent: string;
  fee: string;
  amountIn?: string;
  amountOut?: string;

  // not used in the interface
  address?: string;
};
