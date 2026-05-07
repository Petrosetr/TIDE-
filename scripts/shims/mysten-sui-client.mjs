import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

export class SuiClient extends SuiJsonRpcClient {}

export function getFullnodeUrl(network = "mainnet") {
  return getJsonRpcFullnodeUrl(network);
}

export { SuiJsonRpcClient, getJsonRpcFullnodeUrl };
