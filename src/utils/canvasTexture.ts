import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

/** 2D 캔버스로 그린 그림을 텍스처로 만든다 (외부 이미지 파일 없이 디테일 추가) */
export function makeCanvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat = false,
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d')!, width, height)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  if (repeat) tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

/** 시드 고정 난수 — 새로고침해도 나무·노이즈 배치가 동일하게 유지됨 */
export function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}
