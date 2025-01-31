import {
  ethers,
  Contract,
  JsonRpcProvider,
  Signer,
  Interface,
  ZeroAddress,
  Transaction,
  getBigInt,
  formatUnits,
  MaxUint256
} from 'ethers';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)'
];
import JSBI from 'jsbi';


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

export interface V3PoolInRoute {
  type: "v3-pool";
  tokenIn: {
    address: string;
    chainId: number;
    symbol: string;
    decimals: number;
  };
  tokenOut: {
    address: string;
    chainId: number;
    symbol: string;
    decimals: number;
  };
  sqrtRatioX96: string;
  liquidity: string;
  tickCurrent: string;
  fee: string;
  amountIn?: string;
  amountOut?: string;
  address?: string;
}

export function createTradeFromQuote(quoteResult: GetQuoteResult, type: "exactIn" | "exactOut"): Trade {
  // Convert the first route (we'll use the first route found in the quote)
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

  // Create the trade
  const amount = new TokenAmount(
    type === "exactIn" ? inputToken : outputToken,
    type === "exactIn" ? quoteResult.amount : quoteResult.quote
  );

  return new Trade(
    route,
    amount,
    type === "exactIn" ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT
  );
}

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

  toExact(): string {
    return formatUnits(this.raw.toString(), this.token.decimals);
  }

  toSignificant(significantDigits: number = 6): string {
    const quotient = this.toExact();
    const [whole, decimal] = quotient.split('.');
    if (!decimal) return whole;
    return `${whole}.${decimal.slice(0, significantDigits)}`;
  }

  add(other: TokenAmount): TokenAmount {
    if (!this.token.equals(other.token)) {
      throw new Error('Tokens must be equal');
    }
    return new TokenAmount(
      this.token,
      JSBI.add(this.raw, other.raw)
    );
  }

  subtract(other: TokenAmount): TokenAmount {
    if (!this.token.equals(other.token)) {
      throw new Error('Tokens must be equal');
    }
    return new TokenAmount(
      this.token,
      JSBI.subtract(this.raw, other.raw)
    );
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
    amount: TokenAmount,
    type: TradeType
  ) {
    this.route = route;
    this.type = type;
    if (type === TradeType.EXACT_INPUT) {
      this.inputAmount = amount;
      // In real implementation calculate based on route
      this.outputAmount = new TokenAmount(route.output, amount.raw);
    } else {
      this.outputAmount = amount;
      this.inputAmount = new TokenAmount(route.input, amount.raw);
    }
  }
}

export interface SwapCall {
  address: string;
  calldata: string;
  value: string;
}

export interface SwapOptions {
  recipient: string;
  slippageTolerance: number; // In basis points (1 = 0.01%)
  deadline: number;
}

export class SwapRouter {
  private routerAddress: string;
  private routerInterface = new Interface([
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
    'function exactInput(tuple(bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)',
    'function exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountIn)',
    'function exactOutput(tuple(bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) external payable returns (uint256 amountIn)'
  ]);

  constructor(routerAddress: string) {
    this.routerAddress = routerAddress;
  }

  private encodeSwapData(
    trade: Trade
  ): { calldata: string; value: string } {
    const path = this.encodePath(trade.route);

    const value = trade.inputAmount.token.address === ZeroAddress
      ? trade.inputAmount.raw.toString()
      : '0';

    return {
      calldata: path,
      value
    };
  }

  private calculateMinimumOut(amount: TokenAmount, slippageTolerance: number): JSBI {
    const slippageAdjusted = JSBI.multiply(
      amount.raw,
      JSBI.subtract(JSBI.BigInt(10000), JSBI.BigInt(slippageTolerance))
    );
    return JSBI.divide(slippageAdjusted, JSBI.BigInt(10000));
  }

  private calculateMaximumIn(amount: TokenAmount, slippageTolerance: number): JSBI {
    const slippageAdjusted = JSBI.multiply(
      amount.raw,
      JSBI.add(JSBI.BigInt(10000), JSBI.BigInt(slippageTolerance))
    );
    return JSBI.divide(slippageAdjusted, JSBI.BigInt(10000));
  }

