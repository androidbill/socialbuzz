// AbortController also works on Safari versions without AbortSignal.timeout().
export async function withRequestTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
