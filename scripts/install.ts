import { install } from "../src/install";
const result = await install();
console.log(JSON.stringify(result, null, 2));
if (!result.onPath)
  console.log(
    "\nAdd ~/.local/bin to PATH to use codex-commandcode-doctor directly.",
  );
