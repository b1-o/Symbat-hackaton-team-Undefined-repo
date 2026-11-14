import { test, expect } from '@playwright/test';

// One browser page keeps the smoke test stable in constrained CI containers.
test('demo smoke: dashboard, labelled template mentor, strategy and mobile layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Твоя идея заслуживает старта/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await page.goto('/#/showcase');
  await page.getByLabel('Поиск проектов').fill('EcoTrack');
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.goto('/#/team');
  await page.getByRole('button', { name: 'Посмотреть демо-команду' }).click();
  await expect(page.getByRole('heading', { name: 'EduQuest', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Следующий шаг', exact: true }).click();
  await expect(page.getByText('Шаблон · не AI', { exact: true }).first()).toBeVisible();

  await page.goto('/#/strategy');
  await expect(
    page.getByRole('heading', { name: 'Не больше регистраций. Больше состоявшихся стартапов.' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: 'Не больше регистраций. Больше состоявшихся стартапов.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(page.locator('.sidebar')).toHaveJSProperty('inert', true);
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(page.locator('.sidebar')).toHaveJSProperty('inert', false);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).toHaveJSProperty('inert', true);
  expect(errors).toEqual([]);
});
