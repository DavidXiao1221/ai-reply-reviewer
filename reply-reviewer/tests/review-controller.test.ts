import { it, expect } from 'vitest';
import { ReviewController } from '../lib/reviewController';
it('旧任务晚返回、同指纹重新执行与取消均不能覆盖新任务', () => {
  const c = new ReviewController(); const a = c.begin('inputA'); const b = c.begin('inputB');
  expect(a.abort.signal.aborted).toBe(true); expect(c.isCurrent(a)).toBe(false); expect(c.isCurrent(b)).toBe(true);
  const b2 = c.begin('inputB'); expect(c.isCurrent(b)).toBe(false); expect(c.isCurrent(b2)).toBe(true);
  c.cancel(); expect(c.isCurrent(b2)).toBe(false);
});
