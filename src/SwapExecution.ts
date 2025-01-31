import {
  Contract,
  Signer,
  Interface,
  ZeroAddress,
  Transaction
} from 'ethers';
import JSBI from 'jsbi';
import { GetQuoteResult } from "./types.ts";

// Core types
export enum TradeType {
  EXACT_INPUT,
  EXACT_OUTPUT
}

export class Token {
  readonly chainId: number;
  readonly address: string;
  readonly decimals: number;
  readonly symbol: string;

  constructor(chainId: number, address: string, decimals: number, symbol: string) {
    this.chainId = chainId;
    this.address = address;
    this.decimals = decimals;
    this.symbol = symbol;
  }

  equals(other: Token): boolean {
    return this.chainId === other.chainId && this.address.toLowerCase() === other.address.toLowerCase();
  }
}

export class TokenAmount {
  readonly token: Token;
  readonly raw: JSBI;
  readonly decimalScale: JSBI;

  constructor(token: Token, amount: string | JSBI) {
    this.token = token;
    this.decimalScale = JSBI.exponentiate(
      JSBI.BigInt(10),
      JSBI.BigInt(token.decimals)
    );
    this.raw = typeof amount === 'string' ? JSBI.BigInt(amount) : amount;
  }
}

export interface Pool {
  token0: Token;
  token1: Token;
  fee: number;
  sqrtRatioX96?: string;
  liquidity?: string;
  tickCurrent?: number;
}

export class Route {
  readonly pools: Pool[];
  readonly path: Token[];
  readonly input: Token;
  readonly output: Token;

  constructor(pools: Pool[], input: Token, output: Token) {
    this.pools = pools;
    this.input = input;
    this.output = output;

    this.path = pools.reduce<Token[]>((tokens, pool) => {
      const isInput = pool.token0.equals(tokens[tokens.length - 1] || input);
      const tokenIn = isInput ? pool.token0 : pool.token1;
      const tokenOut = isInput ? pool.token1 : pool.token0;

      if (!tokens.length) tokens.push(tokenIn);
      tokens.push(tokenOut);
      return tokens;
    }, []);

    if (this.path[0].address !== input.address) {
      throw new Error('First token in path must match input token');
    }
    if (this.path[this.path.length - 1].address !== output.address) {
      throw new Error('Last token in path must match output token');
    }
  }
}

export class Trade {
  readonly route: Route;
  readonly type: TradeType;
  readonly inputAmount: TokenAmount;
  readonly outputAmount: TokenAmount;

  constructor(
    route: Route,
    inputAmount: TokenAmount,
    outputAmount: TokenAmount,
    type: TradeType
  ) {
    this.route = route;
    this.type = type;
    this.inputAmount = inputAmount;
    this.outputAmount = outputAmount;
  }
}

export interface SwapOptions {
  recipient: string;
  slippageTolerance: number;
  deadline: number;
}

export class SwapRouter {
  private routerAddress: string;
  private routerInterface: Interface;

  constructor(routerAddress: string) {
    this.routerAddress = routerAddress;
    this.routerInterface = new Interface([
      'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
      'function exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountIn)'
    ]);
  }

  private calculateMinimumOut(amount: TokenAmount, slippageTolerance: number): JSBI {
    // slippageTolerance is in basis points (1 = 0.01%)
    const slippagePercent = JSBI.BigInt(10000 - slippageTolerance);

    const minimumAmount = JSBI.divide(
      JSBI.multiply(
        amount.raw,
        slippagePercent
      ),
      JSBI.BigInt(10000)
    );

    console.log('MinimumOut calculation:', {
      amount: amount.raw.toString(),
      slippageTolerance,
      minimumAmount: minimumAmount.toString()
    });

    return minimumAmount;
  }

  private calculateMaximumIn(amount: TokenAmount, slippageTolerance: number): JSBI {
    // slippageTolerance is in basis points (1 = 0.01%)
    const slippagePercent = JSBI.BigInt(10000 + slippageTolerance);

    const maximumAmount = JSBI.divide(
      JSBI.multiply(
        amount.raw,
        slippagePercent
      ),
      JSBI.BigInt(10000)
    );

    console.log('MaximumIn calculation:', {
      amount: amount.raw.toString(),
      slippageTolerance,
      maximumAmount: maximumAmount.toString()
    });

    return maximumAmount;
  }

