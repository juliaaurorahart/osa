/** Ignores non-images without letting them interrupt the rest of a dropped batch. */
export function instructionPhotoFiles<T extends { type: string }>(files: readonly T[]) {
  return files.filter((file) => file.type.startsWith('image/'))
}
