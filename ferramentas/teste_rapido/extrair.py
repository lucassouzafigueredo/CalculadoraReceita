import sqlite3, json, sys
db, cl, fund, versao, saida = sys.argv[1:6]
c = sqlite3.connect(db)
q = lambda s: c.execute(s).fetchall()
fim = lambda f: None if not f or f.startswith('9999') else f
CBS = "exists (select 1 from TRIBUTO_SITUACAO_TRIBUTARIA ts where ts.TRST_SITR_ID=ct.CLTR_SITR_ID and ts.TRST_TBTO_ID=2)"

def regras(tab, pre, exc, epre):
    rows = q(f"""select n.{pre}_ID, n.{pre}_{'NCM' if pre=='NCMA' else 'NBS'}_CD, ct.CLTR_CD, n.{pre}_INICIO_VIGENCIA, n.{pre}_FIM_VIGENCIA,
                 a.ANXO_NUMERO, a.ANXO_NUMERO_ITEM, a.ANXO_TEXTO_ITEM
                 from {tab} n join CLASSIFICACAO_TRIBUTARIA ct on ct.CLTR_ID=n.{pre}_CLTR_ID
                 left join ANEXO a on a.ANXO_ID=n.{pre}_ANXO_ID where {CBS}""")
    exs = {}
    for e in q(f"select {epre}_{pre}_ID, {epre}_{'NCM' if pre=='NCMA' else 'NBS'}_CD, {epre}_INICIO_VIGENCIA, {epre}_FIM_VIGENCIA from {exc}"):
        exs.setdefault(e[0], []).append([e[1], e[2], fim(e[3])])
    return [{'p': r[1], 'c': r[2], 'ini': r[3], 'fim': fim(r[4]), 'ax': r[5], 'it': r[6], 'tx': r[7], 'ex': exs.get(r[0], [])} for r in rows]

dados = {
  'versao': json.load(open(versao)),
  'ncm': {r[0]: r[1] for r in q("select NCM_CD, NCM_DESCRICAO from NCM where coalesce(NCM_FIM_VIGENCIA,'9999') >= '2026-01-01'")},
  'nbs': {r[0]: r[1] for r in q("select NBS_CD, NBS_DESCRICAO from NBS where coalesce(NBS_FIM_VIGENCIA,'9999') >= '2026-01-01'")},
  'regrasNcm': regras('NCM_APLICAVEL', 'NCMA', 'EXCECAO_NCM_APLICAVEL', 'ENCM'),
  'regrasNbs': regras('NBS_APLICAVEL', 'NBSA', 'EXCECAO_NBS_APLICAVEL', 'ENBS'),
  'isNcm': [[r[0], r[1], fim(r[2])] for r in q("select AAVP_NCM_CD, AAVP_INICIO_VIGENCIA, AAVP_FIM_VIGENCIA from ALIQUOTA_AD_VALOREM_PRODUTO union select AARP_NCM_CD, AARP_INICIO_VIGENCIA, AARP_FIM_VIGENCIA from ALIQUOTA_AD_REM_PRODUTO")],
}
# tratamento tributário (expressões de base e alíquota) das classificações de CBS/IBS
dados['trat'] = {r[0]: {'desc': r[1], 'bc': r[2], 'al': r[3]} for r in q(f"""
  select ct.CLTR_CD, t.TRTR_DESCRICAO, t.TRTR_EXPRESSAO_BASE_CALCULO, t.TRTR_EXPRESSAO_ALIQUOTA
  from TRATAMENTO_CLASSIFICACAO tc join CLASSIFICACAO_TRIBUTARIA ct on ct.CLTR_ID=tc.TRCL_CLTR_ID
  join TRATAMENTO_TRIBUTARIO t on t.TRTR_ID=tc.TRCL_TRTR_ID
  where {CBS} and (tc.TRCL_FIM_VIGENCIA is null or tc.TRCL_FIM_VIGENCIA >= '2026-01-01')""")}
dados['isEx'] = [[r[0], r[1], fim(r[2])] for r in q("select EAVP_NCM_CD, EAVP_INICIO_VIGENCIA, EAVP_FIM_VIGENCIA from EXCECAO_AD_VALOREM_PRODUTO union select EARP_NCM_CD, EARP_INICIO_VIGENCIA, EARP_FIM_VIGENCIA from EXCECAO_AD_REM_PRODUTO")]
dados['aliqRef'] = [{'valor': r[0], 'tributo': r[1], 'ini': r[2], 'fim': fim(r[3])} for r in q(
  "select ALRE_VALOR, TBTO_SIGLA, ALRE_INICIO_VIGENCIA, ALRE_FIM_VIGENCIA from ALIQUOTA_REFERENCIA join TRIBUTO on TBTO_ID=ALRE_TBTO_ID")]
# atores exigidos (quem pode vender / comprar) por classificação de CBS/IBS
atores = {}
for cc, papel, ator in q(f"""select ct.CLTR_CD, ac.ATCL_IN_PAPEL, a.ATOR_DESCRICAO from ATOR_CLASSIFICACAO ac
    join ATOR a on a.ATOR_ID=ac.ATCL_ATOR_ID join CLASSIFICACAO_TRIBUTARIA ct on ct.CLTR_ID=ac.ATCL_CLTR_ID
    where {CBS} and (ac.ATCL_FIM_VIGENCIA is null or ac.ATCL_FIM_VIGENCIA >= '2026-01-01')"""):
    atores.setdefault(cc, []).append({'papel': papel, 'ator': ' '.join(ator.split())})
dados['atores'] = atores
fd = {f['codigoClassificacaoTributaria']: {'textoCurto': f['textoCurto'], 'texto': f['texto']} for f in json.load(open(fund))}
classes = json.load(open(cl))
for k in classes:
    k.pop('tiposDfeClassificacao', None)
    if k['codigo'] in fd: k['_fund'] = fd[k['codigo']]
dados['classes'] = classes
json.dump(dados, open(saida, 'w'), ensure_ascii=False, separators=(',', ':'))
print('ncm', len(dados['ncm']), 'nbs', len(dados['nbs']), 'regrasNcm', len(dados['regrasNcm']), 'regrasNbs', len(dados['regrasNbs']), 'is', len(dados['isNcm']), 'trat', len(dados['trat']), 'classes', len(classes))
