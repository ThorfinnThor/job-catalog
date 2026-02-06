export function createLimiter(concurrency = 5) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= concurrency) return;
    const item = queue.shift();
    if (!item) return;
    active++;
    item()
      .catch(() => {})
      .finally(() => {
        active--;
        next();
      });
  };

  return async function limit(fn) {
    return await new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          const res = await fn();
          resolve(res);
        } catch (e) {
          reject(e);
        }
      });
      next();
    });
  };
}
