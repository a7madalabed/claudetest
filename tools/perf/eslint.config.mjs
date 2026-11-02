import base from "../../eslint.config.mjs";

// Command-line tools: printing to the console IS their output.
export default [...base, { rules: { "no-console": "off" } }];
