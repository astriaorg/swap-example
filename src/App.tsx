import { ethers } from "ethers";

import "./App.css";
import useGetQuote from "./useGetQuote.tsx";
import { ChainId } from "./types.ts";
import { createTradeFromQuote, SwapOptions, SwapRouter } from "./SwapExecution.ts";
import { useCallback, useMemo } from "react";

const RPC_URL = "https://rpc.flame.astria.org";
const SWAP_ROUTER_ADDRESS = "0x29bBaFf21695fA41e446c4f37c07C699d9f08021";
const RECIPIENT_ADDRESS = "0xb0E31D878F49Ec0403A25944d6B1aE1bf05D17E1";
const AMOUNT = "10000000000000000";
const TRADE_TYPE = "exactOut";

function App() {

  const { quote, loading, error } = useGetQuote({
    chainId: ChainId.MAINNET,
    amount: AMOUNT,
    tokenInAddress: "0x3f65144F387f6545bF4B19a1B39C94231E1c849F",
    tokenInDecimals: 6,
    tokenInSymbol: "usdc",
    tokenOutAddress: "0xcbb93e854AA4EF5Db51c3b094F28952eF0dC67bE",
    tokenOutDecimals: 18,
    tokenOutSymbol: "milktia",
    type: TRADE_TYPE,
  });

  console.log({
    quote, loading, error,
  });

  const trade = useMemo(() => {
    if (!quote) {
      return null;
    }
    return createTradeFromQuote(quote, TRADE_TYPE);
  }, [quote]);

  const executeSwap = useCallback(async () => {
    if (!trade) {
      return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const privateKey = import.meta.env.VITE_PRIV_KEY;
    if (!privateKey) {
      throw new Error("No private key found");
    }
    const wallet = new ethers.Wallet(privateKey, provider);
    const router = new SwapRouter(SWAP_ROUTER_ADDRESS);
    const options: SwapOptions = {
      recipient: RECIPIENT_ADDRESS,
      slippageTolerance: 50, // 0.5%
      deadline: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
    };

    const tx = await router.executeSwap(trade, options, wallet);
    console.log("tx", tx);
  }, [trade]);

  return (
    <>
      <div>
        howdy!

        {loading && <div>Loading...</div>}

        {trade && !loading && !error && (
          <div>
            <button type="button" onClick={executeSwap}>Make swap!</button>
          </div>
        )}

        {trade && !loading && (
          <div>
            <div>The trade:</div>
            <pre style={{
              textAlign: "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              borderRadius: "5px",
            }}>
            {JSON.stringify(trade, null, 2)}
          </pre>

          </div>
        )}


      </div>

    </>
  );
}

export default App;
