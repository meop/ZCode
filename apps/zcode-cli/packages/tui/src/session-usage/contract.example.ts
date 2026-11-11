import * as contract from "./contract.js";

/** The public entrypoint is available to the standalone assembly. */
export const availableForkSessionUsageExports = Object.keys(contract);
