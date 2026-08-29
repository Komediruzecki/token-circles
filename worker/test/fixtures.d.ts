// Vite inlines `?raw` imports as strings; workerd has no filesystem, so test fixtures come in
// this way rather than through node:fs.
declare module '*?raw' {
  const content: string;
  export default content;
}
