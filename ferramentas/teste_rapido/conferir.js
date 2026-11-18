/* Confere o motor do teste rápido contra o validador oficial da calculadora.
   Uso: node conferir.js <dados.json> <url_base_api>   (ex.: http://localhost:8080/api/calculadora)
   Sai com erro se houver qualquer divergência. */
const path = require('path');
const D = require(path.resolve(process.argv[2]));
const { criarMotor } = require('./motor_rapido.js');
const M = criarMotor(D);
const B = `${process.argv[3]}/dados-abertos/classificacoes-tributarias`;
const data = '2027-01-01';
async function pool(ts, n) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < ts.length) await ts[i++](); })); }
(async () => {
  const ncm8 = Object.keys(D.ncm).filter((c) => c.length === 8);
  const prefixos = D.regrasNcm.map((r) => r.p);
  const alvo = new Set(ncm8.filter((c) => prefixos.some((p) => c.startsWith(p))));
  const ncms = [...alvo, ...ncm8.filter((c) => !alvo.has(c)).filter((_, i) => i % 25 === 0)];
  const nbs9 = Object.keys(D.nbs).filter((c) => c.length === 9);
  const cn = M.classesComAnexo(D.regrasNcm, data), cb = M.classesComAnexo(D.regrasNbs, data);
  let total = 0; const dif = []; const ts = [];
  for (const n of ncms) for (const c of cn) ts.push(async () => {
    const r = await (await fetch(`${B}/ncm-aplicavel?cClassTrib=${c}&ncm=${n}&dataOcorrenciaFatoGerador=${data}`)).json();
    total++; if (!!r.valido !== !!M.valido(n, c, data, D.regrasNcm)) dif.push(['NCM', n, c, r.valido]);
  });
  for (const n of nbs9) for (const c of cb) ts.push(async () => {
    const r = await (await fetch(`${B}/nbs-aplicavel?cClassTrib=${c}&nbs=${n}&dataOcorrenciaFatoGerador=${data}`)).json();
    total++; if (!!r.valido !== !!M.valido(n, c, data, D.regrasNbs)) dif.push(['NBS', n, c, r.valido]);
  });
  await pool(ts, 16);
  console.log(`teste rápido x calculadora oficial: ${total} comparações, ${dif.length} divergência(s)`);
  if (dif.length || total < 1000) { console.error(dif.slice(0, 20)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
