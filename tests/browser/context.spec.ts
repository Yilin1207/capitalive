import {test,expect} from '@playwright/test';
import {syntheticPaReport} from '../fixtures/pa-report-synthetic';

test('V6 research shows objective evidence, server filters, full candle proof and closed OHLC pages',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const evidenceQueries:URLSearchParams[]=[],candleQueries:URLSearchParams[]=[];
 await page.route('**/api/desk-report?**',route=>{const p=new URL(route.request().url()).searchParams;return route.fulfill({json:syntheticPaReport(p.get('symbol')!,p.get('side')!)});});
 await page.route('**/api/pa-evidence?**',route=>{const q=new URL(route.request().url()).searchParams;evidenceQueries.push(q);const r=syntheticPaReport(q.get('symbol')!,q.get('side')!);return route.fulfill({json:{schema_version:'pa-evidence-page-v6',mode:'PA_ONLY',evidence:r.evidence,total:q.has('id')?1:21,offset:Number(q.get('offset')??0),next_offset:q.get('offset')==='20'||q.has('id')?null:20,omitted:20,snapshot_sha256:r.snapshot_sha256}});});
 await page.route('**/api/pa-candles?**',route=>{const q=new URL(route.request().url()).searchParams;candleQueries.push(q);return route.fulfill({json:{schema_version:'pa-candles-page-v6',mode:'PA_ONLY',candles:[{time:'2026-11-16T00:00:00.000Z',end:'2026-11-16T04:00:00.000Z',open:1.1,high:1.101,low:1.099,close:1.1005,segment:0}],total:21,offset:Number(q.get('offset')??0),next_offset:q.get('offset')==='20'?null:20,omitted:20,warnings:['SYNTHETIC_UI_FIXTURE']}});});
 await page.goto('/research');await page.getByRole('button',{name:'Получить свежие отчёты'}).click();await expect(page.getByRole('heading',{name:'JP225 — PARTIAL'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Четыре таймфрейма'})).toHaveCount(3);
 await expect(page.getByRole('heading',{name:/Narrative|A \/ B \/ C|LONG|SHORT|R:R/})).toHaveCount(0);
 const card=page.getByRole('article',{name:'EURUSD'});await expect(card).toContainText('Показано 1 из 21');await expect(card).toContainText('CONSUMED / роль не доказана');await expect(card).toContainText('1.10128');
 await card.getByRole('combobox',{name:'TF PA EURUSD'}).selectOption('H4');await card.getByRole('combobox',{name:'Тип PA EURUSD'}).selectOption('FRACTAL');await card.getByRole('combobox',{name:'Lifecycle EURUSD'}).selectOption('CONSUMED');await card.getByRole('spinbutton',{name:'Цена от EURUSD'}).fill('1.1');await card.getByRole('button',{name:'Найти PA',exact:true}).click();
 await expect.poll(()=>evidenceQueries.length).toBe(1);expect(Object.fromEntries(evidenceQueries[0])).toMatchObject({symbol:'EURUSD',side:'bid',timeframe:'H4',kind:'FRACTAL',lifecycle:'CONSUMED',min_price:'1.1',snapshot_sha256:'a'.repeat(64),offset:'0'});
 await card.getByRole('button',{name:'Следующие PA'}).click();await expect.poll(()=>evidenceQueries.length).toBe(2);expect(evidenceQueries[1].get('offset')).toBe('20');
 await card.getByRole('button',{name:'Открыть Evidence',exact:true}).click();const detail=card.getByRole('region',{name:'Полное Evidence EURUSD'});await expect(detail).toContainText('EDGE.FRACTAL3.v1');await expect(detail.getByRole('row')).toHaveCount(4);await expect(detail).toContainText('2026-11-16T12:00:00.000Z');
 await card.getByLabel('OHLC с EURUSD').fill('2026-11-16');await card.getByRole('button',{name:'Загрузить OHLC'}).click();await expect.poll(()=>candleQueries.length).toBe(1);expect(candleQueries[0].get('from')).toBe('2026-11-16T00:00:00.000Z');await card.getByRole('button',{name:'Следующие свечи'}).click();await expect.poll(()=>candleQueries.length).toBe(2);expect(candleQueries[1].get('offset')).toBe('20');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);await page.screenshot({path:'test-results/pa-v6-research.png',fullPage:true});
});

test('V6 evidence snapshot mismatch is explicit and clears detailed evidence',async({page})=>{
 await page.route('**/api/desk-report?**',route=>route.fulfill({json:syntheticPaReport(new URL(route.request().url()).searchParams.get('symbol')!)}));
 await page.route('**/api/pa-evidence?**',route=>route.fulfill({status:409,json:{error:'SNAPSHOT_CHANGED'}}));
 await page.goto('/research');await page.getByRole('button',{name:'Получить свежие отчёты'}).click();const card=page.getByRole('article',{name:'EURUSD'});await card.getByRole('button',{name:'Открыть Evidence',exact:true}).click();await expect(card.getByRole('alert')).toHaveText('Снимок изменился. Обновите отчёты.');await expect(card.getByRole('region',{name:'Полное Evidence EURUSD'})).toHaveCount(0);
});
