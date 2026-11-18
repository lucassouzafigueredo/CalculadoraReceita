/* Testes unitários das regras (sem rede). Uso: node scripts/teste_regras.js */
const assert = require('assert');
const R = require('../web/js/regras.js');

// normalização de códigos e números
assert.strictEqual(R.codigo(2013000, 8), '02013000');
assert.strictEqual(R.codigo('200', 3), '200');
assert.strictEqual(R.numero('1.234,56'), 1234.56);
assert.strictEqual(R.numero('R$ 10'), 10);
assert.ok(Number.isNaN(R.numero('abc')));
assert.deepStrictEqual(R.dataISO('10/03/2027'), { ano: 2027, mes: 3, dia: 10 });
assert.strictEqual(R.dataHoraNoAno({ ano: 2028, mes: 2, dia: 29 }, 2027), '2027-02-28T12:00:00-03:00');
assert.strictEqual(R.normalizarCabecalho(' Município IBGE '), 'municipio_ibge');

// exemplo mínimo (só NCM + valor): sem descoberta dá erro; com cClassTrib descoberta, passa com padrões
const minimo = R.EXEMPLOS.find((e) => e.sku === 'EXEMPLO-MINIMO');
assert.ok(R.validarLinhas([minimo]).problemas.some((p) => p.coluna === 'cclasstrib' && p.tipo === 'erro'));
const vm = R.validarLinhas([{ ...minimo, cst: '000', cclasstrib: '000001', __origem_cclasstrib: 'descoberta' }]);
assert.strictEqual(vm.linhas.length, 1);
assert.strictEqual(vm.linhas[0].uf, 'SP');
assert.strictEqual(vm.linhas[0].origem_cclasstrib, 'descoberta');

// validação: exemplos completos + erros de formato
const EXEMPLOS = R.EXEMPLOS.filter((e) => e.cclasstrib);
const { linhas, problemas } = R.validarLinhas([
  ...EXEMPLOS,
  { id_operacao: 'X', data_fato_gerador: '2027-01-01', uf: 'ZZ', municipio_ibge: '123', sku: 'A', cst: '000', cclasstrib: '200003', valor_produto: 10 },
  {},
]);
assert.strictEqual(linhas.length, EXEMPLOS.length);
const msgs = problemas.filter((p) => p.tipo === 'erro').map((p) => p.coluna);
['uf', 'municipio_ibge', 'ncm', 'cclasstrib'].forEach((c) => assert.ok(msgs.includes(c), `esperava erro em ${c}`));
const cerveja = linhas.find((l) => l.sku === 'CERVEJA-12L');
assert.strictEqual(cerveja.receita_bruta, 159); // 150 + IPI 9

// premissas: 2026 nunca recebe alíquota informada
const prem = R.lerPremissas([{ ano: 2026, cbs: 5 }, { ano: 2033, cbs: '9,0' }]);
assert.strictEqual(prem.find((p) => p.ano === 2026).cbs, null);
assert.strictEqual(prem.find((p) => p.ano === 2033).cbs, 9);

// operações: 2026 sem alíquotas nem IS; 2027 com alíquotas e IS
const bases = new Map(linhas.map((l, i) => [i, { baseRG: 100, baseIS: 90 }]));
const p26 = R.PREMISSAS_PADRAO[0];
const p27 = R.PREMISSAS_PADRAO[1];
const ops26 = R.montarOperacoes(linhas, 2026, p26, bases);
ops26.forEach((op) => op.corpo.itens.forEach((it) => { assert.ok(!it.aliquotasNominais); assert.ok(!it.impostoSeletivo); }));
const ops27 = R.montarOperacoes(linhas, 2027, p27, bases);
assert.strictEqual(ops27.length, 3); // NF-1001, NFS-2001, NF-3001
const itCerveja = ops27[0].corpo.itens[1];
assert.deepStrictEqual(itCerveja.impostoSeletivo.baseCalculo, 90);
assert.strictEqual(itCerveja.baseCalculo, undefined); // calculadora deriva base = base IS + IS
assert.strictEqual(itCerveja.aliquotasNominais.impostoSeletivo.adValorem, 10);
assert.ok(ops27[0].corpo.dhFatoGerador.startsWith('2027-03-10'));

// métricas
const m = R.metricas({ receita_bruta: 1000, pis: 16.5, cofins: 76, icms: 180, iss: 0, ipi: 0, custo_total: 500 },
  { estado: 'CALCULO_SIMULADO', vCBS: 80, vIBSUF: 0.5, vIBSMun: 0.5, vIS: 0 }, p27);
assert.strictEqual(m.carga_atual, 272.5);
assert.strictEqual(m.legado, 180);
assert.strictEqual(m.carga_nova, 261);
assert.ok(Math.abs(m.rl_nova - 739) < 1e-9);
assert.ok(m.reajuste_pct < 0);

console.log('regras: OK');
