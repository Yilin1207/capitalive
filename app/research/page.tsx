'use client';
import {useEffect,useState} from 'react';
import {ACTIVE_RESEARCH_SYMBOLS} from '../../lib/active-research-markets';
import type {compactResearchContext} from '../../lib/research-bridge/context';
type Row={symbol:string;status:string;generated_at?:string;expires_at?:string;quote?:{provider_timestamp:string|null};freshness?:{quote_status:string};frames?:{timeframe:string;last_closed_at:string|null;rb_quality?:{raid_backed:number;fvg_only_weaker:number}}[];
 research_context?:ReturnType<typeof compactResearchContext>;evidence?:Record<string,{id:string;timeframe:string;kind:string;lower:number;upper:number;confirmed_at?:string;rb?:{level_price:number;relative_quality:string;basis:string;primary_kl:string;liquidity:string|null;fvg:string|null};lifecycle?:{state:string;initial_role:string;fill?:{state:string}}}>};
export default function ResearchRefresh(){
 const [busy,setBusy]=useState(false),[rows,setRows]=useState<Row[]>([]),[files,setFiles]=useState<Record<string,string>>({});
 const [clock,setClock]=useState(0);
 useEffect(()=>{setClock(Date.now());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const expired=(row:Row)=>!!row.expires_at&&Date.parse(row.expires_at)<=clock;
 async function refresh(){setBusy(true);setRows([]);setFiles({});
  for(const symbol of ACTIVE_RESEARCH_SYMBOLS){
   try{const response=await fetch(`/api/desk-report?symbol=${symbol}&side=bid&refresh=1`,{method:'POST',cache:'no-store',redirect:'error'});
    if(!response.headers.get('content-type')?.includes('application/json'))throw Error('HTTP');
    const raw=await response.text();if(new TextEncoder().encode(raw).length>65536)throw Error('SIZE');
    const report=JSON.parse(raw);if(report.symbol!==symbol||report.schema_version!=='desk-report-v2')throw Error('CONTRACT');
    setRows(old=>[...old,report]);setFiles(old=>({...old,[symbol]:raw}));
   }catch{setRows(old=>[...old,{symbol,status:'ERROR — обновление недоступно'}]);}
  }setBusy(false);
 }
 function save(symbol:string){const url=URL.createObjectURL(new Blob([files[symbol]+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=symbol+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <main style={{maxWidth:1100,margin:'40px auto',padding:24}}><h1>Capitalive Research V5.1</h1>
  <p>Обновление по запросу: EURUSD · NAS100 · JP225. Публичные исследовательские отчёты. Котировка и закрытые свечи имеют отдельные timestamps.</p>
  <button onClick={refresh} disabled={busy}>{busy?'Получаем данные…':'Получить свежие отчёты'}</button>
  <p>После получения скачайте JSON и приложите к исследованию ChatGPT. GitHub-подключение читает сохранённые файлы и само не запускает этот запрос.</p>
  <p><a href="https://github.com/Yilin1207/capitalive-research-bridge/actions/workflows/research-bridge.yml">Обновить приватный GitHub через Run workflow</a></p>
  {rows.map(row=><section key={row.symbol} style={{borderTop:'1px solid #777',padding:'16px 0'}}><h2>{row.symbol} — {expired(row)&&row.status!=='ERROR'?'STALE':row.status}</h2>
   <p>Котировка: {row.quote?.provider_timestamp??'недоступна'} · {expired(row)?'STALE':row.freshness?.quote_status??'не проверено'}</p>
   {expired(row)&&row.status!=='ERROR'&&<p>Срок актуальности истёк. Запросите новый отчёт перед исследованием.</p>}
   <p>Закрытая H4: {row.frames?.find(f=>f.timeframe==='H4')?.last_closed_at??'недоступна'}</p>
   <p>Сформирован: {row.generated_at??'—'} · Проверять срок годности: {row.expires_at??'—'}</p>
   {row.research_context&&<div>
    <h3>Наблюдения и авторская структура</h3>
    <p>Авторская структура: {row.research_context.author_structure.status}. Candidate: {row.research_context.candidate_narrative}. Confirmed: {row.research_context.confirmed_narrative??'не подтверждён'}.</p>
    <table><thead><tr><th>TF</th><th>Последняя закрытая цена</th><th>Наблюдаемый участок между Fractal 3</th></tr></thead><tbody>{row.research_context.observed_price_behaviour.map(o=><tr key={o.timeframe}><td>{o.timeframe}</td><td>{o.reference_close??'нет данных'}</td><td>{o.last_observed_fractal_leg?`${o.last_observed_fractal_leg.direction} · Δ ${o.last_observed_fractal_leg.price_distance.toFixed(5)}`:'недостаточно данных'}</td></tr>)}</tbody></table>
    <p>Наблюдаемый участок не подтверждает тренд. Значимость требует ручной оценки.</p>
    <h3>Ключевые уровни для проверки</h3>
    <p>Показано {row.research_context.executive_evidence.items.length} из {row.research_context.executive_evidence.total}. Пропущено: {row.research_context.executive_evidence.omitted}. Отсутствие в таблице не доказывает отсутствие препятствий.</p>
    {row.research_context.executive_evidence.items.map(l=>{const e=row.evidence?.[l.level];return <details key={l.level}><summary>{e?.timeframe} {e?.kind} · {e?.lower}–{e?.upper} · {l.review_status}</summary>
     <p>Lifecycle: {e?.lifecycle?.state}. Fill: {e?.lifecycle?.fill?.state??'не применимо'}. Исходная геометрия: {e?.lifecycle?.initial_role}. Текущая роль: {l.current_role??'не подтверждена'}.</p>
     <p>Цена относительно зоны: {l.reference_position}. Причины: {l.relevance_reasons.join(', ')}.</p><p>Неопределённости: {l.uncertainty.join(', ')}.</p>
     <p>Связанные взаимодействия: {l.interactions.items.length}/{l.interactions.total}; HTF: {l.htf_dependencies.items.length}/{l.htf_dependencies.total}.</p><code>{e?.id}</code></details>;})}
    <h3>Rejection Blocks</h3>
    <p>RB подтверждается второй закрытой свечой. Уровень — закрытие первой свечи, включая гэп. Простой Rejection сам по себе не подтверждает RB.</p>
    <p>RB только на FVG существенно слабее RB со снятием ликвидности. Это качественное различие, а не вероятность сделки.</p>
    {row.frames?.filter(f=>f.rb_quality).map(f=><p key={'rb-'+f.timeframe}>{f.timeframe}: со снятием ликвидности — {f.rb_quality!.raid_backed}; только FVG — {f.rb_quality!.fvg_only_weaker}. Подсчёт по исходным KL: одна пара свечей может иметь несколько оснований.</p>)}
    {Object.values(row.evidence??{}).filter(e=>e.rb).map(e=><p key={e.id}>{e.timeframe} RB: {e.rb!.level_price}; {e.rb!.relative_quality==='RAID_BACKED'?'со снятием ликвидности':'только FVG — слабее'}; подтверждён {e.confirmed_at}. KL: {row.evidence?.[e.rb!.primary_kl]?.id}. <code>{e.id}</code></p>)}
    <p>Показаны включённые в компактный JSON доказательства. Полный список доступен в инспекции снимка; значимость и торговая применимость требуют проверки.</p>
    <h3>Диапазоны и путь</h3>
    <p>Первый установленный DR сверху вниз: {row.research_context.dealing_range_selection?.timeframe??'ожидание подтверждённой пары'}. Направление DR не подтверждает Narrative.</p>
    {row.research_context.dealing_range_reviews.map(f=>{const d=f.detection;return <details key={f.timeframe} open><summary>{f.timeframe}: {d?.status??'нужна проверка диапазона'} · {d?.direction??'нет направления'}</summary>
     {d?.high&&d?.low&&<p>Границы: {d.lower}–{d.upper}. EQ: {d.equilibrium}. Положение: {d.premium_discount??'не определено до нового подтверждения'}.</p>}
     <p>Начало диапазона: {d?.start_at??'не установлено'}; конец: {d?.end_at??'не установлен'}; подтверждение: {d?.confirmed_at??'ожидается'}.</p>
     <p>Выход тенью: {d?.last_wick_raid_at??'не наблюдался'}. Закрытие вне границ: {d?.close_break_at??'не наблюдалось'}.</p>
     <p>Внутренних фракталов: {d?.internal_fractals??0}; локальных кандидатов после взаимодействия с KL: {d?.local_candidates??0}. Их значимость требует проверки; внутренний фрактал не становится IDM автоматически.</p>
    </details>;})}
    {row.research_context.paths.length?row.research_context.paths.map(p=><p key={p.target}>Путь к {row.evidence?.[p.target]?.id}: {p.status}; препятствий {p.obstacles.total}, не показано {p.obstacles.omitted}. Свободный путь не доказан.</p>):<p>Нет проверяемого пути A → B. Цель не подставляется автоматически.</p>}
    {row.research_context.conflicts.length>0&&<p>Конфликты HTF / LTF: {row.research_context.conflicts.length}. Требуется оценка; направление не подтверждено.</p>}
    <a href={'/api/intelligence?'+new URLSearchParams({symbol:row.symbol,side:'bid',mode:'inspection',as_of:row.research_context.full_inspection.as_of,evidence_sha256:row.research_context.full_inspection.snapshot_sha256,limit:'25'})} target="_blank" rel="noreferrer">Открыть подробную инспекцию этого снимка</a>
   </div>}
   {files[row.symbol]&&<button onClick={()=>save(row.symbol)}>Скачать {row.symbol}.json</button>}</section>)}
  <p>Это технические наблюдения. Candidate Narrative требует ручной оценки; макроанализ и окончательное решение остаются за пользователем.</p>
 </main>;
}