  private encodePath(route: Route): string {
    // For each hop, encode in the format: tokenIn + fee + tokenOut
    const encoded = route.pools.map((pool, i) => {
      // Get the tokens in correct order
      const tokenIn = route.path[i];
      const tokenOut = route.path[i + 1];
      const fee = pool.fee.toString(16).padStart(6, '0'); // Convert fee to hex, pad to 3 bytes

      if (i === route.pools.length - 1) {
        // For last pool, include the last token
        return `${tokenIn.address.toLowerCase().slice(2)}${fee}${tokenOut.address.toLowerCase().slice(2)}`;
      }
      // For other pools, the output token will be included in the next hop
      return `${tokenIn.address.toLowerCase().slice(2)}${fee}`;
    }).join('');

    return '0x' + encoded;
  }

  async approveTokenIfNeeded(
    token: Token,
    amount: bigint,
    signer: Signer
  ): Promise<void> {
    // Skip approval for native token (ETH)
    if (token.address === ZeroAddress) {
      return;
    }

    const tokenContract = new Contract(token.address, ERC20_ABI, signer);
    const signerAddress = await signer.getAddress();

    const allowance = await tokenContract.allowance(signerAddress, this.routerAddress);

    // Check if current allowance is sufficient
    if (allowance < amount) {
      console.log('Approving token...');
      const tx = await tokenContract.approve(this.routerAddress, MaxUint256);
      await tx.wait();
      console.log('Token approved');
    } else {
      console.log('Token already approved');
    }
  }

  async executeSwap(
    trade: Trade,
    options: SwapOptions,
    account: Signer
  ): Promise<Transaction> {
    const swapParams = this.encodeSwapData(trade);

    // Check approval for token if needed
    await this.approveTokenIfNeeded(
      trade.inputAmount.token,
      BigInt(trade.inputAmount.raw.toString()),
      account
    );

    const contract = new Contract(
      this.routerAddress,
      this.routerInterface,
      account
    );

    const params = {
      path: swapParams.calldata,
      recipient: options.recipient,
      deadline: options.deadline,
      amountIn: trade.inputAmount.raw.toString(),
      amountOutMinimum: this.calculateMinimumOut(trade.outputAmount, options.slippageTolerance).toString()
    };

    console.log('Debug swap parameters:', {
      path: params.path,
      pathComponents: {
        tokenIn: trade.route.path[0].address,
        fee: trade.route.pools[0].fee,
        tokenOut: trade.route.path[1].address
      },
      recipient: params.recipient,
      deadline: params.deadline,
      amountIn: params.amountIn,
      amountOutMinimum: params.amountOutMinimum,
      routerAddress: this.routerAddress,
      value: swapParams.value
    });

    // First try calling staticCall to get more error details
    try {
      await contract.exactInput.staticCall(
        params,
        { value: swapParams.value }
      );
    } catch (error) {
      console.error('Static call failed:', error);
      throw error;
    }

    const gasLimit = await contract.exactInput.estimateGas(
      params,
      { value: swapParams.value }
    );

    const tx = await contract.exactInput(
      params,
      {
        gasLimit: gasLimit * 120n / 100n, // Add 20% buffer
        value: swapParams.value
      }
    );

    return tx;
  }
}

// Example usage:
/*
// Setup provider and wallet
const provider = new ethers.JsonRpcProvider('YOUR_RPC_URL');
const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

// Create trade from your quote result
const trade = createTradeFromQuote(quoteResult, "exactIn");

// Create router (only needs address, not provider)
const router = new SwapRouter('ROUTER_ADDRESS');

// Execute swap
const options = {
  recipient: wallet.address,
  slippageTolerance: 50, // 0.5%
  deadline: Math.floor(Date.now() / 1000) + 1800 // 30 minutes
};

const tx = await router.executeSwap(trade, options, wallet);
*/
