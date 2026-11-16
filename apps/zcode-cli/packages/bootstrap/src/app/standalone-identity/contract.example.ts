import * as contract from "./contract.js";

/** The public entrypoint is available to the standalone assembly. */
export const availableForkOfficialIdentityExports = Object.keys(contract);
