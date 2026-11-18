"use client";
import {useState} from 'react';
import type {buildIntelligence} from '@/lib/knowledge/intelligence';
import {REVIEW_QUESTIONS,type HumanReview} from '@/lib/knowledge/human-review';
import type {Timeframe} from '@/lib/candle-data';
import '../research/research.css';
import {decodeIntelligence} from '@/lib/knowledge/wire';
type Audit=ReturnType<typeof buildIntelligence>;
export default function HumanReviewPanel({audit,onAudit}:{audit:Audit;onAudit:(value:Audit)=>void}){
 const [anchor,setAnchor]=useState(audit.selection.anchor_id??''),[target,setTarget]=useState(audit.selection.target_id??''),[ranges,setRanges]=useState(audit.selection.ranges);
 const [reviewer,setReviewer]=useState(''),[decision,setDecision]=useState<HumanReview['decision']>('Neutral'),[answers,setAnswers]=useState<Record<string,string>>({}),[counter,setCounter]=useState(['','','']),[c,setC]=useState(''),[cReason,setCReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dirty=anchor!==(audit.selection.anchor_id??'')||target!==(audit.selection.target_id??'')||JSON.stringify(ranges)!==JSON.stringify(audit.selection.ranges);
 function query(){const q=new URLSearchParams({symbol:audit.symbol,side:audit.price_side});if(anchor)q.set('anchor_id',anchor);if(target)q.set('target_id',target);for(const [tf,pair] of Object.entries(ranges)){if(pair?.high_id)q.set(tf==='H4'?'high_id':`${tf.toLowerCase()}_high_id`,pair.high_id);if(pair?.low_id)q.set(tf==='H4'?'low_id':`${tf.toLowerCase()}_low_id`,pair.low_id);}return q;}
 async function run(review=false){setBusy(true);setError('');try{
 const payload:HumanReview={as_of:audit.as_of,evidence_sha256:audit.narrative.human_review.evidence_sha256,reviewer,decision,answers,counterarguments:counter,...(c&&audit.narrative.A?{C:{price:Number(c),timeframe:audit.narrative.A.timeframe as 'MN1'|'W1',condition:'CLOSE_BEYOND' as const,reason:cReason}}:{})};
 const r=await fetch(`/api/intelligence?${query()}`,review?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{cache:'no-store'}),body=await r.json();if(!r.ok)throw Error(body.error?.message??`HTTP ${r.status}`);onAudit(decodeIntelligence<Audit>(body));
 }catch(e){setError(String(e));}finally{setBusy(false);}}
 return <section className="research-form"><h2>HUMAN_REVIEW · исследовательский сценарий</h2><p>Подтверждение относится только к указанным свечам и выбору A/B/DR. Это ваше дискреционное решение; независимая валидация и разрешение на торговлю отсутствуют. Blind-разметка хранится отдельно.</p>
 <p>Structural Bias: {audit.narrative.structural_bias.map(x=>`${x.timeframe} ${x.bias}`).join(' · ')}. Macro Bias: NOT_PROVIDED. Confirmed Narrative: {audit.narrative.confirmed_narrative??'нет'}. Evidence Confidence: {audit.narrative.evidence_confidence.status}.</p>
 <fieldset disabled={busy}><legend>Выбор A, B и диапазонов по конкретным фракталам</legend>
 <label>A — активный HTF уровень <select value={anchor} onChange={e=>setAnchor(e.target.value)}><option value="">Автоматический кандидат</option>{audit.levels.detected_levels.filter(l=>['MN1','W1'].includes(l.timeframe)&&audit.levels.active_level_ids.includes(l.id)).map(l=><option key={l.id} value={l.id}>{l.timeframe} {l.kind} {l.lower}–{l.upper}</option>)}</select></label>
 <label>B — структурная цель <select value={target} onChange={e=>setTarget(e.target.value)}><option value="">Без явного выбора</option>{audit.target_selection.target_candidates.map(l=><option key={l.id} value={l.id}>{l.timeframe} {l.kind} {l.price} · {l.role_eligible?'роль проверена':l.reasons.join(', ')}</option>)}</select></label>
 {audit.frames.map(f=><div key={f.timeframe}><strong>{f.timeframe} DR</strong>{(['high','low'] as const).map(polarity=>{const key=polarity==='high'?'high_id':'low_id';return <label key={key}>{f.timeframe} {polarity} pivot <select value={ranges[f.timeframe]?.[key]??''} onChange={e=>{const copy={...ranges},pair={high_id:'',low_id:'',...copy[f.timeframe],[key]:e.target.value};if(!pair.high_id&&!pair.low_id)delete copy[f.timeframe];else copy[f.timeframe]=pair;setRanges(copy);}}><option value="">Не выбран</option>{f.findings.filter(v=>v.kind==='FRACTAL'&&v.facts.polarity===polarity).map(p=><option key={p.id} value={p.id}>{p.origin} · {String(p.facts.price)} · {p.rule_id}</option>)}</select></label>;})}</div>)}
 <button onClick={()=>void run(false)}>Пересчитать выбранный контекст</button></fieldset>
 <details><summary>Кандидаты B — основания и пути</summary>{audit.target_selection.candidate_reviews.map(c=><p key={c.id}>{c.id}: роль {String(c.role_eligible)}, TF X/X−1 {String(c.author_timeframe_eligible)}, препятствий {c.path_obstacle_ids.length}. {c.path_obstacle_ids.join('; ')}</p>)}</details>
 <details><summary>Доказательства и нерешённые условия</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify({context:audit.narrative.context,observations:audit.narrative.review_observations,hard_blockers:audit.narrative.blockers,A:audit.narrative.A,B:audit.narrative.B,C:audit.narrative.C},null,2)}</pre></details>
 <fieldset disabled={busy||dirty}><legend>Рецензия снимка {audit.as_of}</legend><label>Рецензент <input value={reviewer} onChange={e=>setReviewer(e.target.value)}/></label><label>Решение <select value={decision} onChange={e=>setDecision(e.target.value as HumanReview['decision'])}>{['Bullish','Bearish','Neutral'].map(x=><option key={x}>{x}</option>)}</select></label>
 {REVIEW_QUESTIONS.map(q=><label key={q.id}>{q.question}<textarea value={answers[q.id]??''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/></label>)}
 {!audit.narrative.C&&<><p>Если A — фрактал, структурная C не выводится из снятия ликвидности автоматически. Задайте собственное правило закрытия за границей на TF уровня; оно будет отмечено как ручное.</p><label>Ручная C — цена <input inputMode="decimal" value={c} onChange={e=>setC(e.target.value)}/></label><label>Обоснование C <textarea value={cReason} onChange={e=>setCReason(e.target.value)}/></label></>}
 {counter.map((v,i)=><label key={i}>Сильный контраргумент {i+1}<textarea value={v} onChange={e=>setCounter(counter.map((x,j)=>j===i?e.target.value:x))}/></label>)}
 <button onClick={()=>void run(true)}>Применить рецензию к этому снимку</button><p>SHA-256: {audit.narrative.human_review.evidence_sha256}. Изменение свечей или выбранных уровней потребует новой проверки. Результат не сохраняется на сервере.</p></fieldset>
 {dirty&&<p>Сначала пересчитайте изменённый контекст, затем заполните рецензию.</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
