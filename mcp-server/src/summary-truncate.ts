const DEFAULT_CHAR_BUDGET = 4000;

export function structuredTruncate(
  text: string,
  resultPath: string,
  charBudget: number = DEFAULT_CHAR_BUDGET
): { summary: string } {
  if (text.length <= charBudget) {
    return { summary: text };
  }

  const items = text.split('\n').filter((line) => line.trim().length > 0);
  let acc = '';
  let count = 0;
  for (const item of items) {
    const candidate = acc ? `${acc}\n${item}` : item;
    if (candidate.length > charBudget) break;
    acc = candidate;
    count++;
  }

  return {
    summary: `${acc}\n\n(truncated: ${count} of ${items.length} findings, rest in ${resultPath})`
  };
}
