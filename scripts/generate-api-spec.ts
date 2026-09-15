import fs from "node:fs";
import { openApiDocument } from "../packages/core/src/operations";
fs.writeFileSync(
  new URL("../openapi.json", import.meta.url),
  JSON.stringify(openApiDocument(), null, 2) + "\n",
);
