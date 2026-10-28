/**
 * What each Java major version is actually for. Minecraft pins one major per era,
 * and the runtime cannot be substituted across those eras.
 */
const PURPOSES: Record<number, string> = {
  25: 'Newest runtime. Required by Minecraft 26.x and newer.',
  21: 'Required by Minecraft 1.20.5 through 1.21.x.',
  17: 'Required by Minecraft 1.17 through 1.20.4.',
  16: '2021 snapshot runtime. Only the first 1.17 snapshots need it.',
  14: 'Small helper component (minecraft-java-exe). Never used to run the game itself.',
  8: 'Required by Minecraft 1.12.2 and older, and by their Forge, Fabric, and legacy mod loaders.',
}

export function javaPurpose(major: number): string | null {
  if (!Number.isFinite(major)) return null
  return PURPOSES[major] || `Java ${major} runtime, used by Minecraft versions that pin this major.`
}
