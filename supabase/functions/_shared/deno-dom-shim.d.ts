declare module "jsr:@b-fuze/deno-dom" {
  export class DOMParser {
    parseFromString(input: string, mimeType: string): Document;
  }
}
