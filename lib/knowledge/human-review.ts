export const REVIEW_QUESTIONS=[
 {id:'context',question:'Почему выбран POI A на X? Как учтены старшие уровни, противоположные POI и значимость этого места?'},
 {id:'range',question:'Какие конкретные фракталы образуют актуальный DR? Где цена относительно Premium/Discount и почему это поддерживает сценарий?'},
 {id:'delivery',question:'Как цена подошла к A: сжатие, некорректированная экспансия или иначе? Укажите время и наблюдения; числовой порог автора не задан.'},
 {id:'reaction',question:'Какая закрытая реакция, raid или displacement поддерживает идею? Если VC не нужен, обоснуйте No VC без выдуманного сигнала.'},
 {id:'order_flow',question:'Как соотносятся последние два подтверждённых максимума и минимума: HH/HL, LH/LL или смешанная последовательность? Учтите каждый TF; внутренний IDM не отменяет внешний DR автоматически.'},
 {id:'target',question:'Почему выбран B (Fractal/FVG на X или X−1)? Как учтены роль, снятая ликвидность, промежуточные препятствия, неполнота пути и инвалидация C?'},
] as const;
export type HumanReview={evidence_sha256:string;as_of:string;reviewer:string;decision:'Bullish'|'Bearish'|'Neutral';answers:Record<string,string>;counterarguments:string[];C?:{price:number;timeframe:'MN1'|'W1'|'D1'|'H4';condition:'CLOSE_BEYOND';reason:string}};
export function reviewErrors(value:unknown):string[]{
 if(!value||typeof value!=='object')return ['Review must be an object'];const r=value as HumanReview,errors=[];
 if(typeof r.evidence_sha256!=='string'||! /^[a-f0-9]{64}$/.test(r.evidence_sha256)||typeof r.as_of!=='string'||!Number.isFinite(Date.parse(r.as_of))||new Date(r.as_of).toISOString()!==r.as_of)errors.push('Exact evidence hash and UTC as_of required');
 if(typeof r.reviewer!=='string'||!r.reviewer.trim()||r.reviewer.length>200||!['Bullish','Bearish','Neutral'].includes(r.decision))errors.push('Reviewer and decision required');
 if(!r.answers||REVIEW_QUESTIONS.some(q=>typeof r.answers[q.id]!=='string'||!r.answers[q.id].trim()||r.answers[q.id].length>3000))errors.push('Answer all qualitative review questions');
 if(!Array.isArray(r.counterarguments)||r.counterarguments.length<3||r.counterarguments.length>10||r.counterarguments.some(x=>typeof x!=='string'||!x.trim()||x.length>3000))errors.push('Three concrete counterarguments required');
 if(r.C&&(!Number.isFinite(r.C.price)||r.C.price<=0||!['MN1','W1','D1','H4'].includes(r.C.timeframe)||r.C.condition!=='CLOSE_BEYOND'||typeof r.C.reason!=='string'||!r.C.reason.trim()))errors.push('Invalid structural C');return errors;
}
