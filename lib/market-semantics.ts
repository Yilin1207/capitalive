export function actionableLive(marketStatus: string | null, fresh: boolean): boolean {
  return marketStatus === "TRADEABLE" && fresh;
}
