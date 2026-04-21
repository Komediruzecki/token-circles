/**
 * CSS Module Type Declarations
 */

declare module '*.module.css' {
  const styles: Record<string, string>
  export default styles
}

declare module '@/css/*.module.css' {
  const styles: Record<string, string>
  export default styles
}