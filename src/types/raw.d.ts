/**
 * Vite inlines text files imported with the `?raw` suffix, which is how the
 * launcher ships its README and roadmap inside the app bundle.
 */
declare module '*?raw' {
  const content: string
  export default content
}
