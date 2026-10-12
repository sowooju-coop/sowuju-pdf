// 글자 추가와 날짜 넣기에 쓰는 작은 도구들
import type { TextBox } from '../components/TextLayer';

type TextStyle = Pick<TextBox, 'size' | 'family' | 'bold' | 'color'>;
const KEY = 'sowuju.textStyle';
const DEFAULT: TextStyle = { size: 12, family: 'sans', bold: false, color: '#111827' };

/** 마지막에 쓴 글자 모양 (다음 글자도 같은 모양으로) */
export function loadTextStyle(): TextStyle {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULT; }
}
export function saveTextStyle(s: TextStyle) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장 못 해도 괜찮다 */ }
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 서류에 자주 쓰는 날짜 모양 */
export function dateFormats(d: Date): string[] {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const p = (v: number) => String(v).padStart(2, '0');
  return [`${y}. ${m}. ${day}.`, `${y}년 ${m}월 ${day}일`, `${y}-${p(m)}-${p(day)}`, `${y}.${p(m)}.${p(day)}`];
}
