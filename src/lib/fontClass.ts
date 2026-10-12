// 글꼴 이름으로 고딕/명조를 가른다. 한글 문서(한컴·HY·함초롬·휴먼 등)에서 흔한 이름을 함께 본다.
const SANS = /gothic|dotum|돋움|고딕|굴림|맑은|malgun|gulim|sans|pretendard|arial|helvetica|verdana|tahoma|segoe|calibri|nanumsquare|spoqa|헤드라인|그래픽|엽서|hy(gt|gs|hdr|po)|h2(gt|gs|hdr|po)|gtr|hdr|gsr|kopub.*dotum|hcrdotum|noto ?sans|source ?han ?sans|본고딕|나눔스퀘어|이롭|consolas|courier/i;
const SERIF = /batang|myeong|myung|mjo|명조|바탕|궁서|gungsuh|times|garamond|georgia|minion|mincho|songti|simsun|cambria|serif|h2mj|hymj|mjr|kopub.*batang|hcrbatang|본명조/i;

/** true: 명조, false: 고딕, null: 이름으로 모름 */
export function isSerifName(name: string): boolean | null {
  const n = name.replace(/^[A-Z]{6}\+/, '');
  if (SANS.test(n)) return false;
  if (SERIF.test(n)) return true;
  return null;
}
