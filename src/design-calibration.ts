export function calibratedSize(width: number, height: number, a: {x:number,y:number}, b:{x:number,y:number}, metres:number) {
  const pixels = Math.hypot(a.x-b.x, a.y-b.y)
  if (![width,height,metres,pixels].every(n => Number.isFinite(n) && n > 0) || pixels < 1) throw new Error('请选择两个不同的图上位置，并填写实际长度。')
  return {width:width*metres/pixels,depth:height*metres/pixels}
}
