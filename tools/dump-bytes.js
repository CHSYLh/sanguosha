/** 临时：输出文件的头部字节，用于排查 .bat 编码问题 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

for (const rel of process.argv.slice(2)) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.log(rel + ' -> MISSING'); continue; }
  const b = fs.readFileSync(p);
  const head = Array.from(b.slice(0, 16)).map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const nonAscii = Array.from(b).filter((x) => x > 127).length;
  const hasBom = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
  // 逐行统计，找出可能被 cmd 误解析的行
  let utf8 = '';
  try { utf8 = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { utf8 = '<UTF8_FAIL>'; }
  const crlf = (b.toString('latin1').match(/\r\n/g) || []).length;
  const lf = (b.toString('latin1').match(/\n/g) || []).length - crlf;
  console.log('=== ' + rel);
  console.log('  size=' + b.length + ' nonAscii=' + nonAscii + ' bom=' + hasBom + ' crlf=' + crlf + ' bareLf=' + lf);
  console.log('  head: ' + head);
  console.log('  utf8 ok: ' + (utf8 !== '<UTF8_FAIL>'));
  console.log('');
}
