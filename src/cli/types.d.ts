declare module "marked-terminal" {
  import { MarkedExtension } from "marked";
  export default class MarkedTerminal implements MarkedExtension {
    constructor(options?: Record<string, unknown>);
  }
}