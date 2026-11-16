'use client';
import {useState} from 'react';
import {ACTIVE_RESEARCH_SYMBOLS} from '../../lib/active-research-markets';
type Row={symbol:string;status:string;generated_at?:string;expires_at?:string;quote?:{provider_timestamp:string|null};freshness?:{quote_status:string};frames?:{timeframe:string;last_closed_at:string|null}[]};
export default function ResearchRefresh(){
 const [busy,setBusy]=useState(false),[rows,setRows]=useState<Row[]>([]),[files,setFiles]=useState<Record<string,string>>({});
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
 return <main style={{maxWidth:1000,margin:'40px auto',padding:24}}><h1>Capitalive Research V5</h1>
  <p>Обновление по запросу: EURUSD · NAS100 · JP225. Доступ защищён Vercel SSO. Котировка и закрытые свечи имеют отдельные timestamps.</p>
  <button onClick={refresh} disabled={busy}>{busy?'Получаем данные…':'Получить свежие отчёты'}</button>
  <p>После получения скачайте JSON и приложите к исследованию ChatGPT. GitHub-подключение читает сохранённые файлы и само не запускает этот запрос.</p>
  <p><a href="https://github.com/Yilin1207/capitalive-research-bridge/actions/workflows/research-bridge.yml">Обновить приватный GitHub через Run workflow</a></p>
  {rows.map(row=><section key={row.symbol} style={{borderTop:'1px solid #777',padding:'16px 0'}}><h2>{row.symbol} — {row.status}</h2>
   <p>Котировка: {row.quote?.provider_timestamp??'недоступна'} · {row.freshness?.quote_status??'не проверено'}</p>
   <p>Закрытая H4: {row.frames?.find(f=>f.timeframe==='H4')?.last_closed_at??'недоступна'}</p>
   <p>Сформирован: {row.generated_at??'—'} · Проверять срок годности: {row.expires_at??'—'}</p>
   {files[row.symbol]&&<button onClick={()=>save(row.symbol)}>Скачать {row.symbol}.json</button>}</section>)}
  <p>Это технические наблюдения. Candidate Narrative требует ручной оценки; макроанализ и окончательное решение остаются за пользователем.</p>
 </main>;
}