  async executeSwap(
    trade: Trade,
    options: SwapOptions,
    account: Signer
  ): Promise<Transaction> {
    const contract = new Contract(
      this.routerAddress,
      this.routerInterface,
      account
    );

    const value = trade.inputAmount.token.address === ZeroAddress
      ? trade.inputAmount.raw.toString()
      : '0';

    try {
      if (trade.type === TradeType.EXACT_INPUT) {
        const params = {
          tokenIn: trade.route.path[0].address,
          tokenOut: trade.route.path[1].address,
          fee: trade.route.pools[0].fee,
          recipient: options.recipient,
          amountIn: trade.inputAmount.raw.toString(),
          amountOutMinimum: this.calculateMinimumOut(trade.outputAmount, options.slippageTolerance).toString(),
          sqrtPriceLimitX96: 0
        };

        console.log('Debug exactInput parameters:', {
          ...params,
          value,
          slippageTolerance: options.slippageTolerance,
        });

        await contract.exactInputSingle.staticCall(params, { value });
        const gasLimit = await contract.exactInputSingle.estimateGas(params, { value });
        return contract.exactInputSingle(params, {
          gasLimit: gasLimit * 120n / 100n,
          value
        });
      } else {
        const params = {
          tokenIn: trade.route.path[0].address,
          tokenOut: trade.route.path[1].address,
          fee: trade.route.pools[0].fee,
          recipient: options.recipient,
          amountOut: trade.outputAmount.raw.toString(),
          amountInMaximum: this.calculateMaximumIn(trade.inputAmount, options.slippageTolerance).toString(),
          sqrtPriceLimitX96: 0
        };

        console.log('Debug exactOutput parameters:', {
          ...params,
          value,
          slippageTolerance: options.slippageTolerance,
        });

        await contract.exactOutputSingle.staticCall(params, { value });
        const gasLimit = await contract.exactOutputSingle.estimateGas(params, { value });
        return contract.exactOutputSingle(params, {
          gasLimit: gasLimit * 120n / 100n,
          value
        });
      }
    } catch (error) {
      console.error('Swap failed:', error);
      throw error;
    }
  }
}

export function createTradeFromQuote(quoteResult: GetQuoteResult, type: "exactIn" | "exactOut"): Trade {
  // Convert the first route
  const routePools: Pool[] = quoteResult.route[0].map((poolRoute) => {
    return {
      token0: new Token(
        poolRoute.tokenIn.chainId,
        poolRoute.tokenIn.address,
        poolRoute.tokenIn.decimals,
        poolRoute.tokenIn.symbol
      ),
      token1: new Token(
        poolRoute.tokenOut.chainId,
        poolRoute.tokenOut.address,
        poolRoute.tokenOut.decimals,
        poolRoute.tokenOut.symbol
      ),
      fee: parseInt(poolRoute.fee),
      sqrtRatioX96: poolRoute.sqrtRatioX96,
      liquidity: poolRoute.liquidity,
      tickCurrent: parseInt(poolRoute.tickCurrent)
    };
  });

  // Create input and output tokens from first and last pool
  const inputToken = routePools[0].token0;
  const outputToken = routePools[routePools.length - 1].token1;

  // Create the route
  const route = new Route(routePools, inputToken, outputToken);

  if (type === "exactIn") {
    const inputAmount = new TokenAmount(inputToken, quoteResult.amount);
    const outputAmount = new TokenAmount(outputToken, quoteResult.quote);

    return new Trade(
      route,
      inputAmount,
      outputAmount,
      TradeType.EXACT_INPUT
    );
  } else {
    const inputAmount = new TokenAmount(inputToken, quoteResult.quote);
    const outputAmount = new TokenAmount(outputToken, quoteResult.amount);

    return new Trade(
      route,
      inputAmount,
      outputAmount,
      TradeType.EXACT_OUTPUT
    );
  }
}
