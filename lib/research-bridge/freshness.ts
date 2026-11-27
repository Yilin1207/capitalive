// Delivery policy, not a trading rule. Shared with the dependency-free publisher.
export const DEFAULT_FRESHNESS = { quote_seconds: 120, h4_delay_seconds: 600, delivery_seconds: 120 };
export function freshnessPolicy(env: Record<string,string|undefined> = {}) {
  const bounded=(name:string,fallback:number,min:number,max:number)=>{
    const value=Number(env[name]);return Number.isFinite(value)&&value>=min&&value<=max?value:fallback;
  };
  return {quote_seconds:bounded('BRIDGE_QUOTE_MAX_SECONDS',120,60,120),
    h4_delay_seconds:bounded('BRIDGE_H4_MAX_DELAY_SECONDS',600,60,600),
    delivery_seconds:bounded('BRIDGE_DELIVERY_MAX_SECONDS',120,30,120)};
}
export function deliveryHealth(generatedAt:string|null,now:number,maximumSeconds=120){
  const age=generatedAt?(now-Date.parse(generatedAt))/1000:null;
  return {age_seconds:age,status:age===null||!Number.isFinite(age)||age<0?'UNKNOWN':age>maximumSeconds?'STALE':'FRESH',
    reason:age!==null&&age>maximumSeconds?'DELIVERY_DELAY_REFRESH_REQUIRED':null};
}
