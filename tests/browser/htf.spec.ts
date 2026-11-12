import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {chartHtf} from '../../lib/chart-htf';
import type {CandleResponse,Timeframe} from '../../lib/candle-data';

const fixture=JSON.parse(readFileSync('tests/fixtures/htf-NAS100.json','utf8')) as {data:Record<Timeframe,CandleResponse>;quote:{bid:number;ask:number}};
test('HTF controls render distinct timeframes/events, preserve PNG parameters and show priority explanations on mobile',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/candles?**',route=>route.fulfill({json:fixture.data[new URL(route.request().url()).searchParams.get('timeframe') as Timeframe]}));
  await page.route('**/api/htf-zones?**',route=>{
    const side=new URL(route.request().url()).searchParams.get('side') as 'bid'|'ask';
    return route.fulfill({json:{ok:true,...chartHtf(fixture.data,'NAS100',side,fixture.quote[side])}});
  });
  await page.goto('/');await page.getByRole('button',{name:'W1',exact:true}).click();
  const panel=page.getByRole('region',{name:'Техническая структура Capitalive'});
  for(const label of ['Monthly SNR','Weekly SNR','Daily SNR','H4 SNR'])await panel.getByLabel(label,{exact:true}).check();
  for(const tf of ['MN1','W1','D1','H4'])await expect(panel.locator(`[data-snr-timeframe="${tf}"]`).first()).toBeVisible();
  await panel.getByLabel('Пробои / ретесты / failed reclaim',{exact:true}).check();
  await expect(panel.locator('[data-snr-state]').first()).toBeVisible();
  await expect(panel.getByRole('link',{name:'Открыть PNG'})).toHaveAttribute('href',/snr_mn1=1.*snr_w1=1.*snr_d1=1.*snr_h4=1.*snr_events=1/);
  await panel.locator('.priority-zones summary').click();await expect(panel.getByRole('link',{name:'полном каталоге SNR'})).toHaveAttribute('href',/view=full/);
  await panel.screenshot({path:'verification/capitalive-v2-1/final-browser-htf.png'});
  await panel.getByLabel('Weekly SNR',{exact:true}).uncheck();await expect(panel.locator('[data-snr-timeframe="W1"]')).toHaveCount(0);
  await panel.getByLabel('Пробои / ретесты / failed reclaim',{exact:true}).uncheck();await expect(panel.locator('[data-snr-state]')).toHaveCount(0);
  await page.getByRole('button',{name:'ASK',exact:true}).click();await expect(panel.locator('[data-zone-id*="ask:snr:"]').first()).toBeVisible();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'verification/capitalive-v2-1/final-browser-mobile.png',fullPage:true});expect(errors).toEqual([]);
});
test('an HTF error leaves original candle/fractal chart usable and explicit',async({page})=>{
  await page.route('**/api/candles?**',route=>route.fulfill({json:fixture.data.H4}));
  await page.route('**/api/htf-zones?**',route=>route.fulfill({status:503,json:{ok:false,error:{message:'Historical HTF unavailable'}}}));
  await page.goto('/');const panel=page.getByRole('region',{name:'Техническая структура Capitalive'});
  await panel.getByLabel('Weekly SNR',{exact:true}).check();await expect(panel.getByText('HTF: Historical HTF unavailable',{exact:true})).toBeVisible();
  await expect(panel.locator('svg')).toContainText('NAS100 · H4 · BID');await expect(panel.locator('[data-snr-timeframe]')).toHaveCount(0);
});
