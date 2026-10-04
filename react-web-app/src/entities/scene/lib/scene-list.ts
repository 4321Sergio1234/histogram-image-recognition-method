/** Human list such as “sea, forest and desert”, read from the model catalog rather than hard-coded. */
export function sceneList(names: readonly string[], conjunction = 'and'): string {
  const lower = names.map((name) => name.toLowerCase());
  return lower.length < 2
    ? lower.join('')
    : `${lower.slice(0, -1).join(', ')} ${conjunction} ${lower.at(-1)}`;
}
