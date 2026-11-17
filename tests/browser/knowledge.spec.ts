import {test,expect} from '@playwright/test';
test('active market selector uses EURUSD NAS100 JP225 and retired intelligence UI redirects to PA desk',async({page})=>{
 await page.goto('/');expect(await page.locator('select').first().locator('option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value))).toEqual(['EURUSD','NAS100','JP225']);
 await page.goto('/intelligence');await expect(page).toHaveURL(/\/research$/);await expect(page.getByRole('heading',{name:'Capitalive V6 — PA Evidence'})).toBeVisible();await expect(page.getByRole('heading',{name:/Narrative|A \/ B \/ C/})).toHaveCount(0);
});
test('knowledge catalog searches original summaries and exposes uncertainties',async({page})=>{
 await page.goto('/knowledge');await expect(page.getByText(/Импортировано 85\/85/)).toBeVisible();await page.getByRole('textbox',{name:'Поиск по материалам и правилам'}).fill('EDGE.RB');await page.getByRole('button',{name:'Найти',exact:true}).click();await page.locator('summary').filter({hasText:'EDGE.RB.v2'}).click();await expect(page.getByText(/The user specified first-candle close and FVG-only weakness/)).toBeVisible();const response=await page.request.get('/api/knowledge?q=EDGE.RB');expect(response.status()).toBe(200);expect((await response.json()).rules[0].id).toBe('EDGE.RB.v2');
});
