import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { detectIndependentSNR } from '../lib/htf-snr';
import { candle, data, supportHistory } from '../tests/htf-test-helpers';

async function main() {
const source = process.argv[2];
if (!source) throw new Error('Pass extracted archive htf-snr.ts path');
const original = await import(pathToFileURL(source).href);
const continuous = Array.from({length:20},(_,i)=>candle(i,112,100,109));
const before = supportHistory(), after = [...before,candle(12,900,10,500)];
const oldBefore = original.detectIndependentSNR('W1',before,'bid',106);
const oldAfter = original.detectIndependentSNR('W1',after,'bid',106);
const oldContinuous = original.detectIndependentSNR('W1',continuous,'bid',106);
const newContinuous = detectIndependentSNR(data(continuous),'NAS100','bid',106);
const report = {
  archive_tests: '13/13 pass, but do not test these independent counterexamples',
  continuous_stay: { original: oldContinuous.zones.filter((z:{center:number})=>z.center===100).map((z:{status:string;historical_tests:number})=>({status:z.status,tests:z.historical_tests})),
    revised: newContinuous.zones.filter(z=>z.origin.price===100).map(z=>({status:z.status,tests:z.test_count})) },
  future_volatility: { original_tolerance_before: oldBefore.tolerance, original_tolerance_after: oldAfter.tolerance,
    revised_origin_band_before: detectIndependentSNR(data(before),'NAS100').zones.find(z=>z.origin.price===100)?.origin,
    revised_origin_band_after: detectIndependentSNR(data(after),'NAS100').zones.find(z=>z.origin.price===100)?.origin },
};
writeFileSync('verification/capitalive-v2-1/zip-counterexamples.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
}
void main();
