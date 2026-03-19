import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

export function createBasePublicClient(rpcUrl?: string, chainId?: number) {
  const chain = chainId === 84532 ? baseSepolia : base;
  return createPublicClient({
    chain,
    transport: http(rpcUrl || undefined),
  });
}
