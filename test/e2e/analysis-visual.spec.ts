import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

test('UI-003b: saved analysis layout preserves prototype context, comparison and artifact geometry', async ({ page, browser }, testInfo) => {
  const reference = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await reference.goto(`file://${path.resolve('prototype/reference.html')}`);
  await reference.evaluate("goPage({type:'analysis',id:'A-01'},'analysis')");
  const chart = await reference.locator('.chart').screenshot();
  // A reference-rendered image is fixture content only; the app never synthesizes charts.
  const file = { id: 'artifact', originalName: '反射率比较.png', mimeType: 'image/png', sizeBytes: chart.byteLength, sha256: 'visual-fixture' };
  const propertyKeys = [['hpmc', 'amount', 'HPMC', '添加量'], ['water', 'temperature', '水', '温度'], ['stir', 'speed', '搅拌', '转速'], ['observation', 'description', '观察', '描述']];
  const samples = [
    ['S260909-01', '2 g', '60 ℃', '300 rpm', '白色液滴'],
    ['S260909-02', '1 g', '60 ℃', '300 rpm', '液滴较大'],
    ['S260908-03', '—', '60 ℃', '300 rpm', '快速聚并'],
  ].map(([id, ...values], index) => ({ id, code: id, title: "", createdAt: "2026-09-09", contentVersion: 1, extractionStatus: "ready", properties: propertyKeys.map(([object_id, property_id, object_name, property_name], column) => ({ id: `${id}-${column}`, object_id, property_id, object_name, property_name, value_text: values[column] })), document: { head: { blocks: index === 0 ? { first: { dataId: 'd1' }, second: { dataId: 'd2' } } : {} } } }));
  const objects = [{ id: 'hpmc', canonicalName: 'HPMC', role: 'material', aliases: [], lifecycle: 'active', version: 1 }, { id: 'stir', canonicalName: '搅拌', role: 'process', aliases: [], lifecycle: 'active', version: 1 }];
  const analysis = { id: 'A-01', title: 'HPMC 添加量对乳液稳定性的影响', question: '比较不同 HPMC 添加量下的液滴状态、静置稳定性与反射率变化，并形成可追溯论点。', body: '', itemIds: [...samples.map(sample => sample.id), ...objects.map(object => object.id)], attachmentIds: ['artifact'], version: 1, createdAt: '2026-09-09', updatedAt: '2026-09-09', layout: { visibleSections: ['context', 'compare', 'data', 'artifacts', 'claims'], hiddenColumns: [], columnOrder: [] } };
  const data = ['反射率曲线 260909-01', '滴加后白色液滴'].map((name, index) => ({ id: `d${index + 1}`, name, aboutSampleIds: [samples[0].id], componentIds: index === 0 ? ['curve'] : [], components: [] }));
  const claims = ['HPMC 可能抑制液滴聚并，并改善静置稳定性。\n  - 状态: 待验证｜置信度: Medium', '高 HPMC 条件下液滴聚并速度可能降低。\n  - 状态: 待验证'].map((text, index) => ({ id: `claim-${index}`, text, hostType: 'analysis', hostId: analysis.id, evidence: [], version: 1 }));
  const catalogue: Record<string, unknown> = { samples, data, analyses: [analysis], objects, claims, properties: [] };
  await page.route('**/api/v1/**', route => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/v1/', '');
    if (endpoint === 'attachments/artifact/content') return route.fulfill({ contentType: 'image/png', body: chart });
    return route.fulfill({ json: endpoint === 'attachments/artifact' ? file : catalogue[endpoint] ?? [] });
  });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/?acceptance=1');
  await page.locator('nav').getByRole('button', { name: '◫ 分析' }).click();
  await page.getByRole('cell', { name: analysis.title, exact: true }).click();
  await expect(page.getByRole('img', { name: file.originalName })).toBeVisible();
  const measurements = [];
  for (const selector of ['.detailTop', '.detailHero', '.analysisToolbar', '.analysisGrid', '.entityChips', '.compareTable', '.chart', '.claimSharedArea']) {
    const expected = await reference.locator(selector).first().boundingBox(), actual = await page.locator(selector).first().boundingBox();
    measurements.push({ selector, expected, actual });
    for (const key of ['x', 'y', 'width', 'height'] as const) expect.soft(Math.abs(expected![key] - actual![key]), `${selector}.${key}`).toBeLessThanOrEqual(2);
  }
  fs.writeFileSync(testInfo.outputPath('geometry.json'), JSON.stringify(measurements, null, 2));
  const a = PNG.sync.read(await page.screenshot({ path: testInfo.outputPath('actual.png') })), b = PNG.sync.read(await reference.screenshot({ path: testInfo.outputPath('reference.png') }));
  const diff = new PNG({ width: 1440, height: 1000 });
  const pixels = pixelmatch(a.data, b.data, diff.data, 1440, 1000, { threshold: 0.1 });
  fs.writeFileSync(testInfo.outputPath('diff.png'), PNG.sync.write(diff));
  fs.writeFileSync(testInfo.outputPath('pixels.json'), JSON.stringify({ pixels, ratio: pixels / 1440000 }));
  expect(pixels / 1440000).toBeLessThanOrEqual(0.005);
  await reference.close();
});
