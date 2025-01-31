import { useState, useEffect } from "react";

export interface GetQuoteParams {
  // no cross chain swaps yet, so we only need to specify one chain right now,
  // which will be one of the Flame networks
  chainId?: number; // ChainId;
  tokenInAddress?: string;
  tokenInDecimals?: number;
  tokenInSymbol?: string;
  tokenOutAddress?: string;
  tokenOutDecimals?: number;
  tokenOutSymbol?: string;
  amount?: string;
  type: "exactIn" | "exactOut";
}

function useGetQuote({
  chainId,
  tokenInAddress,
  tokenInDecimals,
  tokenInSymbol,
  tokenOutAddress,
  tokenOutDecimals,
  tokenOutSymbol,
  amount,
  type,
}: GetQuoteParams) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      chainId &&
      tokenInAddress &&
      tokenInDecimals !== undefined &&
      tokenInSymbol &&
      tokenOutAddress &&
      tokenOutDecimals !== undefined &&
      tokenOutSymbol &&
      amount &&
      type
    ) {
      const fetchQuote = async () => {
        try {
          setLoading(true);
          setError(null);

          // Construct the URL
          const url =
            `https://us-west2-swap-routing-api-dev.cloudfunctions.net/get-quote?` +
            `chainId=${chainId}` +
            `&tokenInAddress=${tokenInAddress}` +
            `&tokenInDecimals=${tokenInDecimals}` +
            `&tokenInSymbol=${tokenInSymbol}` +
            `&tokenOutAddress=${tokenOutAddress}` +
            `&tokenOutDecimals=${tokenOutDecimals}` +
            `&tokenOutSymbol=${tokenOutSymbol}` +
            `&amount=${amount}` +
            `&type=${type}`;

          const response = await fetch(url, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
          }

          const data = await response.json();
          setQuote(data?.data);
        } catch (err) {
          console.warn(err);
          // TODO: Add real error here later when type is known
          setError("error message");
        } finally {
          setLoading(false);
        }
      };

      fetchQuote();
    }
  }, [
    chainId,
    tokenInAddress,
    tokenInDecimals,
    tokenInSymbol,
    tokenOutAddress,
    tokenOutDecimals,
    tokenOutSymbol,
    amount,
    type,
  ]);

  return { quote, loading, error };
}

export default useGetQuote;
