import { test, expect } from '@playwright/test';

// One browser page keeps the smoke test stable in constrained CI containers.
test('demo smoke: dashboard, labelled template mentor, strategy and mobile layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Твоя идея заслуживает старта/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await page.goto('/#/team');
  await page.getByRole('button', { name: 'Посмотреть демо-команду' }).click();
  await expect(page.getByRole('heading', { name: 'EduQuest', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Следующий шаг', exact: true }).click();
  await expect(page.getByText('Шаблон · не AI', { exact: true }).first()).toBeVisible();

  await page.goto('/#/strategy');
  await expect(page.getByRole('heading', { name: 'Не больше регистраций. Больше состоявшихся стартапов.' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Не больше регистраций. Больше состоявшихся стартапов.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('English journey: the switcher localises the student path and survives a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');

  // Russian stays the default on a fresh visit.
  await expect(page.getByRole('heading', { name: /Твоя идея заслуживает старта/i })).toBeVisible();
  await page.getByRole('group', { name: 'Язык интерфейса' }).getByRole('button', { name: 'EN' }).click();
  await expect(page.getByRole('heading', { name: /Your idea deserves a startup/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

  // The choice persists across a reload (localStorage, no account needed).
  await page.reload();
  await expect(page.getByRole('heading', { name: /Your idea deserves a startup/i })).toBeVisible();

  await page.goto('/#/join');
  await expect(page.getByText('Team name', { exact: true })).toBeVisible();
  expect(await page.locator('select option').allTextContents()).toContain('Kazakhstan');

  await page.goto('/#/team');
  await page.getByRole('button', { name: 'View the demo team' }).click();
  await expect(page.getByRole('heading', { name: 'EduQuest', exact: true })).toBeVisible();
  await expect(page.getByText('Team notebook', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.getByText('Template · not AI', { exact: true }).first()).toBeVisible();

  // The organiser console is honestly labelled as Russian-only.
  await page.goto('/#/organizer');
  await expect(page.getByText(/consoles are available in Russian only/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/team');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});
