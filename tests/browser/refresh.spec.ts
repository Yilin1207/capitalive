import {test,expect} from '@playwright/test';
import {syntheticDeskReport} from '../fixtures/desk-report-synthetic';
test('protected refresh UI requests new three-market JSON, shows times, and clears prior success on failure',async({page})=>{
 let fail=false;const calls:string[]=[];
 await page.route('**/api/desk-report?**',route=>{
  expect(route.request().method()).toBe('POST');const url=new URL(route.request().url());expect(url.searchParams.get('refresh')).toBe('1');
  const symbol=url.searchParams.get('symbol')!;calls.push(symbol);
  return fail?route.fulfill({status:503,json:{schema_version:'desk-report-v2',symbol,status:'ERROR'}}):route.fulfill({json:syntheticDeskReport(symbol)});
 });
 await page.goto('/research');await page.getByRole('button',{name:'Получить свежие отчёты'}).click();
 await expect(page.getByRole('button',{name:'Скачать JP225.json'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'JP225 — STALE'})).toBeVisible();
 await expect(page.getByText('Срок актуальности истёк.',{exact:false}).first()).toBeVisible();
 expect(calls).toEqual(['EURUSD','NAS100','JP225']);
 await expect(page.getByText('Котировка: 2026-11-15T14:00:00.000Z',{exact:false}).first()).toBeVisible();
 fail=true;await page.getByRole('button',{name:'Получить свежие отчёты'}).click();
 await expect(page.getByRole('heading',{name:'JP225 — ERROR'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'EURUSD — PARTIAL'})).toHaveCount(0);
});
