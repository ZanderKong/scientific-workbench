import { test, expect } from '@playwright/test';

test('composition does not consume Enter; unit hints never enter saved text', async ({ page, request }) => {
  await request.post('/api/v1/properties', { data: { canonicalName: '验收温度', recommendedUnit: '℃', aliases: ['测试热度'] } });
  await page.goto('/'); await page.getByRole('button', { name: '＋ 新建样品' }).click();
  const editor = page.getByRole('textbox', { name: '样品正文' });
  await editor.click(); await page.keyboard.insertText('123 abc ｜');
  await expect(page.getByRole('listbox')).toBeVisible();
  const before = await page.getByRole('listbox').innerText();
  await editor.dispatchEvent('compositionstart', { data: '' });
  await page.keyboard.insertText('验收');
  expect(await page.getByRole('listbox').innerText()).toBe(before);
  const intercepted = await editor.evaluate(element => !element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
  expect(intercepted).toBe(false);
  await editor.dispatchEvent('compositionend', { data: '验收' });
  await page.getByRole('option', { name: /验收温度/ }).click();
  await expect(editor.locator('.unitHint')).toHaveText('℃');
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  const rows = await (await request.get('/api/v1/samples')).json();
  const document = await (await request.get(`/api/v1/documents/${rows[0].id}`)).json();
  expect(document.body).toContain('验收温度：');
  expect(document.body).not.toContain('℃');
  expect(document.body).not.toContain('unitHint');
});
